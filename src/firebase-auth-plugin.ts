import type { BetterAuthPlugin } from "better-auth";
import type { FirebaseAuthPluginOptions } from "./types";

export const firebaseAuthPlugin = (
	_options: FirebaseAuthPluginOptions,
): BetterAuthPlugin => {
	return {
		id: "firebase-auth",
	};
};

