import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// App lives under the plugin repo; pin tracing to this folder so Next does not
	// treat the repository root as the deployment root.
	outputFileTracingRoot: path.join(process.cwd()),
};

export default nextConfig;
