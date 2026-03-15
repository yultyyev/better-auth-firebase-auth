import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import type { FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase-admin/auth";
import type { AuthResponse, FirebaseAuthPluginOptions } from "./types";

type Context = GenericEndpointContext;

type DecodedToken = {
	uid: string;
	email?: string | null;
	name?: string | null;
	picture?: string | null;
	email_verified?: boolean;
	exp?: number;
};

const createOrUpdateUser = async (
	ctx: Context,
	decodedToken: DecodedToken,
	idToken: string,
	sessionExpiresInDays: number = 7,
): Promise<AuthResponse> => {
	const { internalAdapter } = ctx.context;

	let user = null;
	const oauthUser = await internalAdapter.findOAuthUser(
		decodedToken.email || "",
		decodedToken.uid,
		"firebase",
	);

	user = oauthUser?.user || null;
	const account = oauthUser?.linkedAccount || null;

	if (!user && decodedToken.email) {
		const existingUser = await internalAdapter.findUserByEmail(decodedToken.email);
		user = existingUser?.user || null;
	}

	if (!user) {
		user = await internalAdapter.createUser({
			email: decodedToken.email || "",
			name: decodedToken.name || "",
			image: decodedToken.picture || undefined,
			emailVerified: decodedToken.email_verified || false,
		});
	} else {
		user = await internalAdapter.updateUser(user.id, {
			name: decodedToken.name || user.name,
			image: decodedToken.picture || user.image,
			emailVerified: decodedToken.email_verified ?? user.emailVerified,
		});
	}

	if (!account) {
		await internalAdapter.linkAccount({
			providerId: "firebase",
			accountId: decodedToken.uid,
			userId: user.id,
			idToken: idToken,
			accessTokenExpiresAt: decodedToken.exp ? new Date(decodedToken.exp * 1000) : undefined,
		});
	} else {
		await internalAdapter.updateAccount(account.id, {
			idToken: idToken,
			accessTokenExpiresAt: decodedToken.exp ? new Date(decodedToken.exp * 1000) : undefined,
		});
	}

	const session = await internalAdapter.createSession(
		user.id,
		undefined,
		{
			expiresAt: new Date(
				Date.now() + 1000 * 60 * 60 * 24 * sessionExpiresInDays,
			),
		}
	);

	return {
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			image: user.image || null,
		},
		session: {
			id: session.id,
			expiresAt: session.expiresAt,
			token: session.token,
		},
	};
};

const getFirebaseApp = async (
	firebaseConfig: FirebaseOptions,
): Promise<any> => {
	const firebaseApp = await import("firebase/app");
	const apps = firebaseApp.getApps();
	return apps.length === 0
		? firebaseApp.initializeApp(firebaseConfig, "better-auth-firebase")
		: apps[0];
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
		sessionExpiresInDays = 7,
		passwordResetUrl,
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
					const result = await createOrUpdateUser(
						ctx,
						decodedToken,
						idToken,
						sessionExpiresInDays,
					);
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
						const { getAuth, signInWithEmailAndPassword } = await import(
							"firebase/auth"
						);

						const app = await getFirebaseApp(firebaseConfig);
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
					const result = await createOrUpdateUser(
						ctx,
						decodedToken,
						idToken,
						sessionExpiresInDays,
					);
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
					const { getAuth, sendPasswordResetEmail } = await import(
						"firebase/auth"
					);

					const app = await getFirebaseApp(firebaseConfig);
					const auth = getAuth(app);

					// Build actionCodeSettings if passwordResetUrl is provided
					const actionCodeSettings = passwordResetUrl
						? {
								url: passwordResetUrl,
								handleCodeInApp: true,
							}
						: undefined;

					await sendPasswordResetEmail(auth, email, actionCodeSettings);

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
					const { getAuth, confirmPasswordReset } = await import(
						"firebase/auth"
					);

					const app = await getFirebaseApp(firebaseConfig);
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

		endpoints.verifyPasswordResetCode = createAuthEndpoint(
			"/firebase-auth/verify-password-reset-code",
			{
				method: "POST",
			},
			async (ctx) => {
				const { oobCode } = ctx.body as { oobCode: string };

				if (!oobCode) {
					throw new APIError("BAD_REQUEST", {
						message: "oobCode is required",
					});
				}

				if (!firebaseConfig) {
					throw new APIError("BAD_REQUEST", {
						message:
							"firebaseConfig is required for password reset verification",
					});
				}

				try {
					const { getAuth, verifyPasswordResetCode } = await import(
						"firebase/auth"
					);

					const app = await getFirebaseApp(firebaseConfig);
					const auth = getAuth(app);
					const email = await verifyPasswordResetCode(auth, oobCode);

					return ctx.json({
						valid: true,
						email,
					});
				} catch (error) {
					if (error instanceof Error) {
						throw new APIError("BAD_REQUEST", {
							message: `Invalid or expired reset code: ${error.message}`,
						});
					}
					throw error;
				}
			},
		);
	}

	const hooks: BetterAuthPlugin["hooks"] = {};

	if (overrideEmailPasswordFlow) {
		if (!firebaseConfig) {
			throw new Error(
				"firebaseConfig is required when overrideEmailPasswordFlow is true",
			);
		}

		type MiddleWareCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

		const handleEmailAuth = async (
			ctx: MiddleWareCtx,
			isSignUp: boolean,
		) => {
			const { email, password, name } = ctx.body as {
				email: string;
				password: string;
				name?: string;
			};

			if (!email || !password) {
				throw new APIError("BAD_REQUEST", {
					message: "email and password are required",
				});
			}

			try {
				const {
					getAuth,
					signInWithEmailAndPassword,
					createUserWithEmailAndPassword,
					updateProfile,
				} = await import("firebase/auth");

				const app = await getFirebaseApp(firebaseConfig);
				const auth = getAuth(app);
				let userCredential: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>;

				if (isSignUp) {
					userCredential = await createUserWithEmailAndPassword(
						auth,
						email,
						password,
					);
					if (name) {
						await updateProfile(userCredential.user, { displayName: name });
					}
				} else {
					userCredential = await signInWithEmailAndPassword(
						auth,
						email,
						password,
					);
				}

				const idToken = await userCredential.user.getIdToken();
				const decodedToken = await adminAuth.verifyIdToken(idToken);
				const result = await createOrUpdateUser(
					ctx,
					decodedToken,
					idToken,
					sessionExpiresInDays,
				);

				return ctx.json(result);
			} catch (error) {
				if (error instanceof Error) {
					throw new APIError("UNAUTHORIZED", {
						message: `Firebase authentication failed: ${error.message}`,
					});
				}
				throw error;
			}
		};

		hooks.before = [
			{
				matcher: (context) => context.path?.startsWith("/sign-in/email") ?? false,
				handler: createAuthMiddleware(async (ctx) => {
					const response = await handleEmailAuth(ctx, false);
					return { response };
				}),
			},
			{
				matcher: (context) => context.path?.startsWith("/sign-up/email") ?? false,
				handler: createAuthMiddleware(async (ctx) => {
					const response = await handleEmailAuth(ctx, true);
					return { response };
				}),
			},
		];
	}

	return {
		id: "firebase-auth",
		...(Object.keys(endpoints).length > 0 && { endpoints }),
		...(hooks.before && hooks.before.length > 0 && { hooks }),
	};
};
