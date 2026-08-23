#!/usr/bin/env node
/**
 * `npx better-auth-firebase-auth backfill-account-issuers`
 *
 * Runs the Better Auth 1.7 `account.issuer` backfill for Firebase rows through
 * the database adapter configured on the app's own Better Auth instance. The
 * plugin never holds database credentials, so — like `npx auth migrate` — the
 * command locates and imports the app's auth config and uses that instance.
 *
 * Dry run by default; `--apply` writes. See `--help`.
 */
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backfillAccountIssuers } from "./firebase-auth-plugin.js";

const COMMAND = "backfill-account-issuers";

const HELP = `Usage: better-auth-firebase-auth ${COMMAND} [options]

Stamps issuer = "local:oauth:firebase" on account rows with
providerId = "firebase" that were written before Better Auth 1.7,
through the database adapter of your Better Auth instance.

Dry run by default: prints the report and writes nothing.

Options:
  --apply            Write the backfill (pause authentication writes first)
  --config <path>    Path to the file exporting your betterAuth(...) instance
                     (default: searched in the same locations as \`npx auth\`)
  --cwd <dir>        Directory to search from (default: current directory)
  -h, --help         Show this help

The config file is imported with jiti when your project has it installed
(better-auth's own CLI ships it), otherwise with Node's native TypeScript
type stripping (Node >= 22.18). If both fail, install jiti (npm i -D jiti)
or point --config at a compiled .js/.mjs module.
`;

/** Mirrors the config locations \`npx auth\` searches. */
const buildConfigCandidates = (): string[] => {
	let paths = [
		"auth.ts",
		"auth.tsx",
		"auth.js",
		"auth.jsx",
		"auth.server.js",
		"auth.server.ts",
		"auth/index.ts",
		"auth/index.tsx",
		"auth/index.js",
		"auth/index.jsx",
		"auth/index.server.js",
		"auth/index.server.ts",
	];
	paths = [
		...paths,
		...paths.map((it) => `lib/server/${it}`),
		...paths.map((it) => `server/auth/${it}`),
		...paths.map((it) => `server/${it}`),
		...paths.map((it) => `auth/${it}`),
		...paths.map((it) => `lib/${it}`),
		...paths.map((it) => `utils/${it}`),
	];
	return [
		...paths,
		...paths.map((it) => `src/${it}`),
		...paths.map((it) => `app/${it}`),
	];
};

export interface CliArgs {
	command: string | null;
	apply: boolean;
	config: string | null;
	cwd: string;
	help: boolean;
}

export const parseArgs = (argv: string[]): CliArgs => {
	const args: CliArgs = {
		command: null,
		apply: false,
		config: null,
		cwd: process.cwd(),
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			args.help = true;
		} else if (arg === "--apply") {
			args.apply = true;
		} else if (arg === "--config") {
			args.config = argv[++i] ?? null;
			if (!args.config) throw new Error("--config requires a path");
		} else if (arg === "--cwd") {
			const dir = argv[++i];
			if (!dir) throw new Error("--cwd requires a directory");
			args.cwd = dir;
		} else if (!arg.startsWith("-") && args.command === null) {
			args.command = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
};

export const discoverConfig = (cwd: string): string | null => {
	for (const candidate of buildConfigCandidates()) {
		const path = resolve(cwd, candidate);
		if (existsSync(path)) return path;
	}
	return null;
};

const loadEnv = (cwd: string): void => {
	// First file wins for a given key, matching dotenv: load .env.local first.
	for (const file of [".env.local", ".env"]) {
		try {
			process.loadEnvFile(resolve(cwd, file));
		} catch {
			// Missing file (or Node without loadEnvFile) — fine.
		}
	}
};

const loadConfigModule = async (
	path: string,
): Promise<Record<string, unknown>> => {
	let createJiti: ((id: string, opts?: object) => any) | null = null;
	try {
		// Not a dependency of this package on purpose — resolved from the app
		// when present. The indirection keeps tsc from requiring its types.
		const jitiSpecifier = "jiti";
		({ createJiti } = await import(jitiSpecifier));
	} catch {
		createJiti = null; // jiti not installed — fall back to native import.
	}
	if (createJiti) {
		const jiti = createJiti(import.meta.url, { interopDefault: false });
		return await jiti.import(path);
	}
	try {
		return await import(pathToFileURL(path).href);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "ERR_UNKNOWN_FILE_EXTENSION" || error instanceof SyntaxError) {
			throw new Error(
				`Could not import ${path} with Node ${process.version} directly. ` +
					"Native TypeScript imports need Node >= 22.18; install jiti " +
					"(npm i -D jiti) and re-run, or pass --config with a compiled " +
					".js/.mjs module.",
				{ cause: error },
			);
		}
		throw error;
	}
};

