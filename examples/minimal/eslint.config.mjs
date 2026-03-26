import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import("eslint").Linter.Config[]} */
const coreWebVitals = require("eslint-config-next/core-web-vitals");
/** @type {import("eslint").Linter.Config[]} */
const typescript = require("eslint-config-next/typescript");

const config = [
	...coreWebVitals,
	...typescript,
	{
		ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
	},
];

export default config;
