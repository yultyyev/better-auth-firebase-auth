import type {
	Account,
	BetterAuthPlugin,
	GenericEndpointContext,
	User,
} from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase-admin/auth";
import type { AuthResponse, FirebaseAuthPluginOptions } from "./types.js";

/**
 * Issuer stored on Firebase-linked `account` rows.
 *
 * Better Auth >= 1.7 identifies accounts by the `(issuer, accountId)` pair and
 * requires `issuer` on every row. Firebase is not a configured OIDC provider in
 * Better Auth, so the plugin uses the synthetic issuer Better Auth derives for
 * OAuth providers without one (`createOAuthAccountIssuer("firebase")`).
 *
 * When upgrading an existing database to Better Auth 1.7, backfill this value
 * on rows where `providerId = 'firebase'` before making `issuer` NOT NULL.
 */
export const FIREBASE_ACCOUNT_ISSUER = "local:oauth:firebase";

const FIREBASE_PROVIDER_ID = "firebase";

type DecodedToken = {
	uid: string;
	email?: string | null;
	name?: string | null;
	picture?: string | null;
	email_verified?: boolean;
	phone_number?: string | null;
	exp?: number;
};

type InternalAdapter = GenericEndpointContext["context"]["internalAdapter"];

/** `internalAdapter` surface of Better Auth 1.5 – 1.6 (removed in 1.7). */
type LegacyInternalAdapter = {
	findOAuthUser: (
		email: string,
		accountId: string,
		providerId: string,
	) => Promise<{
		user: User;
		linkedAccount: Pick<Account, "id"> | null;
	} | null>;
};

/**
 * Find the Better Auth user linked to a Firebase UID.
 *
 * Better Auth >= 1.7 keys accounts by `(issuer, accountId)` and removed
 * `findOAuthUser`; 1.5 – 1.6 key them by `(providerId, accountId)`. Feature
 * detection keeps a single build working across both lines.
 */
const findFirebaseAccountOwner = async (
	internalAdapter: InternalAdapter,
	decodedToken: DecodedToken,
): Promise<{ user: User | null; account: Pick<Account, "id"> | null }> => {
	if ("findAccountOwnerByKey" in internalAdapter) {
		const owner = await internalAdapter.findAccountOwnerByKey({
			issuer: FIREBASE_ACCOUNT_ISSUER,
			accountId: decodedToken.uid,
		});
		return {
			user: owner?.kind === "owned" ? owner.user : null,
			account: owner?.account ?? null,
		};
	}

	const legacy = await (
		internalAdapter as unknown as LegacyInternalAdapter
	).findOAuthUser(
		decodedToken.email || "",
		decodedToken.uid,
		FIREBASE_PROVIDER_ID,
	);
	return {
		user: legacy?.user ?? null,
		account: legacy?.linkedAccount ?? null,
	};
};

