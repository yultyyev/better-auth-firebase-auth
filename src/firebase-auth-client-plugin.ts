import type { BetterAuthClientPlugin } from "better-auth/client";
import type { firebaseAuthPlugin } from "./firebase-auth-plugin";
import type {
	AuthResponse,
	ConfirmPasswordResetRequest,
	FirebaseAuthPluginOptions,
	SendPasswordResetRequest,
	SignInWithEmailRequest,
	SignInWithGoogleRequest,
} from "./types";

type FirebaseAuthPlugin = typeof firebaseAuthPlugin;

export const firebaseAuthClientPlugin = (
	options: FirebaseAuthPluginOptions = {},
): BetterAuthClientPlugin => {
	const { serverSideOnly = false } = options;

	return {
		id: "firebase-auth",
		$InferServerPlugin: {} as ReturnType<FirebaseAuthPlugin>,
		getActions: (fetch) => {
			if (serverSideOnly) {
				return {};
			}

			return {
				async signInWithGoogle(
					data: SignInWithGoogleRequest,
					fetchOptions?: RequestInit,
				): Promise<AuthResponse> {
					return fetch("/firebase-auth/sign-in-with-google", {
						method: "POST",
						body: JSON.stringify(data),
						...fetchOptions,
					});
				},

				async signInWithEmail(
					data: SignInWithEmailRequest,
					fetchOptions?: RequestInit,
				): Promise<AuthResponse> {
					return fetch("/firebase-auth/sign-in-with-email", {
						method: "POST",
						body: JSON.stringify(data),
						...fetchOptions,
					});
				},

				async sendPasswordReset(
					data: SendPasswordResetRequest,
					fetchOptions?: RequestInit,
				): Promise<{ success: boolean; message: string }> {
					return fetch("/firebase-auth/send-password-reset", {
						method: "POST",
						body: JSON.stringify(data),
						...fetchOptions,
					});
				},

				async confirmPasswordReset(
					data: ConfirmPasswordResetRequest,
					fetchOptions?: RequestInit,
				): Promise<{ success: boolean; message: string }> {
					return fetch("/firebase-auth/confirm-password-reset", {
						method: "POST",
						body: JSON.stringify(data),
						...fetchOptions,
					});
				},
			};
		},
	};
};
