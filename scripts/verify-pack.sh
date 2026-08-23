#!/usr/bin/env bash
#
# Packaging smoke test.
#
# The unit tests import from src/, so nothing exercises what npm actually
# publishes. This packs the tarball, installs it into a throwaway consumer
# alongside the peer deps, and asserts that every published entry point
# resolves at runtime and keeps its types.
#
# Requires `pnpm build` to have run first. Run locally with `pnpm verify:pack`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="better-auth-firebase-auth"
PEERS=("better-auth" "firebase" "firebase-admin")

actual_name="$(cd "$REPO_ROOT" && node -p 'require("./package.json").name')"
if [[ "$actual_name" != "$PKG_NAME" ]]; then
	echo "error: package is now named '$actual_name'; update the fixtures in $0" >&2
	exit 1
fi

if [[ ! -f "$REPO_ROOT/dist/index.js" ]]; then
	echo "error: dist/ is missing or incomplete. Run \`pnpm build\` first." >&2
	exit 1
fi

TSC="$REPO_ROOT/node_modules/typescript/bin/tsc"
if [[ ! -f "$TSC" ]]; then
	echo "error: typescript not found at $TSC. Run \`pnpm install\` first." >&2
	exit 1
fi

# Outside the repo on purpose: inside it, the pnpm workspace root would capture
# the consumer install.
WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pack-smoke.XXXXXX")"
if [[ -n "${PACK_SMOKE_KEEP:-}" ]]; then
	echo "note: keeping $WORK (PACK_SMOKE_KEEP is set)"
else
	trap 'rm -rf "$WORK"' EXIT
fi

CONSUMER="$WORK/consumer"
mkdir -p "$CONSUMER"

echo "==> npm pack"
(cd "$REPO_ROOT" && npm pack --silent --pack-destination "$WORK" >/dev/null)
TARBALL="$(find "$WORK" -maxdepth 1 -name '*.tgz' -print -quit)"
if [[ -z "$TARBALL" ]]; then
	echo "error: npm pack produced no tarball" >&2
	exit 1
fi
echo "    $(basename "$TARBALL")"

# Pin the peers to the ranges the test suite already runs against, so this
# never drifts from package.json.
PEER_DEPS="$(cd "$REPO_ROOT" && node -p '
	const dev = require("./package.json").devDependencies ?? {};
	const peers = process.argv.slice(1);
	const missing = peers.filter((name) => !dev[name]);
	if (missing.length > 0) {
		console.error(`error: no devDependency range for ${missing.join(", ")}`);
		process.exit(1);
	}
	JSON.stringify(Object.fromEntries(peers.map((name) => [name, dev[name]])), null, 2);
' "${PEERS[@]}")"

cat > "$CONSUMER/package.json" <<EOF
{
  "name": "pack-smoke-consumer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": $PEER_DEPS
}
EOF

# pnpm, not npm: the store is already warm from the install earlier in the job,
# so the peers come from hard links instead of a ~270MB download. Its default
# isolated layout is also stricter than npm's hoisting -- a dependency the
# package failed to declare fails here rather than resolving by accident.
echo "==> installing the tarball next to ${PEERS[*]}"
(cd "$CONSUMER" && pnpm add --ignore-workspace --ignore-scripts --reporter=silent "$TARBALL")

cat > "$CONSUMER/esm-smoke.mjs" <<'EOF'
const entries = [
	[
		"better-auth-firebase-auth",
		["firebaseAuthPlugin", "firebaseAuthClientPlugin", "extractOobCodeFromUrl"],
	],
	["better-auth-firebase-auth/server", ["firebaseAuthPlugin"]],
	[
		"better-auth-firebase-auth/client",
		["firebaseAuthClientPlugin", "extractOobCodeFromUrl"],
	],
];

for (const [specifier, expected] of entries) {
	const mod = await import(specifier);
	const missing = expected.filter((name) => typeof mod[name] !== "function");
	if (missing.length > 0) {
		throw new Error(`import("${specifier}") is missing: ${missing.join(", ")}`);
	}
	console.log(`    ok  import("${specifier}")`);
}
EOF

cat > "$CONSUMER/cjs-smoke.cjs" <<'EOF'
// The package is ESM-only, so this leans on Node's require(esm) support (>= 22.12).
const mod = require("better-auth-firebase-auth");
const expected = [
	"firebaseAuthPlugin",
	"firebaseAuthClientPlugin",
	"extractOobCodeFromUrl",
];
const missing = expected.filter((name) => typeof mod[name] !== "function");
if (missing.length > 0) {
	throw new Error(`require("better-auth-firebase-auth") is missing: ${missing.join(", ")}`);
}
console.log('    ok  require("better-auth-firebase-auth")');
EOF

