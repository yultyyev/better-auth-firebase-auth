import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, APIError } from "better-auth/api";
import { getAuth } from "firebase-admin/auth";
import type { FirebaseAuthPluginOptions } from "./types";

const createOrUpdateUser = async (
	ctx: Parameters<Parameters<typeof createAuthEndpoint>[2]>[0],
	decodedToken: {
		uid: string;
		email?: string | null;
		name?: string | null;
		picture?: string | null;
		email_verified?: boolean;
		exp?: number;
	},
	idToken: string,
) => {
	const { adapter, internalAdapter } = ctx.context;

	let user = await adapter.getUser({
		email: decodedToken.email || undefined,
	});

	if (!user) {
		user = await adapter.createUser({
			email: decodedToken.email || null,
			name: decodedToken.name || null,
			image: decodedToken.picture || null,
			emailVerified: decodedToken.email_verified || false,
		});
	} else {
		user = await adapter.updateUser({
			id: user.id,
			name: decodedToken.name || user.name,
			image: decodedToken.picture || user.image,
			emailVerified: decodedToken.email_verified ?? user.emailVerified,
		});
	}

	await adapter.createAccount({
		provider: "firebase",
		providerAccountId: decodedToken.uid,
		userId: user.id,
		accessToken: idToken,
		expiresAt: decodedToken.exp ? new Date(decodedToken.exp * 1000) : null,
	});

	const session = await internalAdapter.createSession({
		userId: user.id,
		expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
	});

	return {
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			image: user.image,
		},
		session: {
			id: session.id,
			expiresAt: session.expiresAt,
			token: session.token,
		},
	};
};

export const firebaseAuthPlugin = (
	options: FirebaseAuthPluginOptions = {},
): BetterAuthPlugin => {
	const {
		useClientSideTokens = true,
		overrideEmailPasswordFlow = false,
		serverSideOnly = false,
		firebaseAdminAuth,
		firebaseConfig,
	} = options;

	const adminAuth = firebaseAdminAuth || getAuth();

	const endpoints: BetterAuthPlugin["endpoints"] = {};

	if (!serverSideOnly) {
		endpoints.signInWithGoogle = createAuthEndpoint(
			"/firebase-auth/sign-in-with-google",
			{
				method: "POST",
			},
			async (ctx) => {
				const { idToken } = ctx.body as { idToken: string };

				if (!idToken) {
					throw new APIError("BAD_REQUEST", {
						message: "idToken is required",
					});
				}

				try {
					const decodedToken = await adminAuth.verifyIdToken(idToken);
					const result = await createOrUpdateUser(ctx, decodedToken, idToken);
					return ctx.json(result);
				} catch (error) {
					if (error instanceof Error) {
						throw new APIError("UNAUTHORIZED", {
							message: `Firebase token verification failed: ${error.message}`,
						});
					}
					throw error;
				}
			},
		);

		endpoints.signInWithEmail = createAuthEndpoint(
			"/firebase-auth/sign-in-with-email",
			{
				method: "POST",
			},
			async (ctx) => {
				const body = ctx.body as
					| { idToken: string }
					| { email: string; password: string };

				let idToken: string;

				if (useClientSideTokens) {
					if (!("idToken" in body) || !body.idToken) {
						throw new APIError("BAD_REQUEST", {
							message: "idToken is required in client-side mode",
						});
					}
					idToken = body.idToken;
				} else {
					if (!("email" in body) || !("password" in body)) {
						throw new APIError("BAD_REQUEST", {
							message: "email and password are required in server-side mode",
						});
					}

					if (!firebaseConfig) {
						throw new APIError("BAD_REQUEST", {
							message: "firebaseConfig is required for server-side mode",
						});
					}

					try {
						const firebaseApp = await import("firebase/app");
						const {
							getAuth,
							signInWithEmailAndPassword,
						} = await import("firebase/auth");

						const apps = firebaseApp.getApps();
						const app =
							apps.length === 0
								? firebaseApp.initializeApp(
										firebaseConfig,
										"better-auth-firebase",
									)
								: apps[0]!;

						const auth = getAuth(app);
						const userCredential = await signInWithEmailAndPassword(
							auth,
							body.email,
							body.password,
						);
						idToken = await userCredential.user.getIdToken();
					} catch (error) {
						if (error instanceof Error) {
							throw new APIError("UNAUTHORIZED", {
								message: `Firebase authentication failed: ${error.message}`,
							});
						}
						throw error;
					}
				}

				try {
					const decodedToken = await adminAuth.verifyIdToken(idToken);
					const result = await createOrUpdateUser(ctx, decodedToken, idToken);
					return ctx.json(result);
				} catch (error) {
					if (error instanceof Error) {
						throw new APIError("UNAUTHORIZED", {
							message: `Firebase token verification failed: ${error.message}`,
						});
					}
					throw error;
				}
			},
		);

		endpoints.sendPasswordReset = createAuthEndpoint(
			"/firebase-auth/send-password-reset",
			{
				method: "POST",
			},
			async (ctx) => {
				const { email } = ctx.body as { email: string };

				if (!email) {
					throw new APIError("BAD_REQUEST", {
						message: "email is required",
					});
				}

				if (!firebaseConfig) {
					throw new APIError("BAD_REQUEST", {
						message: "firebaseConfig is required for password reset",
					});
				}

				try {
					const firebaseApp = await import("firebase/app");
					const { getAuth, sendPasswordResetEmail } = await import(
						"firebase/auth"
					);

					const apps = firebaseApp.getApps();
					const app =
						apps.length === 0
							? firebaseApp.initializeApp(
									firebaseConfig,
									"better-auth-firebase",
								)
							: apps[0]!;

					const auth = getAuth(app);
					await sendPasswordResetEmail(auth, email);

					return ctx.json({
						success: true,
						message: "Password reset email sent",
					});
				} catch (error) {
					if (error instanceof Error) {
						throw new APIError("BAD_REQUEST", {
							message: `Failed to send password reset email: ${error.message}`,
						});
					}
					throw error;
				}
			},
		);

		endpoints.confirmPasswordReset = createAuthEndpoint(
			"/firebase-auth/confirm-password-reset",
			{
				method: "POST",
			},
			async (ctx) => {
				const { oobCode, newPassword } = ctx.body as {
					oobCode: string;
					newPassword: string;
				};

				if (!oobCode || !newPassword) {
					throw new APIError("BAD_REQUEST", {
						message: "oobCode and newPassword are required",
					});
				}

				if (!firebaseConfig) {
					throw new APIError("BAD_REQUEST", {
						message: "firebaseConfig is required for password reset",
					});
				}

				try {
					const firebaseApp = await import("firebase/app");
					const { getAuth, confirmPasswordReset } = await import("firebase/auth");

					const apps = firebaseApp.getApps();
					const app =
						apps.length === 0
							? firebaseApp.initializeApp(
									firebaseConfig,
									"better-auth-firebase",
								)
							: apps[0]!;

					const auth = getAuth(app);
					await confirmPasswordReset(auth, oobCode, newPassword);

					return ctx.json({
						success: true,
						message: "Password reset confirmed",
					});
				} catch (error) {
					if (error instanceof Error) {
						throw new APIError("BAD_REQUEST", {
							message: `Failed to confirm password reset: ${error.message}`,
						});
					}
					throw error;
				}
			},
		);
	}

	return {
		id: "firebase-auth",
		...(Object.keys(endpoints).length > 0 && { endpoints }),
	};
};