export const createOrUpdateUser = async (
	ctx: GenericEndpointContext,
	decodedToken: DecodedToken,
	idToken: string,
	sessionExpiresInDays: number = 7,
): Promise<AuthResponse> => {
	const { internalAdapter } = ctx.context;

	const { user: linkedUser, account: existingAccount } =
		await findFirebaseAccountOwner(internalAdapter, decodedToken);
	let user = linkedUser;

	if (!user && decodedToken.email) {
		const found = await internalAdapter.findUserByEmail(decodedToken.email);
		user = found?.user ?? null;
	}

	if (!user) {
		user = await internalAdapter.createUser(
			{
				email: decodedToken.email || "",
				name: decodedToken.name || "",
				image: decodedToken.picture || undefined,
				emailVerified: decodedToken.email_verified || false,
			},
			// Provisioning source for `user.validateUserInfo` (Better Auth >= 1.7);
			// ignored by older versions.
			{
				method: "oauth",
				oauth: { providerId: FIREBASE_PROVIDER_ID, profile: decodedToken },
			},
		);
	} else {
		user = await internalAdapter.updateUser(user.id, {
			name: decodedToken.name || user.name,
			image: decodedToken.picture || user.image,
			emailVerified: decodedToken.email_verified ?? user.emailVerified,
		});
	}

	if (!existingAccount) {
		await internalAdapter.linkAccount({
			providerId: FIREBASE_PROVIDER_ID,
			issuer: FIREBASE_ACCOUNT_ISSUER,
			accountId: decodedToken.uid,
			userId: user.id,
			idToken,
			accessTokenExpiresAt: decodedToken.exp
				? new Date(decodedToken.exp * 1000)
				: undefined,
		});
	} else {
		await internalAdapter.updateAccount(existingAccount.id, {
			// Re-parent the row when its user was deleted (an "orphaned" account):
			// without this it would keep pointing at the dead user id forever. For
			// an owned account this writes the same value back.
			userId: user.id,
			idToken,
			accessTokenExpiresAt: decodedToken.exp
				? new Date(decodedToken.exp * 1000)
				: undefined,
		});
	}

	const session = await internalAdapter.createSession(user.id, undefined, {
		expiresAt: new Date(
			Date.now() + 1000 * 60 * 60 * 24 * sessionExpiresInDays,
		),
	});

	await setSessionCookie(ctx, { session, user });

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
		migrationChecks = true,
		passwordResetUrl,
		getPhoneUserFallbackEmail = ({ uid }) => `${uid}@firebase.local`,
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

		endpoints.signInWithPhone = createAuthEndpoint(
			"/firebase-auth/sign-in-with-phone",
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

				let decodedToken: DecodedToken;
				try {
					decodedToken = await adminAuth.verifyIdToken(idToken);
				} catch (error) {
					if (error instanceof Error) {
						throw new APIError("UNAUTHORIZED", {
							message: `Firebase token verification failed: ${error.message}`,
						});
					}
					throw error;
				}

				if (!decodedToken.phone_number) {
					throw new APIError("BAD_REQUEST", {
						message:
							"Firebase token does not contain a verified phone number. Ensure the token was issued by Firebase Phone Authentication.",
					});
				}

				const resolvedEmail =
					decodedToken.email ||
					getPhoneUserFallbackEmail({
						uid: decodedToken.uid,
						phoneNumber: decodedToken.phone_number,
					});

				const result = await createOrUpdateUser(
					ctx,
					{ ...decodedToken, email: resolvedEmail },
					idToken,
					sessionExpiresInDays,
				);
				return ctx.json(result);
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

		type MiddlewareCtx = Parameters<
			Parameters<typeof createAuthMiddleware>[0]
		>[0];

		const handleEmailAuth = async (ctx: MiddlewareCtx, isSignUp: boolean) => {
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
				let userCredential: Awaited<
					ReturnType<typeof createUserWithEmailAndPassword>
				>;

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
				matcher: (context) =>
					context.path?.startsWith("/sign-in/email") ?? false,
				handler: createAuthMiddleware(async (ctx) => {
					const response = await handleEmailAuth(ctx, false);
					return { response };
				}),
			},
			{
				matcher: (context) =>
					context.path?.startsWith("/sign-up/email") ?? false,
				handler: createAuthMiddleware(async (ctx) => {
					const response = await handleEmailAuth(ctx, true);
					return { response };
				}),
			},
		];
	}

	return {
		id: "firebase-auth",
		init: (ctx) => {
			if (migrationChecks) {
				// Fire and forget: never block or fail startup over a diagnostic.
				void warnIfIssuerBackfillNeeded(ctx);
			}
		},
		...(Object.keys(endpoints).length > 0 && { endpoints }),
		...(hooks.before && hooks.before.length > 0 && { hooks }),
	};
};

/**
 * Log one startup warning when Better Auth 1.7 expects `account.issuer` but
 * Firebase rows written by earlier versions still lack it — the symptom would
 * otherwise be existing users silently losing their account link on sign-in.
 * Two equality-only `count` reads; skipped on Better Auth < 1.7.
 */
