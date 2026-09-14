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
 * Better Auth 1.7.0 – 1.7.2 identify accounts by the `(issuer, accountId)`
 * pair and require `issuer` on every row. Firebase is not a configured OIDC
 * provider in Better Auth, so the plugin uses the synthetic issuer Better Auth
 * derives for OAuth providers without one (`createOAuthAccountIssuer("firebase")`).
 * 1.5 – 1.6 and 1.7.3+ key accounts by `(providerId, accountId)` and have no
 * `issuer` field, so the plugin writes it only on 1.7.0 – 1.7.2.
 *
 * When upgrading an existing database to Better Auth 1.7.0 – 1.7.2, backfill
 * this value on rows where `providerId = 'firebase'` before making `issuer`
 * NOT NULL.
 */
export const FIREBASE_ACCOUNT_ISSUER = "local:oauth:firebase";

const FIREBASE_PROVIDER_ID = "firebase";

/**
 * Whether the configured Better Auth version keys accounts by
 * `(issuer, accountId)`. Only 1.7.0 – 1.7.2 declare `account.issuer`;
 * 1.5 – 1.6 and 1.7.3+ key accounts by `(providerId, accountId)`.
 */
const accountsKeyedByIssuer = (tables?: {
	account?: { fields?: Record<string, unknown> };
}): boolean => Boolean(tables?.account?.fields?.issuer);

type DecodedToken = {
	uid: string;
	email?: string | null;
	name?: string | null;
	picture?: string | null;
	email_verified?: boolean;
	phone_number?: string | null;
	exp?: number;
	aud?: string;
	iss?: string;
	firebase?: { tenant?: string };
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
		linkedAccount: Pick<Account, "id" | "userId"> | null;
	} | null>;
};

/**
 * `findAccountOwnerByKey` of Better Auth 1.7.0 – 1.7.2, which key accounts by
 * `(issuer, accountId)`; 1.7.3 went back to `(providerId, accountId)`.
 */
type IssuerKeyedInternalAdapter = {
	findAccountOwnerByKey: (key: {
		issuer: string;
		accountId: string;
	}) => ReturnType<InternalAdapter["findAccountOwnerByKey"]>;
};

/**
 * Find the Better Auth user linked to a Firebase UID.
 *
 * Better Auth 1.7 replaced `findOAuthUser` with `findAccountOwnerByKey`, keyed
 * by `(issuer, accountId)` on 1.7.0 – 1.7.2 and by `(providerId, accountId)`
 * from 1.7.3, as on 1.5 – 1.6. Feature detection keeps a single build working
 * across all three.
 */
