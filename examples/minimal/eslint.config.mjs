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
		// eslint-plugin-react's "detect" calls context.getFilename(), which
		// ESLint 10 removed; read the installed React version directly instead.
		settings: { react: { version: require("react/package.json").version } },
	},
	{
		ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
	},
];

export default config;
