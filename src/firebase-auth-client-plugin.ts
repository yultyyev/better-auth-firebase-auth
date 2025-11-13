import type { BetterAuthClientPlugin } from "better-auth/client";
import type { firebaseAuthPlugin } from "./firebase-auth-plugin";
import type {
	AuthResponse,
	ConfirmPasswordResetRequest,
	FirebaseAuthPluginOptions,
	SendPasswordResetRequest,
	SignInWithEmailRequest,
	SignInWithGoogleRequest,
	VerifyPasswordResetCodeRequest,
	VerifyPasswordResetCodeResponse,
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

			async verifyPasswordResetCode(
				data: VerifyPasswordResetCodeRequest,
				fetchOptions?: RequestInit,
			): Promise<VerifyPasswordResetCodeResponse> {
				return fetch("/firebase-auth/verify-password-reset-code", {
					method: "POST",
					body: JSON.stringify(data),
					...fetchOptions,
				});
			},
		};
	},
};
};

/**
 * Extract the oobCode (out-of-band code) from a URL.
 * This is used to get the password reset code from the URL query parameters
 * that Firebase appends when users click the password reset link.
 *
 * @param url - Optional URL string. If not provided, uses window.location.href
 * @returns The oobCode string if found, null otherwise
 *
 * @example
 * // URL: https://myapp.com/reset-password?oobCode=ABC123&mode=resetPassword
 * const code = extractOobCodeFromUrl();
 * console.log(code); // "ABC123"
 */
export function extractOobCodeFromUrl(url?: string): string | null {
	const urlToUse = url || (typeof window !== "undefined" ? window.location.href : "");
	
	if (!urlToUse) {
		return null;
	}

	try {
		const urlObj = new URL(urlToUse);
		return urlObj.searchParams.get("oobCode");
	} catch {
		return null;
	}
}