const findFirebaseAccountOwner = async (
	internalAdapter: InternalAdapter,
	decodedToken: DecodedToken,
	keyedByIssuer: boolean,
): Promise<{ user: User | null; account: Pick<Account, "id"> | null }> => {
	if ("findAccountOwnerByKey" in internalAdapter) {
		const owner = keyedByIssuer
			? await (
					internalAdapter as unknown as IssuerKeyedInternalAdapter
				).findAccountOwnerByKey({
					issuer: FIREBASE_ACCOUNT_ISSUER,
					accountId: decodedToken.uid,
				})
			: await internalAdapter.findAccountOwnerByKey({
					providerId: FIREBASE_PROVIDER_ID,
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
	if (!legacy) {
		return { user: null, account: null };
	}
	// findOAuthUser also returns a user matched only by email: with no account
	// for the UID, or with an orphaned one. That user counts as linked only when
	// it owns the account, or owns another row for the same UID: a user deleted
	// without cascading (e.g. on Firestore) leaves its row, and the UID's next
	// sign-in adds a new user with a second row. Any other email match goes
	// through createOrUpdateUser's verified-email check.
	const owned =
		legacy.linkedAccount?.userId === legacy.user.id ||
		(legacy.linkedAccount !== null &&
			(
				await (internalAdapter as InternalAdapter).findAccounts(legacy.user.id)
			).some(
				(account) =>
					account.providerId === FIREBASE_PROVIDER_ID &&
					account.accountId === decodedToken.uid,
			));
	return {
		user: owned ? legacy.user : null,
		account: legacy.linkedAccount,
	};
};

/**
 * Firebase Admin's user lookup, used to tell whether a Firebase user still
 * exists. An instance scoped to an Identity Platform tenant has `tenantId`.
 */
type FirebaseUserLookup = {
	getUser: (uid: string) => Promise<unknown>;
	tenantId?: string | null;
};

/**
 * The claims of a Firebase ID token the plugin stored on an account row after
 * verifying it. They aren't verified again: the token has long expired.
 */
const claimsOfStoredIdToken = (
	idToken: string | null | undefined,
): Record<string, unknown> | undefined => {
	try {
		const payload = idToken?.split(".")[1];
		const claims: unknown = payload
			? JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
			: undefined;
		return claims !== null && typeof claims === "object"
			? (claims as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
};

/**
 * Whether a user matched only by a phone sign-in's fallback email is that phone
 * number's own earlier account, e.g. after its Firebase user was deleted and the
 * number signed up again under a new UID. Nobody can verify a fallback email,
 * so the phone number has to tie the two together. Every account on the user
 * must be a Firebase account whose stored ID token is this project's token for
 * that UID and carried the same number, and whose Firebase user no longer
 * exists. A password account, a token for another project, UID or number, or
 * a Firebase user that still exists could belong to whoever registered the
 * address first.
 */
const isEarlierAccountOfPhoneNumber = async (
	internalAdapter: InternalAdapter,
	firebaseAdminAuth: FirebaseUserLookup,
	userId: string,
	decodedToken: DecodedToken,
): Promise<boolean> => {
	const tenant = decodedToken.firebase?.tenant ?? null;
	if (
		!decodedToken.phone_number ||
		!decodedToken.aud ||
		!decodedToken.iss ||
		// getUser only sees the users of the tenant (or project) it's scoped to.
		tenant !== (firebaseAdminAuth.tenantId ?? null)
	) {
		return false;
	}
	const accounts = await internalAdapter.findAccounts(userId);
	const isEarlierTokenOfNumber = (account: Account) => {
		const claims = claimsOfStoredIdToken(account.idToken);
		return (
			account.providerId === FIREBASE_PROVIDER_ID &&
			claims?.sub === account.accountId &&
			claims.aud === decodedToken.aud &&
			claims.iss === decodedToken.iss &&
			claims.phone_number === decodedToken.phone_number &&
			((claims.firebase as { tenant?: unknown } | undefined)?.tenant ??
				null) === tenant
		);
	};
	if (accounts.length === 0 || !accounts.every(isEarlierTokenOfNumber)) {
		return false;
	}
	for (const account of accounts) {
		try {
			await firebaseAdminAuth.getUser(account.accountId);
			// Still exists, so it's someone's current Firebase user, not a past one.
			return false;
		} catch (error) {
			if (
				(error as { code?: unknown } | null)?.code !== "auth/user-not-found"
			) {
				return false;
			}
		}
	}
	return true;
};

export const createOrUpdateUser = async (
	ctx: GenericEndpointContext,
	decodedToken: DecodedToken,
	idToken: string,
	sessionExpiresInDays: number = 7,
	// Set by sign-in-with-phone when `decodedToken.email` came from
	// `getPhoneUserFallbackEmail` because the token carried no email.
	phoneFallbackEmail?: { firebaseAdminAuth: FirebaseUserLookup },
): Promise<AuthResponse> => {
	const { internalAdapter } = ctx.context;
	const keyedByIssuer = accountsKeyedByIssuer(ctx.context.tables);

	const { user: linkedUser, account: existingAccount } =
		await findFirebaseAccountOwner(
			internalAdapter,
			decodedToken,
			keyedByIssuer,
		);
	let user = linkedUser;

	if (!user && decodedToken.email) {
		const found = await internalAdapter.findUserByEmail(decodedToken.email);
		if (found?.user) {
			// A fallback email can't be verified, but the phone number can show the
			// match is that number's own earlier account.
			const provenByPhoneNumber =
				phoneFallbackEmail !== undefined &&
				(await isEarlierAccountOfPhoneNumber(
					internalAdapter,
					phoneFallbackEmail.firebaseAdminAuth,
					found.user.id,
					decodedToken,
				));
			// SECURITY: never attach a Firebase identity to an existing account
			// unless the token proves control of the email. Firebase ID tokens can
			// be minted for ANY address via the public Identity Toolkit signUp
			// (email_verified=false); matching one onto an existing user and then
			// linkAccount()+createSession() below is an account-takeover primitive,
			// and it also bypasses Better Auth's own account-linking verification.
			if (!provenByPhoneNumber && decodedToken.email_verified !== true) {
				throw new APIError("UNAUTHORIZED", {
					message:
						"Verify your email address before signing in with this method.",
				});
			}
			// The existing user must have proven the address too. Otherwise whoever
			// registered it first, e.g. with an unverified token, keeps access to the
			// account the real owner is linked into (pre-account hijacking). Same
			// default and opt-out as Better Auth's own account linking.
			const requireLocalEmailVerified =
				ctx.context.options?.account?.accountLinking
					?.requireLocalEmailVerified ?? true;
			if (
				!provenByPhoneNumber &&
				requireLocalEmailVerified &&
				!found.user.emailVerified
			) {
				throw new APIError("UNAUTHORIZED", {
					message:
						"Verify the email address of the existing account before signing in with this method.",
				});
			}
			if (provenByPhoneNumber) {
				// The number can have changed hands since that account last signed in:
				// end the sessions its earlier Firebase users opened.
				const sessions = await internalAdapter.listSessions(found.user.id);
				if (sessions.length > 0) {
					await internalAdapter.deleteSessions(sessions.map((s) => s.token));
				}
			}
			user = found.user;
		}
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
		// Only a token for the stored address may verify it: a Firebase account
		// whose email changed must not mark the old address as verified.
		const emailVerified =
			decodedToken.email?.toLowerCase() === user.email?.toLowerCase()
				? (decodedToken.email_verified ?? user.emailVerified)
				: user.emailVerified;
		if (emailVerified && !user.emailVerified) {
			// First proof that this user owns the address: end sessions opened
			// before it, e.g. by whoever registered it unverified. Firebase likewise
			// removes an unverified sign-in method from the user and invalidates its
			// own sessions once the address is proven; the plugin's would survive.
			const sessions = await internalAdapter.listSessions(user.id);
			if (sessions.length > 0) {
				await internalAdapter.deleteSessions(sessions.map((s) => s.token));
			}
		}
		user = await internalAdapter.updateUser(user.id, {
			name: decodedToken.name || user.name,
			image: decodedToken.picture || user.image,
			emailVerified,
		});
	}

	if (!existingAccount) {
		await internalAdapter.linkAccount({
			providerId: FIREBASE_PROVIDER_ID,
			// Only Better Auth 1.7.0 – 1.7.2 have (and require) account.issuer.
			...(keyedByIssuer && { issuer: FIREBASE_ACCOUNT_ISSUER }),
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
					decodedToken.email ? undefined : { firebaseAdminAuth: adminAuth },
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
 * Log one startup warning when Better Auth 1.7.0 – 1.7.2 expect
 * `account.issuer` but Firebase rows written by earlier versions still lack
 * it — the symptom would otherwise be existing users silently losing their
 * account link on sign-in. Two equality-only `count` reads; skipped on
 * Better Auth 1.5 – 1.6 and 1.7.3+, which key accounts by
 * `(providerId, accountId)`.
 */
const warnIfIssuerBackfillNeeded = async (ctx: {
	tables?: { account?: { fields?: Record<string, unknown> } };
	adapter: Pick<GenericEndpointContext["context"]["adapter"], "count">;
	logger?: { warn: (message: string) => void };
}): Promise<void> => {
	try {
		if (!accountsKeyedByIssuer(ctx.tables)) {
			return; // 1.5 – 1.6 and 1.7.3+ key accounts by (providerId, accountId).
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
					`Better Auth 1.7.0 – 1.7.2 look accounts up by (issuer, accountId), so those users' Firebase links are not found until backfilled. ` +
					`Upgrade better-auth to >= 1.7.3, which keys accounts by (providerId, accountId) again and needs no backfill, ` +
					`or run: npx better-auth-firebase-auth backfill-account-issuers --apply — ` +
					`or await backfillAccountIssuers(auth) from "better-auth-firebase-auth/server" — ` +
					`or SQL: UPDATE account SET issuer = '${FIREBASE_ACCOUNT_ISSUER}' WHERE providerId = '${FIREBASE_PROVIDER_ID}'. ` +
					`Details: https://github.com/yultyyev/better-auth-firebase-auth#upgrading-an-existing-app-to-better-auth-17. ` +
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
	/** Rows whose `issuer` is not `FIREBASE_ACCOUNT_ISSUER` yet. */
	missing: number;
	/** Rows written (0 on a dry run). The write is idempotent. */
	updated: number;
	/**
	 * Whether the configured Better Auth version requires `account.issuer`
	 * (1.7.0 – 1.7.2). `false` on 1.5 – 1.6 and 1.7.3+, which key accounts by
	 * `(providerId, accountId)`: no backfill is needed, so `missing` and
	 * `updated` are 0 and nothing is written.
	 */
	issuerRequired: boolean;
}

/**
 * Stamp `issuer` on Firebase account rows created before Better Auth 1.7.
 *
 * Better Auth 1.7.0 – 1.7.2 look accounts up by `(issuer, accountId)`; rows
 * written by earlier versions have no `issuer`, so existing users' Firebase
 * links are not found until it is set. This runs the backfill through the
 * database adapter configured on your Better Auth instance, so it works on
 * every database Better Auth supports and honors custom model/field names —
 * no SQL required:
 *
 * ```ts
 * import { auth } from "./lib/auth";
 * import { backfillAccountIssuers } from "better-auth-firebase-auth/server";
 *
 * const { total, updated } = await backfillAccountIssuers(auth);
 * ```
 *
 * Run it after upgrading better-auth to 1.7.0 – 1.7.2 and after `npx auth
 * migrate` (or your ORM) added the nullable `issuer` column, and before making
 * the column NOT NULL. Better Auth 1.5 – 1.6 and 1.7.3+ key accounts by
 * `(providerId, accountId)` and need no backfill: there it writes nothing and
 * returns `issuerRequired: false`. Idempotent: rows already
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

	const where = [{ field: "providerId", value: FIREBASE_PROVIDER_ID }];

	const total = await adapter.count({ model: "account", where });

	// Without the field the adapter would drop the write anyway, and no row
	// needs an issuer: accounts are keyed by (providerId, accountId).
	if (!accountsKeyedByIssuer(tables)) {
		return { total, missing: 0, updated: 0, issuerRequired: false };
	}

	const stamped =
		total === 0
			? 0
			: await adapter.count({
					model: "account",
					where: [
						...where,
						{ field: "issuer", value: FIREBASE_ACCOUNT_ISSUER },
					],
				});
	const missing = total - stamped;
	if (options?.dryRun) {
		return { total, missing, updated: 0, issuerRequired: true };
	}

	const updated =
		total === 0
			? 0
			: await adapter.updateMany({
					model: "account",
					where,
					update: { issuer: FIREBASE_ACCOUNT_ISSUER },
				});
	return { total, missing, updated, issuerRequired: true };
};
