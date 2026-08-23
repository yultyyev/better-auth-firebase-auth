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

echo "==> installing the tarball next to ${PEERS[*]}"
(cd "$CONSUMER" && npm install --no-audit --no-fund --ignore-scripts --loglevel=error "$TARBALL")

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
    "module": "$2",
    "moduleResolution": "$1",
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
write_tsconfig nodenext nodenext
write_tsconfig bundler preserve

echo "==> resolving entry points"
(cd "$CONSUMER" && node ./esm-smoke.mjs && node ./cjs-smoke.cjs)

echo "==> type-checking a consumer"
for resolution in nodenext bundler; do
	(cd "$CONSUMER" && node "$TSC" -p "tsconfig.$resolution.json")
	echo "    ok  moduleResolution: \"$resolution\""
done

echo "==> packaging smoke test passed"