cat > "$CONSUMER/consumer.ts" <<'EOF'
import {
	extractOobCodeFromUrl,
	firebaseAuthClientPlugin,
	firebaseAuthPlugin,
} from "better-auth-firebase-auth";
import type {
	AuthResponse,
	ConfirmPasswordResetRequest,
	FirebaseAuthPluginOptions,
	SignInWithGoogleRequest,
	VerifyPasswordResetCodeResponse,
} from "better-auth-firebase-auth";

const options: FirebaseAuthPluginOptions = {
	serverSideOnly: true,
	sessionExpiresInDays: 7,
	passwordResetUrl: "https://example.test/reset",
};

export const pluginId: string = firebaseAuthPlugin(options).id;
export const clientPlugin = firebaseAuthClientPlugin(options);
export const oobCode: string | null = extractOobCodeFromUrl(
	"https://example.test/reset?oobCode=abc",
);

export const googleRequest: SignInWithGoogleRequest = { idToken: "id-token" };
export const confirmReset: ConfirmPasswordResetRequest = {
	oobCode: "abc",
	newPassword: "hunter2",
};
export const verifyResponse: VerifyPasswordResetCodeResponse = {
	valid: true,
	email: "user@example.test",
};
export const authResponse: AuthResponse = {
	user: { id: "u1", email: null, name: null, image: null },
	session: { id: "s1", expiresAt: new Date(), token: "t" },
};

// If the published declarations degrade to `any` -- which is how the nodenext
// breakage showed up -- these stop erroring, and tsc then reports the
// directives themselves as unused, failing the check.
// @ts-expect-error sessionExpiresInDays is a number, not a string.
export const badOptions: FirebaseAuthPluginOptions = { sessionExpiresInDays: "7" };
// @ts-expect-error valid is a boolean, not a string.
export const badResponse: VerifyPasswordResetCodeResponse = { valid: "yes", email: "" };
EOF

write_tsconfig() {
	cat > "$CONSUMER/tsconfig.$1.json" <<EOF
{
  "compilerOptions": {
    "module": "$3",
    "moduleResolution": "$2",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "files": ["consumer.ts"]
}
EOF
}

# `module: "preserve"` is what a modern bundler setup uses, but it only exists
# from TypeScript 5.4. The peer range is ">=5.0.0" and the declarations really do
# work that far back, so `esnext` carries the bundler check across the whole
# range and `preserve` is layered on when the compiler under test understands it.
# Without this, pointing TSC at a 5.0-5.3 compiler fails on the fixture rather
# than on the package, and the bottom of the declared range cannot be verified.
TS_VERSION="$(node -p "require('$(dirname "$TSC")/../package.json').version")"
TS_MAJOR="${TS_VERSION%%.*}"
TS_REST="${TS_VERSION#*.}"
TS_MINOR="${TS_REST%%.*}"

CHECKS=("nodenext:nodenext:nodenext" "bundler-esnext:bundler:esnext")
if (( TS_MAJOR > 5 )) || (( TS_MAJOR == 5 && TS_MINOR >= 4 )); then
	CHECKS+=("bundler-preserve:bundler:preserve")
else
	echo "note: TypeScript $TS_VERSION predates module: \"preserve\"; skipping that check"
fi

for check in "${CHECKS[@]}"; do
	IFS=: read -r name resolution mod <<< "$check"
	write_tsconfig "$name" "$resolution" "$mod"
done

echo "==> resolving entry points"
(cd "$CONSUMER" && node ./esm-smoke.mjs && node ./cjs-smoke.cjs)

echo "==> type-checking a consumer (TypeScript $TS_VERSION)"
for check in "${CHECKS[@]}"; do
	IFS=: read -r name resolution mod <<< "$check"
	(cd "$CONSUMER" && node "$TSC" -p "tsconfig.$name.json")
	echo "    ok  moduleResolution: \"$resolution\", module: \"$mod\""
done

echo "==> running the installed bin"
BIN="$CONSUMER/node_modules/.bin/better-auth-firebase-auth"
if [[ ! -x "$BIN" ]]; then
	echo "error: installed package exposes no better-auth-firebase-auth bin" >&2
	exit 1
fi
"$BIN" --help >/dev/null
echo "    ok  --help"

# Functional dry run against a throwaway Better Auth instance (memory adapter):
# proves config discovery, instance detection, and the adapter round trip from
# the packed artifact.
cat > "$CONSUMER/auth.mjs" <<'AUTHEOF'
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
export const auth = betterAuth({
	database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
	secret: "verify-pack-secret-verify-pack-secret",
	baseURL: "http://localhost:3000",
	logger: { level: "error" },
});
AUTHEOF
BACKFILL_OUT="$(cd "$CONSUMER" && "$BIN" backfill-account-issuers --config auth.mjs)"
if ! grep -q "0 Firebase account row(s)" <<<"$BACKFILL_OUT"; then
	echo "error: unexpected backfill dry-run output:" >&2
	echo "$BACKFILL_OUT" >&2
	exit 1
fi
echo "    ok  backfill-account-issuers dry run"

echo "==> packaging smoke test passed"