type AuthLike = Parameters<typeof backfillAccountIssuers>[0];

const looksLikeAuth = (value: unknown): value is AuthLike =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { $context?: { then?: unknown } }).$context?.then ===
		"function";

export const resolveAuthExport = (
	mod: Record<string, unknown>,
): AuthLike | null => {
	if (looksLikeAuth(mod.auth)) return mod.auth;
	if (looksLikeAuth(mod.default)) return mod.default;
	const nested = (mod.default as Record<string, unknown> | undefined)?.auth;
	if (looksLikeAuth(nested)) return nested;
	for (const value of Object.values(mod)) {
		if (looksLikeAuth(value)) return value;
	}
	return null;
};

const fail = (message: string): never => {
	console.error(`error: ${message}`);
	process.exit(1);
};

export const run = async (argv: string[]): Promise<void> => {
	let args: CliArgs;
	try {
		args = parseArgs(argv);
	} catch (error) {
		fail((error as Error).message);
		return;
	}
	if (args.help || args.command === null) {
		console.log(HELP);
		process.exit(args.help ? 0 : 1);
	}
	if (args.command !== COMMAND) {
		fail(`Unknown command "${args.command}". Only "${COMMAND}" is available.`);
	}

	const cwd = resolve(args.cwd);
	loadEnv(cwd);

	const configPath = args.config
		? resolve(cwd, args.config)
		: discoverConfig(cwd);
	if (!configPath || !existsSync(configPath)) {
		fail(
			args.config
				? `Config not found: ${args.config}`
				: `No Better Auth config found under ${cwd}. Pass --config <path> ` +
						"to the file that exports your betterAuth(...) instance.",
		);
		return;
	}
	console.log(`==> using ${configPath}`);

	const mod = await loadConfigModule(configPath);
	const auth = resolveAuthExport(mod);
	if (!auth) {
		fail(
			`${configPath} does not export a Better Auth instance. Export it as ` +
				"`export const auth = betterAuth({ ... })` (or default).",
		);
		return;
	}

	const report = await backfillAccountIssuers(auth, { dryRun: true });
	console.log(
		`==> ${report.total} Firebase account row(s); ${report.missing} missing issuer`,
	);

	if (!args.apply) {
		console.log(
			report.missing === 0
				? "Nothing to do."
				: `Dry run — nothing written. Re-run with --apply to stamp ${report.missing} row(s).`,
		);
		process.exit(0);
	}

	const result = await backfillAccountIssuers(auth);
	const after = await backfillAccountIssuers(auth, { dryRun: true });
	console.log(
		`==> stamped issuer on ${result.updated} row(s); ${after.missing} still missing`,
	);
	process.exit(after.missing === 0 ? 0 : 1);
};

const isDirectRun = (): boolean => {
	if (!process.argv[1]) return false;
	try {
		// npm/pnpm expose the bin through a symlink; compare real paths.
		return (
			realpathSync(process.argv[1]) ===
			realpathSync(fileURLToPath(import.meta.url))
		);
	} catch {
		return false;
	}
};

if (isDirectRun()) {
	run(process.argv.slice(2)).catch((error) => {
		console.error(`error: ${(error as Error).message}`);
		process.exit(1);
	});
}
