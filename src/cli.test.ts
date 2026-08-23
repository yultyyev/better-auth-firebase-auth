import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { discoverConfig, parseArgs, resolveAuthExport } from "./cli.js";

describe("cli", () => {
	describe("parseArgs", () => {
		it("parses the command with defaults", () => {
			const args = parseArgs(["backfill-account-issuers"]);
			expect(args.command).toBe("backfill-account-issuers");
			expect(args.apply).toBe(false);
			expect(args.config).toBeNull();
			expect(args.help).toBe(false);
		});

		it("parses --apply, --config and --cwd", () => {
			const args = parseArgs([
				"backfill-account-issuers",
				"--apply",
				"--config",
				"lib/auth.ts",
				"--cwd",
				"/tmp/app",
			]);
			expect(args.apply).toBe(true);
			expect(args.config).toBe("lib/auth.ts");
			expect(args.cwd).toBe("/tmp/app");
		});

		it("throws on unknown flags and missing values", () => {
			expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
			expect(() => parseArgs(["--config"])).toThrow(/requires a path/);
			expect(() => parseArgs(["--cwd"])).toThrow(/requires a directory/);
		});
	});

	describe("discoverConfig", () => {
		const dir = mkdtempSync(join(tmpdir(), "bafa-cli-"));
		afterAll(() => rmSync(dir, { recursive: true, force: true }));

		it("returns null when nothing exists", () => {
			expect(discoverConfig(dir)).toBeNull();
		});

		it("finds the same locations npx auth searches", () => {
			mkdirSync(join(dir, "src/lib"), { recursive: true });
			writeFileSync(join(dir, "src/lib/auth.ts"), "");
			expect(discoverConfig(dir)).toBe(join(dir, "src/lib/auth.ts"));

			// Root-level config wins over nested ones.
			writeFileSync(join(dir, "auth.ts"), "");
			expect(discoverConfig(dir)).toBe(join(dir, "auth.ts"));
		});
	});

	describe("resolveAuthExport", () => {
		const authLike = { $context: Promise.resolve({}) };

		it("prefers the named auth export", () => {
			expect(resolveAuthExport({ auth: authLike, other: 1 })).toBe(authLike);
		});

		it("accepts a default export or any auth-shaped export", () => {
			expect(resolveAuthExport({ default: authLike })).toBe(authLike);
			expect(resolveAuthExport({ default: { auth: authLike } })).toBe(authLike);
			expect(resolveAuthExport({ whatever: authLike })).toBe(authLike);
		});

		it("returns null when nothing looks like a Better Auth instance", () => {
			expect(resolveAuthExport({ auth: { notIt: true }, x: 3 })).toBeNull();
		});
	});
});