const warnIfIssuerBackfillNeeded = async (ctx: {
	tables?: { account?: { fields?: Record<string, unknown> } };
	adapter: Pick<GenericEndpointContext["context"]["adapter"], "count">;
	logger?: { warn: (message: string) => void };
}): Promise<void> => {
	try {
		if (!ctx.tables?.account?.fields?.issuer) {
			return; // Better Auth < 1.7 — accounts are not keyed by issuer yet.
		}
		const providerWhere = [
			{ field: "providerId", value: FIREBASE_PROVIDER_ID },
		];
		const total = await ctx.adapter.count({
			model: "account",
			where: providerWhere,
		});
		if (total === 0) {
			return;
		}
		const stamped = await ctx.adapter.count({
			model: "account",
			where: [
				...providerWhere,
				{ field: "issuer", value: FIREBASE_ACCOUNT_ISSUER },
			],
		});
		const missing = total - stamped;
		if (missing > 0) {
			ctx.logger?.warn(
				`[better-auth-firebase-auth] ${missing} of ${total} Firebase account rows have no issuer. ` +
					`Better Auth 1.7 looks accounts up by (issuer, accountId), so those users' Firebase links are not found until backfilled. ` +
					`Run: await backfillAccountIssuers(auth) from "better-auth-firebase-auth/server" — ` +
					`or SQL: UPDATE account SET issuer = '${FIREBASE_ACCOUNT_ISSUER}' WHERE providerId = '${FIREBASE_PROVIDER_ID}'. ` +
					`Set migrationChecks: false on firebaseAuthPlugin() to silence this check.`,
			);
		}
	} catch {
		// Diagnostics must never break auth startup.
	}
};

export interface BackfillAccountIssuersResult {
	/** Firebase account rows matched by `providerId = "firebase"`. */
	total: number;
	/** Rows written (0 on a dry run). The write is idempotent. */
	updated: number;
}

/**
 * Stamp `issuer` on Firebase account rows created before Better Auth 1.7.
 *
 * Better Auth 1.7 looks accounts up by `(issuer, accountId)`; rows written by
 * earlier versions have no `issuer`, so existing users' Firebase links are not
 * found until it is set. This runs the backfill through the database adapter
 * configured on your Better Auth instance, so it works on every database
 * Better Auth supports and honors custom model/field names — no SQL required:
 *
 * ```ts
 * import { auth } from "./lib/auth";
 * import { backfillAccountIssuers } from "better-auth-firebase-auth/server";
 *
 * const { total, updated } = await backfillAccountIssuers(auth);
 * ```
 *
 * Run it after upgrading better-auth to 1.7 and after `npx auth migrate` (or
 * your ORM) added the nullable `issuer` column, and before making the column
 * NOT NULL. On Better Auth < 1.7 it throws instead of silently writing
 * nothing. Idempotent: rows already
 * stamped are written with the same value, and rows corrupted to an empty
 * string (the MySQL migration pitfall) are repaired.
 */
export const backfillAccountIssuers = async (
	auth: {
		$context: Promise<
			Pick<GenericEndpointContext["context"], "adapter" | "tables">
		>;
	},
	options?: { dryRun?: boolean },
): Promise<BackfillAccountIssuersResult> => {
	const { adapter, tables } = await auth.$context;

	// On Better Auth < 1.7 the account model has no issuer field, so the
	// adapter would silently drop the write and "succeed" without doing
	// anything. Refuse instead of lying.
	if (!tables.account?.fields?.issuer) {
		throw new Error(
			"backfillAccountIssuers requires Better Auth >= 1.7: the configured " +
				"better-auth version has no account.issuer field. Upgrade " +
				"better-auth (and add the nullable issuer column via `npx auth " +
				"migrate` or your ORM) first.",
		);
	}

	const where = [{ field: "providerId", value: FIREBASE_PROVIDER_ID }];

	const total = await adapter.count({ model: "account", where });
	if (options?.dryRun) {
		return { total, updated: 0 };
	}

	const updated =
		total === 0
			? 0
			: await adapter.updateMany({
					model: "account",
					where,
					update: { issuer: FIREBASE_ACCOUNT_ISSUER },
				});
	return { total, updated };
};
