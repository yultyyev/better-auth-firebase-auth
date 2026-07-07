import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.join(process.cwd(), "../..");

const nextConfig: NextConfig = {
	reactStrictMode: true,
	turbopack: {
		root: monorepoRoot,
	},
	// Pin tracing to the monorepo root so Next resolves hoisted workspace deps.
	outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
