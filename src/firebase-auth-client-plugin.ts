import type { BetterAuthClientPlugin } from "better-auth/client";
import type { firebaseAuthPlugin } from "./firebase-auth-plugin";

type FirebaseAuthPlugin = typeof firebaseAuthPlugin;

export const firebaseAuthClientPlugin = (): BetterAuthClientPlugin => {
	return {
		id: "firebase-auth",
		$InferServerPlugin: {} as ReturnType<FirebaseAuthPlugin>,
	};
};

