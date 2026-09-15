import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
	confirmPasswordReset,
	createUserWithEmailAndPassword,
	sendPasswordResetEmail,
	signInWithEmailAndPassword,
	verifyPasswordResetCode,
} from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	backfillAccountIssuers,
	createOrUpdateUser,
	FIREBASE_ACCOUNT_ISSUER,
	firebaseAuthPlugin,
} from "./firebase-auth-plugin.js";

vi.mock("firebase-admin/auth", () => ({
	getAuth: vi.fn(() => ({
		verifyIdToken: vi.fn(),
	})),
}));

vi.mock("firebase/app", () => ({
	initializeApp: vi.fn(() => ({ name: "better-auth-firebase" })),
	getApps: vi.fn(() => []),
}));

vi.mock("firebase/auth", () => ({
	getAuth: vi.fn(() => ({})),
	signInWithEmailAndPassword: vi.fn(),
	createUserWithEmailAndPassword: vi.fn(),
	sendPasswordResetEmail: vi.fn(),
	confirmPasswordReset: vi.fn(),
	verifyPasswordResetCode: vi.fn(),
	updateProfile: vi.fn(),
}));

vi.mock("better-auth/cookies", () => ({
	setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

/** An unsigned JWT with `claims`, standing in for a Firebase ID token the mocked verifyIdToken accepts. */
const idTokenWithClaims = (claims: Record<string, unknown>) =>
	`e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

/** The error Firebase Admin's getUser throws for a user that doesn't exist. */
const userNotFound = () =>
	Object.assign(
		new Error(
			"There is no user record corresponding to the provided identifier.",
		),
		{ code: "auth/user-not-found" },
	);

/** An error as the Firebase client SDK throws it, e.g. for "auth/user-not-found". */
const firebaseClientError = (code: string) =>
	Object.assign(new Error(`Firebase: Error (${code}).`), {
		name: "FirebaseError",
		code,
	});

/** What the plugin logs of a `firebaseClientError(code)`. */
const loggedFirebaseClientError = (code: string) => ({
	name: "FirebaseError",
	code,
	message: `Firebase: Error (${code}).`,
});

/** The `aud` and `iss` of this test project's Firebase ID tokens. */
const firebaseProject = {
	aud: "test-project",
	iss: "https://securetoken.google.com/test-project",
};

/**
 * Stands in for the @better-auth/sso and @better-auth/scim endpoints that can
 * claim a providerId or issuer, recording which ones a request reached.
 */
const foreignProviderEndpointsStub = (reached: (path: string) => void) => {
	const stub = (path: string) =>
		createAuthEndpoint(path, { method: "POST" }, async (ctx) => {
			reached(path);
			return ctx.json({ ok: true });
		});
	return {
		id: "foreign-provider-endpoints-stub",
		endpoints: {
			registerSSOProvider: stub("/sso/register"),
			updateSSOProvider: stub("/sso/update-provider"),
			generateSCIMToken: stub("/scim/generate-token"),
		},
	};
};

describe("firebaseAuthPlugin", () => {
	const mockAdminAuth = {
		verifyIdToken: vi.fn(),
		getUser: vi.fn(),
	};

	const mockInternalAdapter = {
		findOAuthUser: vi.fn(),
		findUserByEmail: vi.fn(),
		findUserById: vi.fn(),
		createUser: vi.fn(),
		updateUser: vi.fn(),
		createSession: vi.fn(),
		linkAccount: vi.fn(),
		updateAccount: vi.fn(),
		listSessions: vi.fn(),
		deleteSessions: vi.fn(),
		findAccounts: vi.fn(),
		findAccountByProviderId: vi.fn(),
	};

	const mockDecodedToken = {
		uid: "firebase-uid-123",
		email: "test@example.com",
		name: "Test User",
		picture: "https://example.com/photo.jpg",
		email_verified: true,
		exp: Math.floor(Date.now() / 1000) + 3600,
	};

	const mockUser = {
		id: "user-123",
		email: "test@example.com",
		name: "Test User",
		image: "https://example.com/photo.jpg",
		emailVerified: true,
	};

	const mockSession = {
		id: "session-123",
		expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
		token: "session-token-123",
	};

	const mockAccount = {
		id: "account-456",
		providerId: "firebase",
		accountId: "firebase-uid-123",
		userId: "user-123",
	};

	const createMockCtx = () => ({
		context: {
			internalAdapter: mockInternalAdapter,
		},
		body: {},
		json: vi.fn((data: any) =>
			Promise.resolve(new Response(JSON.stringify(data))),
		),
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockInternalAdapter.findOAuthUser.mockResolvedValue(null);
		mockInternalAdapter.findUserByEmail.mockResolvedValue(null);
		mockInternalAdapter.findUserById.mockResolvedValue(null);
		mockInternalAdapter.createUser.mockResolvedValue(mockUser);
		mockInternalAdapter.updateUser.mockResolvedValue(mockUser);
		mockInternalAdapter.linkAccount.mockResolvedValue(mockAccount);
		mockInternalAdapter.updateAccount.mockResolvedValue(mockAccount);
		mockInternalAdapter.listSessions.mockResolvedValue([]);
		mockInternalAdapter.deleteSessions.mockResolvedValue(undefined);
		mockInternalAdapter.findAccounts.mockResolvedValue([]);
		mockInternalAdapter.findAccountByProviderId.mockResolvedValue(null);
		mockInternalAdapter.createSession.mockResolvedValue(mockSession);
		mockAdminAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);
		mockAdminAuth.getUser.mockResolvedValue({});
		vi.mocked(setSessionCookie).mockResolvedValue(undefined);
	});

	// ─── Plugin Initialization ───────────────────────────────────────────

	describe("plugin initialization", () => {
		it("should create plugin with default options", () => {
			const plugin = firebaseAuthPlugin();
			expect(plugin.id).toBe("firebase-auth");
			expect(plugin.endpoints).toBeDefined();
		});

		it("should not register endpoints when serverSideOnly is true", () => {
			const plugin = firebaseAuthPlugin({ serverSideOnly: true });
			expect(plugin.endpoints).toBeUndefined();
		});

		it("should register all endpoints when serverSideOnly is false", () => {
			const plugin = firebaseAuthPlugin({ serverSideOnly: false });
			expect(plugin.endpoints).toBeDefined();
			expect(plugin.endpoints?.signInWithGoogle).toBeDefined();
			expect(plugin.endpoints?.signInWithEmail).toBeDefined();
			expect(plugin.endpoints?.signInWithPhone).toBeDefined();
			expect(plugin.endpoints?.sendPasswordReset).toBeDefined();
			expect(plugin.endpoints?.confirmPasswordReset).toBeDefined();
			expect(plugin.endpoints?.verifyPasswordResetCode).toBeDefined();
		});

		it("should throw error when overrideEmailPasswordFlow is true without firebaseConfig", () => {
			expect(() => {
				firebaseAuthPlugin({
					overrideEmailPasswordFlow: true,
				});
			}).toThrow(
				"firebaseConfig is required when overrideEmailPasswordFlow is true",
			);
		});

		it("should register only the provider account-key guard when overrideEmailPasswordFlow is false", () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: false,
			});
			expect(plugin.hooks?.before).toHaveLength(1);
			expect(
				plugin.hooks?.before?.[0]?.matcher({ path: "/sso/register" } as any),
			).toBe(true);
		});

		it("should register hooks when overrideEmailPasswordFlow is true with config", () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: true,
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});
			expect(plugin.hooks).toBeDefined();
			expect(plugin.hooks?.before).toBeDefined();
			expect(plugin.hooks?.before?.length).toBe(3);
		});
	});

	// ─── createOrUpdateUser ──────────────────────────────────────────────

	describe("createOrUpdateUser", () => {
		describe("new user (no existing OAuth or email match)", () => {
			it("should look up the Firebase account via findOAuthUser (better-auth < 1.7)", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.findOAuthUser).toHaveBeenCalledWith(
					"test@example.com",
					"firebase-uid-123",
					"firebase",
				);
			});

			it("should create a new user with correct fields", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.createUser).toHaveBeenCalledWith(
					{
						email: "test@example.com",
						name: "Test User",
						image: "https://example.com/photo.jpg",
						emailVerified: true,
					},
					{
						method: "oauth",
						oauth: { providerId: "firebase", profile: mockDecodedToken },
					},
				);
			});

			it("should link a new account with correct field names", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledWith({
					providerId: "firebase",
					accountId: "firebase-uid-123",
					userId: "user-123",
					idToken: "id-token-abc",
					accessTokenExpiresAt: expect.any(Date),
				});
				expect(mockInternalAdapter.updateAccount).not.toHaveBeenCalled();
			});

			it("should create session with positional args (userId, undefined, override)", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.createSession).toHaveBeenCalledWith(
					"user-123",
					undefined,
					{ expiresAt: expect.any(Date) },
				);

				const sessionArgs = mockInternalAdapter.createSession.mock.calls[0];
				expect(sessionArgs[0]).toBe("user-123");
				expect(sessionArgs[1]).toBeUndefined();
				expect(sessionArgs[2].expiresAt).toBeInstanceOf(Date);
			});

			it("should call setSessionCookie with session and user after creating session", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(setSessionCookie).toHaveBeenCalledOnce();
				expect(setSessionCookie).toHaveBeenCalledWith(ctx, {
					session: mockSession,
					user: mockUser,
				});
			});

			it("should return correct response shape", async () => {
				const ctx = createMockCtx();
				const result = await createOrUpdateUser(
					ctx as any,
					mockDecodedToken,
					"id-token-abc",
				);

				expect(result).toEqual({
					user: {
						id: "user-123",
						email: "test@example.com",
						name: "Test User",
						image: "https://example.com/photo.jpg",
					},
					session: {
						id: "session-123",
						expiresAt: mockSession.expiresAt,
						token: "session-token-123",
					},
				});
			});
		});

		describe("existing user found via OAuth account", () => {
			beforeEach(() => {
				mockInternalAdapter.findOAuthUser.mockResolvedValue({
					user: mockUser,
					linkedAccount: mockAccount,
					accounts: [mockAccount],
				});
			});

			it("should NOT call findUserByEmail when OAuth match found", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.findUserByEmail).not.toHaveBeenCalled();
			});

			it("should NOT create a new user", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
			});

			it("should update existing user with positional args (userId, data)", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.updateUser).toHaveBeenCalledWith(
					"user-123",
					{
						name: "Test User",
						image: "https://example.com/photo.jpg",
						emailVerified: true,
					},
				);
			});

			it("should update existing account (not link new)", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.linkAccount).not.toHaveBeenCalled();
				expect(mockInternalAdapter.updateAccount).toHaveBeenCalledWith(
					"account-456",
					{
						userId: "user-123",
						idToken: "id-token-abc",
						accessTokenExpiresAt: expect.any(Date),
					},
				);
			});
		});

		describe("existing user found via email (no OAuth link yet)", () => {
			beforeEach(() => {
				mockInternalAdapter.findOAuthUser.mockResolvedValue(null);
				mockInternalAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});
			});

			it("should call findUserByEmail as fallback", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.findUserByEmail).toHaveBeenCalledWith(
					"test@example.com",
				);
			});

			it("should update (not create) the user", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
				expect(mockInternalAdapter.updateUser).toHaveBeenCalledWith(
					"user-123",
					expect.any(Object),
				);
			});

			it("should link new Firebase account to the existing user", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledWith({
					providerId: "firebase",
					accountId: "firebase-uid-123",
					userId: "user-123",
					idToken: "id-token-abc",
					accessTokenExpiresAt: expect.any(Date),
				});
			});
		});

		describe("better-auth >= 1.7 adapter (findAccountOwnerByKey)", () => {
			// 1.7 removed findOAuthUser. 1.7.3+ key accounts by (providerId,
			// accountId); 1.7.0 – 1.7.2 by (issuer, accountId).
			const { findOAuthUser: _legacy, ...modernMethods } = mockInternalAdapter;
			const modernAdapter = {
				...modernMethods,
				findAccountOwnerByKey: vi.fn(),
			};
			const createModernCtx = () => ({
				context: { internalAdapter: modernAdapter },
				body: {},
				json: vi.fn((data: any) =>
					Promise.resolve(new Response(JSON.stringify(data))),
				),
			});
			// 1.7.0 – 1.7.2 declare a required account.issuer field.
			const createIssuerKeyedCtx = () => ({
				...createModernCtx(),
				context: {
					internalAdapter: modernAdapter,
					tables: { account: { fields: { issuer: { type: "string" } } } },
				},
			});

			beforeEach(() => {
				modernAdapter.findAccountOwnerByKey.mockResolvedValue(null);
			});

			it("should look up the account by providerId + accountId and never call findOAuthUser (1.7.3+)", async () => {
				await createOrUpdateUser(
					createModernCtx() as any,
					mockDecodedToken,
					"id-token-abc",
				);

				expect(modernAdapter.findAccountOwnerByKey).toHaveBeenCalledWith({
					providerId: "firebase",
					accountId: "firebase-uid-123",
				});
				expect(mockInternalAdapter.findOAuthUser).not.toHaveBeenCalled();
			});

			it("should look up by issuer + accountId and link with issuer when the schema has account.issuer (1.7.0 – 1.7.2)", async () => {
				await createOrUpdateUser(
					createIssuerKeyedCtx() as any,
					mockDecodedToken,
					"id-token-abc",
				);

				expect(modernAdapter.findAccountOwnerByKey).toHaveBeenCalledWith({
					issuer: FIREBASE_ACCOUNT_ISSUER,
					accountId: "firebase-uid-123",
				});
				expect(FIREBASE_ACCOUNT_ISSUER).toBe("local:oauth:firebase");
				expect(modernAdapter.linkAccount).toHaveBeenCalledWith({
					providerId: "firebase",
					issuer: FIREBASE_ACCOUNT_ISSUER,
					accountId: "firebase-uid-123",
					userId: "user-123",
					idToken: "id-token-abc",
					accessTokenExpiresAt: expect.any(Date),
				});
			});

			it("should create the user with a provisioning source and link without issuer when no account exists (1.7.3+)", async () => {
				await createOrUpdateUser(
					createModernCtx() as any,
					mockDecodedToken,
					"id-token-abc",
				);

				expect(modernAdapter.findUserByEmail).toHaveBeenCalledWith(
					"test@example.com",
				);
				expect(modernAdapter.createUser).toHaveBeenCalledWith(
					expect.objectContaining({ email: "test@example.com" }),
					{
						method: "oauth",
						oauth: { providerId: "firebase", profile: mockDecodedToken },
					},
				);
				expect(modernAdapter.linkAccount).toHaveBeenCalledWith({
					providerId: "firebase",
					accountId: "firebase-uid-123",
					userId: "user-123",
					idToken: "id-token-abc",
					accessTokenExpiresAt: expect.any(Date),
				});
			});

			it("should reuse the owner when the account is owned", async () => {
				modernAdapter.findAccountOwnerByKey.mockResolvedValue({
					kind: "owned",
					user: mockUser,
					account: mockAccount,
				});

				await createOrUpdateUser(
					createModernCtx() as any,
					mockDecodedToken,
					"id-token-abc",
				);

				expect(modernAdapter.findUserByEmail).not.toHaveBeenCalled();
				expect(modernAdapter.createUser).not.toHaveBeenCalled();
				expect(modernAdapter.updateUser).toHaveBeenCalledWith(
					"user-123",
					expect.any(Object),
				);
				expect(modernAdapter.linkAccount).not.toHaveBeenCalled();
				expect(modernAdapter.updateAccount).toHaveBeenCalledWith(
					"account-456",
					expect.objectContaining({ idToken: "id-token-abc" }),
				);
			});

			it("should fall back to email lookup when the account is orphaned", async () => {
				modernAdapter.findAccountOwnerByKey.mockResolvedValue({
					kind: "orphaned",
					account: mockAccount,
				});
				modernAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});

				await createOrUpdateUser(
					createModernCtx() as any,
					mockDecodedToken,
					"id-token-abc",
				);

				expect(modernAdapter.findUserByEmail).toHaveBeenCalledWith(
					"test@example.com",
				);
				expect(modernAdapter.createUser).not.toHaveBeenCalled();
				expect(modernAdapter.linkAccount).not.toHaveBeenCalled();
				expect(modernAdapter.updateAccount).toHaveBeenCalledWith(
					"account-456",
					expect.objectContaining({ userId: "user-123" }),
				);
			});
		});

		describe("security: unverified email must not match an existing user", () => {
			const unverifiedToken = { ...mockDecodedToken, email_verified: false };

			it("should refuse with UNAUTHORIZED when an unverified token matches an existing user by email (better-auth < 1.7)", async () => {
				mockInternalAdapter.findOAuthUser.mockResolvedValue(null);
				mockInternalAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});

				const ctx = createMockCtx();
				await expect(
					createOrUpdateUser(ctx as any, unverifiedToken, "id-token-abc"),
				).rejects.toMatchObject({ status: "UNAUTHORIZED" });

				// No takeover: never link the attacker's UID or mint a session.
				expect(mockInternalAdapter.linkAccount).not.toHaveBeenCalled();
				expect(mockInternalAdapter.updateAccount).not.toHaveBeenCalled();
				expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();
				expect(setSessionCookie).not.toHaveBeenCalled();
			});

			it("should treat email_verified undefined as unverified", async () => {
				const { email_verified: _drop, ...noVerifiedFlag } = mockDecodedToken;
				mockInternalAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});

				const ctx = createMockCtx();
				await expect(
					createOrUpdateUser(ctx as any, noVerifiedFlag as any, "id-token"),
				).rejects.toMatchObject({ status: "UNAUTHORIZED" });
				expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();
			});

			it("should still create a fresh user when an unverified token has NO existing account (no hijack path)", async () => {
				mockInternalAdapter.findOAuthUser.mockResolvedValue(null);
				mockInternalAdapter.findUserByEmail.mockResolvedValue(null);

				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, unverifiedToken, "id-token-abc");

				expect(mockInternalAdapter.createUser).toHaveBeenCalledWith(
					expect.objectContaining({ emailVerified: false }),
					expect.any(Object),
				);
				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledOnce();
				expect(mockInternalAdapter.createSession).toHaveBeenCalledOnce();
			});

			it("should refuse on better-auth >= 1.7 too (findAccountOwnerByKey adapter)", async () => {
				const { findOAuthUser: _legacy, ...modernMethods } =
					mockInternalAdapter;
				const modernAdapter = {
					...modernMethods,
					findAccountOwnerByKey: vi.fn().mockResolvedValue(null),
				};
				modernAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});
				const ctx = {
					context: { internalAdapter: modernAdapter },
					body: {},
					json: vi.fn(),
				};

				await expect(
					createOrUpdateUser(ctx as any, unverifiedToken, "id-token-abc"),
				).rejects.toMatchObject({ status: "UNAUTHORIZED" });
				expect(modernAdapter.linkAccount).not.toHaveBeenCalled();
				expect(modernAdapter.createSession).not.toHaveBeenCalled();
			});

			// better-auth < 1.7: findOAuthUser falls back to the email match itself.
			it.each([
				["no account", null],
				["an orphaned account", { ...mockAccount, userId: "deleted-user" }],
			])(
				"should refuse an unverified email that findOAuthUser matched with %s",
				async (_, linkedAccount) => {
					mockInternalAdapter.findOAuthUser.mockResolvedValue({
						user: mockUser,
						linkedAccount,
						accounts: [],
					});
					mockInternalAdapter.findUserByEmail.mockResolvedValue({
						user: mockUser,
						accounts: [],
					});

					const ctx = createMockCtx();
					await expect(
						createOrUpdateUser(ctx as any, unverifiedToken, "id-token-abc"),
					).rejects.toMatchObject({ status: "UNAUTHORIZED" });
					expect(mockInternalAdapter.linkAccount).not.toHaveBeenCalled();
					expect(mockInternalAdapter.updateAccount).not.toHaveBeenCalled();
					expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();
				},
			);

			it("should keep the user that already owns another row for the UID when findOAuthUser returns an orphaned one (better-auth < 1.7)", async () => {
				// A user deleted without cascading leaves its row, and the UID's next
				// sign-in adds a new user with a second row. findOAuthUser can then
				// return the orphaned row with that new user matched by email.
				mockInternalAdapter.findOAuthUser.mockResolvedValue({
					user: mockUser,
					linkedAccount: {
						...mockAccount,
						id: "orphaned-account",
						userId: "deleted-user",
					},
					accounts: [],
				});
				mockInternalAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});
				mockInternalAdapter.findAccounts.mockResolvedValue([mockAccount]);

				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, unverifiedToken, "id-token-abc");

				expect(mockInternalAdapter.findUserByEmail).not.toHaveBeenCalled();
				expect(mockInternalAdapter.updateAccount).toHaveBeenCalledWith(
					"orphaned-account",
					expect.objectContaining({ userId: "user-123" }),
				);
				expect(mockInternalAdapter.createSession).toHaveBeenCalledOnce();
			});

			it("should re-parent the orphaned row findOAuthUser doesn't return instead of linking a second one (better-auth < 1.7)", async () => {
				// No user has the orphaned row's user id or the token's email, so
				// findOAuthUser returns nothing.
				mockInternalAdapter.findAccountByProviderId.mockResolvedValue({
					...mockAccount,
					id: "orphaned-account",
					userId: "deleted-user",
				});

				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, unverifiedToken, "id-token-abc");

				expect(
					mockInternalAdapter.findAccountByProviderId,
				).toHaveBeenCalledWith("firebase-uid-123", "firebase");
				expect(mockInternalAdapter.createUser).toHaveBeenCalledOnce();
				expect(mockInternalAdapter.linkAccount).not.toHaveBeenCalled();
				expect(mockInternalAdapter.updateAccount).toHaveBeenCalledWith(
					"orphaned-account",
					expect.objectContaining({ userId: "user-123" }),
				);
			});

			it("should still link a verified email that findOAuthUser matched (better-auth < 1.7)", async () => {
				mockInternalAdapter.findOAuthUser.mockResolvedValue({
					user: mockUser,
					linkedAccount: null,
					accounts: [],
				});
				mockInternalAdapter.findUserByEmail.mockResolvedValue({
					user: mockUser,
					accounts: [],
				});

				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, mockDecodedToken, "id-token-abc");

				expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledWith(
					expect.objectContaining({ userId: "user-123" }),
				);
			});

			it("should not verify the stored email from a token for a different address", async () => {
				mockInternalAdapter.findOAuthUser.mockResolvedValue({
					user: { ...mockUser, emailVerified: false },
					linkedAccount: mockAccount,
					accounts: [mockAccount],
				});

				const ctx = createMockCtx();
				await createOrUpdateUser(
					ctx as any,
					{ ...mockDecodedToken, email: "changed@example.com" },
					"id-token-abc",
				);

				expect(mockInternalAdapter.updateUser).toHaveBeenCalledWith(
					"user-123",
					expect.objectContaining({ emailVerified: false }),
				);
				expect(mockInternalAdapter.deleteSessions).not.toHaveBeenCalled();
			});
		});

		describe("phone sign-in with a fallback email", () => {
			const phoneNumber = "+15555550100";
			const phoneToken = {
				uid: "new-phone-uid",
				email: `${phoneNumber}@myapp.example`,
				phone_number: phoneNumber,
				...firebaseProject,
				exp: Math.floor(Date.now() / 1000) + 3600,
			};
			const earlierTokenClaims = {
				sub: "deleted-phone-uid",
				phone_number: phoneNumber,
				...firebaseProject,
			};
			const earlierPhoneAccount = {
				...mockAccount,
				id: "earlier-phone-account",
				accountId: "deleted-phone-uid",
				idToken: idTokenWithClaims(earlierTokenClaims),
			};
			const phoneFallbackEmail = { firebaseAdminAuth: mockAdminAuth };
			const withEarlierToken = (claims: Record<string, unknown>) => () =>
				mockInternalAdapter.findAccounts.mockResolvedValue([
					{
						...earlierPhoneAccount,
						idToken: idTokenWithClaims({ ...earlierTokenClaims, ...claims }),
					},
				]);

			beforeEach(() => {
				mockInternalAdapter.findUserByEmail.mockResolvedValue({
					user: { ...mockUser, email: phoneToken.email, emailVerified: false },
					accounts: [],
				});
				mockInternalAdapter.findAccounts.mockResolvedValue([
					earlierPhoneAccount,
				]);
				mockAdminAuth.getUser.mockRejectedValue(userNotFound());
			});

			it("should link to the same phone number's earlier account once its Firebase user no longer exists, ending that account's sessions", async () => {
				mockInternalAdapter.listSessions.mockResolvedValue([
					{ token: "earlier-session" },
				]);

				const ctx = createMockCtx();
				await createOrUpdateUser(
					ctx as any,
					phoneToken,
					"id-token",
					7,
					phoneFallbackEmail,
				);

				expect(mockAdminAuth.getUser).toHaveBeenCalledWith("deleted-phone-uid");
				expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
				expect(mockInternalAdapter.deleteSessions).toHaveBeenCalledWith([
					"earlier-session",
				]);
				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledWith(
					expect.objectContaining({
						accountId: "new-phone-uid",
						userId: "user-123",
					}),
				);
				expect(mockInternalAdapter.createSession).toHaveBeenCalledOnce();
			});

			it("should link a tenant's phone number when the Admin instance is scoped to that tenant", async () => {
				withEarlierToken({ firebase: { tenant: "tenant-a" } })();

				const ctx = createMockCtx();
				await createOrUpdateUser(
					ctx as any,
					{ ...phoneToken, firebase: { tenant: "tenant-a" } },
					"id-token",
					7,
					{ firebaseAdminAuth: { ...mockAdminAuth, tenantId: "tenant-a" } },
				);

				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledWith(
					expect.objectContaining({ userId: "user-123" }),
				);
			});

			it("should refuse a tenant's token when the Admin instance isn't scoped to that tenant", async () => {
				withEarlierToken({ firebase: { tenant: "tenant-a" } })();

				const ctx = createMockCtx();
				await expect(
					createOrUpdateUser(
						ctx as any,
						{ ...phoneToken, firebase: { tenant: "tenant-a" } },
						"id-token",
						7,
						phoneFallbackEmail,
					),
				).rejects.toMatchObject({ status: "UNAUTHORIZED" });
				expect(mockAdminAuth.getUser).not.toHaveBeenCalled();
			});

			it.each([
				[
					"its Firebase user still exists",
					() =>
						mockAdminAuth.getUser.mockResolvedValue({
							uid: "deleted-phone-uid",
						}),
				],
				[
					"the Firebase user lookup fails",
					() =>
						mockAdminAuth.getUser.mockRejectedValue(
							Object.assign(new Error("Failed to determine service account"), {
								code: "app/invalid-credential",
							}),
						),
				],
				[
					"another of its Firebase users still exists",
					() => {
						mockInternalAdapter.findAccounts.mockResolvedValue([
							earlierPhoneAccount,
							{
								...earlierPhoneAccount,
								id: "live-phone-account",
								accountId: "live-phone-uid",
								idToken: idTokenWithClaims({
									...earlierTokenClaims,
									sub: "live-phone-uid",
								}),
							},
						]);
						mockAdminAuth.getUser.mockImplementation(async (uid: string) => {
							if (uid === "live-phone-uid") return { uid };
							throw userNotFound();
						});
					},
				],
				[
					"its last ID token carried another phone number",
					withEarlierToken({ phone_number: "+15555550199" }),
				],
				[
					"its last ID token carried no phone number",
					withEarlierToken({ phone_number: undefined }),
				],
				[
					"its last ID token was for another UID",
					withEarlierToken({ sub: "another-uid" }),
				],
				[
					"its last ID token was for another Firebase project",
					withEarlierToken({
						aud: "another-project",
						iss: "https://securetoken.google.com/another-project",
					}),
				],
				[
					"its last ID token was for a tenant",
					withEarlierToken({ firebase: { tenant: "tenant-a" } }),
				],
				[
					"the user also has a password account",
					() =>
						mockInternalAdapter.findAccounts.mockResolvedValue([
							earlierPhoneAccount,
							{
								...mockAccount,
								id: "credential-account",
								providerId: "credential",
								accountId: "user-123",
							},
						]),
				],
				[
					"the user has no accounts",
					() => mockInternalAdapter.findAccounts.mockResolvedValue([]),
				],
			])("should refuse when %s", async (_, arrange) => {
				arrange();

				const ctx = createMockCtx();
				await expect(
					createOrUpdateUser(
						ctx as any,
						phoneToken,
						"id-token",
						7,
						phoneFallbackEmail,
					),
				).rejects.toMatchObject({ status: "UNAUTHORIZED" });
				expect(mockInternalAdapter.linkAccount).not.toHaveBeenCalled();
				expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();
			});

			it("should not check the phone number for an email the token carried", async () => {
				const ctx = createMockCtx();
				await expect(
					createOrUpdateUser(ctx as any, phoneToken, "id-token"),
				).rejects.toMatchObject({ status: "UNAUTHORIZED" });
				expect(mockAdminAuth.getUser).not.toHaveBeenCalled();
			});
		});

		describe("token without email", () => {
			const tokenNoEmail = {
				uid: "firebase-uid-no-email",
				email: null,
				name: "No Email User",
				picture: null,
				email_verified: false,
				exp: Math.floor(Date.now() / 1000) + 3600,
			};

			it("should pass empty string as email to findOAuthUser (better-auth < 1.7)", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, tokenNoEmail, "id-token");

				expect(mockInternalAdapter.findOAuthUser).toHaveBeenCalledWith(
					"",
					"firebase-uid-no-email",
					"firebase",
				);
			});

			it("should NOT call findUserByEmail when token has no email", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, tokenNoEmail, "id-token");

				expect(mockInternalAdapter.findUserByEmail).not.toHaveBeenCalled();
			});

			it("should create user with empty string email and undefined image", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, tokenNoEmail, "id-token");

				expect(mockInternalAdapter.createUser).toHaveBeenCalledWith(
					{
						email: "",
						name: "No Email User",
						image: undefined,
						emailVerified: false,
					},
					{
						method: "oauth",
						oauth: { providerId: "firebase", profile: tokenNoEmail },
					},
				);
			});
		});

		describe("token without exp", () => {
			const tokenNoExp = {
				uid: "firebase-uid-no-exp",
				email: "no-exp@example.com",
				name: "No Exp",
				picture: null,
				email_verified: true,
			};

			it("should pass undefined for accessTokenExpiresAt when exp is absent", async () => {
				const ctx = createMockCtx();
				await createOrUpdateUser(ctx as any, tokenNoExp, "id-token");

				expect(mockInternalAdapter.linkAccount).toHaveBeenCalledWith(
					expect.objectContaining({
						accessTokenExpiresAt: undefined,
					}),
				);
			});
		});

		describe("custom session expiry", () => {
			it("should use provided sessionExpiresInDays", async () => {
				const ctx = createMockCtx();
				const before = Date.now();
				await createOrUpdateUser(
					ctx as any,
					mockDecodedToken,
					"id-token-abc",
					30,
				);

				const sessionArgs = mockInternalAdapter.createSession.mock.calls[0];
				const expiresAt = sessionArgs[2].expiresAt as Date;
				const expectedMs = 1000 * 60 * 60 * 24 * 30;
				expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
					before + expectedMs - 1000,
				);
				expect(expiresAt.getTime()).toBeLessThanOrEqual(
					Date.now() + expectedMs + 1000,
				);
			});
		});

		describe("image fallback in response", () => {
			it("should return null for image when user.image is undefined", async () => {
				mockInternalAdapter.createUser.mockResolvedValue({
					...mockUser,
					image: undefined,
				});

				const ctx = createMockCtx();
				const result = await createOrUpdateUser(
					ctx as any,
					mockDecodedToken,
					"id-token",
				);

				expect(result.user.image).toBeNull();
			});
		});
	});

	// ─── backfillAccountIssuers ──────────────────────────────────────────

	describe("backfillAccountIssuers", () => {
		const adapter = { count: vi.fn(), updateMany: vi.fn() };
		const tables = { account: { fields: { issuer: { type: "string" } } } };
		const auth = { $context: Promise.resolve({ adapter, tables }) } as any;

		beforeEach(() => {
			// First count: total firebase rows; second: rows already stamped.
			adapter.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
			adapter.updateMany.mockResolvedValue(3);
		});

		it("should stamp the issuer on all firebase rows through the adapter", async () => {
			const result = await backfillAccountIssuers(auth);

			expect(adapter.count).toHaveBeenNthCalledWith(1, {
				model: "account",
				where: [{ field: "providerId", value: "firebase" }],
			});
			expect(adapter.count).toHaveBeenNthCalledWith(2, {
				model: "account",
				where: [
					{ field: "providerId", value: "firebase" },
					{ field: "issuer", value: FIREBASE_ACCOUNT_ISSUER },
				],
			});
			expect(adapter.updateMany).toHaveBeenCalledWith({
				model: "account",
				where: [{ field: "providerId", value: "firebase" }],
				update: { issuer: FIREBASE_ACCOUNT_ISSUER },
			});
			expect(result).toEqual({
				total: 3,
				missing: 2,
				updated: 3,
				issuerRequired: true,
			});
		});

		it("should not write on a dry run", async () => {
			const result = await backfillAccountIssuers(auth, { dryRun: true });

			expect(adapter.updateMany).not.toHaveBeenCalled();
			expect(result).toEqual({
				total: 3,
				missing: 2,
				updated: 0,
				issuerRequired: true,
			});
		});

		it("should not write when there are no firebase rows", async () => {
			adapter.count.mockReset().mockResolvedValue(0);
			const result = await backfillAccountIssuers(auth);

			expect(adapter.updateMany).not.toHaveBeenCalled();
			expect(result).toEqual({
				total: 0,
				missing: 0,
				updated: 0,
				issuerRequired: true,
			});
		});

		it("should report no backfill needed without an account.issuer field (Better Auth 1.5 – 1.6, 1.7.3+)", async () => {
			adapter.count.mockReset().mockResolvedValue(3);
			const providerKeyedAuth = {
				$context: Promise.resolve({
					adapter,
					tables: { account: { fields: { providerId: {} } } },
				}),
			} as any;

			const result = await backfillAccountIssuers(providerKeyedAuth);

			expect(result).toEqual({
				total: 3,
				missing: 0,
				updated: 0,
				issuerRequired: false,
			});
			expect(adapter.count).toHaveBeenCalledOnce();
			expect(adapter.updateMany).not.toHaveBeenCalled();
		});
	});

	// ─── migrationChecks startup warning ─────────────────────────────────

	describe("migrationChecks startup warning", () => {
		const makeCtx = (
			counts: { total: number; stamped: number },
			hasIssuerField = true,
		) => {
			const count = vi
				.fn()
				.mockResolvedValueOnce(counts.total)
				.mockResolvedValueOnce(counts.stamped);
			return {
				ctx: {
					tables: {
						account: {
							fields: hasIssuerField ? { issuer: {} } : { providerId: {} },
						},
					},
					adapter: { count },
					logger: { warn: vi.fn() },
				},
				count,
			};
		};

		const flush = () => new Promise((r) => setTimeout(r, 0));

		it("should warn with the remediation when firebase rows lack issuer", async () => {
			const { ctx } = makeCtx({ total: 5, stamped: 2 });
			const plugin = firebaseAuthPlugin({
				firebaseAdminAuth: mockAdminAuth as any,
			});
			plugin.init?.(ctx as any);
			await flush();

			expect(ctx.logger.warn).toHaveBeenCalledOnce();
			const message = ctx.logger.warn.mock.calls[0][0] as string;
			expect(message).toContain("3 of 5");
			expect(message).toContain(
				"npx better-auth-firebase-auth backfill-account-issuers",
			);
			expect(message).toContain("backfillAccountIssuers");
			expect(message).toContain(FIREBASE_ACCOUNT_ISSUER);
			expect(message).toContain(">= 1.7.3");
			expect(message).toContain("migrationChecks: false");
		});

		it("should stay silent when every row is stamped", async () => {
			const { ctx } = makeCtx({ total: 5, stamped: 5 });
			firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }).init?.(
				ctx as any,
			);
			await flush();
			expect(ctx.logger.warn).not.toHaveBeenCalled();
		});

		it("should stay silent and read nothing without an account.issuer field (Better Auth 1.5 – 1.6, 1.7.3+)", async () => {
			const { ctx, count } = makeCtx({ total: 5, stamped: 0 }, false);
			firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }).init?.(
				ctx as any,
			);
			await flush();
			expect(count).not.toHaveBeenCalled();
			expect(ctx.logger.warn).not.toHaveBeenCalled();
		});

		it("should not run at all when migrationChecks is false", async () => {
			const { ctx, count } = makeCtx({ total: 5, stamped: 0 });
			firebaseAuthPlugin({
				firebaseAdminAuth: mockAdminAuth as any,
				migrationChecks: false,
			}).init?.(ctx as any);
			await flush();
			expect(count).not.toHaveBeenCalled();
			expect(ctx.logger.warn).not.toHaveBeenCalled();
		});

		it("should never throw when the adapter fails", async () => {
			const ctx = {
				tables: { account: { fields: { issuer: {} } } },
				adapter: { count: vi.fn().mockRejectedValue(new Error("boom")) },
				logger: { warn: vi.fn() },
			};
			firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }).init?.(
				ctx as any,
			);
			await flush();
			expect(ctx.logger.warn).not.toHaveBeenCalled();
		});
	});

	// ─── Hook Matchers ───────────────────────────────────────────────────

	describe("hook matchers", () => {
		const getHooks = () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: true,
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});
			return plugin.hooks?.before ?? [];
		};

		it("should match /sign-in/email path", () => {
			const hooks = getHooks();
			const match = hooks.find((h) =>
				h.matcher({ path: "/sign-in/email" } as any),
			);
			expect(match).toBeDefined();
		});

		it("should match /sign-up/email path", () => {
			const hooks = getHooks();
			const match = hooks.find((h) =>
				h.matcher({ path: "/sign-up/email" } as any),
			);
			expect(match).toBeDefined();
		});

		it("should NOT match unrelated paths", () => {
			const hooks = getHooks();
			for (const hook of hooks) {
				expect(hook.matcher({ path: "/sign-in/social" } as any)).toBe(false);
				expect(hook.matcher({ path: "/user/profile" } as any)).toBe(false);
			}
		});

		it("should handle undefined path without crashing", () => {
			const hooks = getHooks();
			for (const hook of hooks) {
				expect(() => hook.matcher({ path: undefined } as any)).not.toThrow();
				expect(hook.matcher({ path: undefined } as any)).toBe(false);
			}
		});

		it("should handle missing path property without crashing", () => {
			const hooks = getHooks();
			for (const hook of hooks) {
				expect(() => hook.matcher({} as any)).not.toThrow();
				expect(hook.matcher({} as any)).toBe(false);
			}
		});
	});

	// ─── Endpoint Registration ───────────────────────────────────────────

	describe("endpoint registration", () => {
		it("should register signInWithGoogle endpoint", () => {
			const plugin = firebaseAuthPlugin({
				firebaseAdminAuth: mockAdminAuth as any,
			});
			expect(plugin.endpoints?.signInWithGoogle).toBeDefined();
		});

		it("should register signInWithEmail endpoint", () => {
			const plugin = firebaseAuthPlugin({
				useClientSideTokens: true,
				firebaseAdminAuth: mockAdminAuth as any,
			});
			expect(plugin.endpoints?.signInWithEmail).toBeDefined();
		});

		it("should register password reset endpoints", () => {
			const plugin = firebaseAuthPlugin({
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});
			expect(plugin.endpoints?.sendPasswordReset).toBeDefined();
			expect(plugin.endpoints?.confirmPasswordReset).toBeDefined();
			expect(plugin.endpoints?.verifyPasswordResetCode).toBeDefined();
		});

		it("should include passwordResetUrl in plugin options", () => {
			const plugin = firebaseAuthPlugin({
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
				passwordResetUrl: "https://myapp.com/reset-password",
			});
			expect(plugin.endpoints?.sendPasswordReset).toBeDefined();
		});

		it("should register signInWithPhone endpoint", () => {
			const plugin = firebaseAuthPlugin({
				firebaseAdminAuth: mockAdminAuth as any,
			});
			expect(plugin.endpoints?.signInWithPhone).toBeDefined();
		});

		it("should not register signInWithPhone when serverSideOnly is true", () => {
			const plugin = firebaseAuthPlugin({
				firebaseAdminAuth: mockAdminAuth as any,
				serverSideOnly: true,
			});
			expect(plugin.endpoints?.signInWithPhone).toBeUndefined();
		});
	});
});

// ─── Integration Test with better-auth instance ─────────────────────────

describe("integration: firebaseAuthPlugin with betterAuth", async () => {
	const { getTestInstance } = await import("better-auth/test");

	const mockAdminAuth = {
		verifyIdToken: vi.fn(),
		getUser: vi.fn(),
	};

	const mockDecodedToken = {
		uid: "firebase-uid-integration",
		email: "integration@example.com",
		name: "Integration User",
		picture: "https://example.com/photo.jpg",
		email_verified: true,
		exp: Math.floor(Date.now() / 1000) + 3600,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockAdminAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);
		mockAdminAuth.getUser.mockResolvedValue({});
		vi.mocked(setSessionCookie).mockResolvedValue(undefined);
	});

	/** A Better Auth instance with the plugin and a Firebase config, logging to `log`. */
	const instanceLoggingTo = (
		log: (...args: any[]) => void,
		options: Parameters<typeof firebaseAuthPlugin>[0] = {},
	) =>
		getTestInstance(
			{
				logger: { log },
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						firebaseConfig: {
							apiKey: "test-api-key",
							authDomain: "test.firebaseapp.com",
							projectId: "test-project",
						},
						...options,
					}),
				],
			},
			{ disableTestUser: true },
		);

	it("should sign in with Google and create user + session in DB", async () => {
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "fake-google-token" },
		});

		expect(res.data).toBeDefined();
		const data = res.data as any;
		expect(data.user).toBeDefined();
		expect(data.user.email).toBe("integration@example.com");
		expect(data.user.name).toBe("Integration User");
		expect(data.session).toBeDefined();
		expect(data.session.token).toBeDefined();
		expect(setSessionCookie).toHaveBeenCalledOnce();
	});

	it("should sign in with email (client-side token mode) and create user", async () => {
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						useClientSideTokens: true,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-email", {
			method: "POST",
			body: { idToken: "fake-email-token" },
		});

		expect(res.data).toBeDefined();
		const data = res.data as any;
		expect(data.user.email).toBe("integration@example.com");
		expect(data.session.token).toBeDefined();
		expect(setSessionCookie).toHaveBeenCalledOnce();
	});

	it("should return same user on second sign-in (idempotent)", async () => {
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res1 = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "token-1" },
		});

		const res2 = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "token-2" },
		});

		const data1 = res1.data as any;
		const data2 = res2.data as any;
		expect(data1.user.id).toBe(data2.user.id);
		expect(data1.user.email).toBe(data2.user.email);
	});

	it("should link Firebase account when user exists by email", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const ctx = await auth.api.signUpEmail({
			body: {
				email: "integration@example.com",
				password: "test-password-123",
				name: "Existing User",
			},
		});

		const preExistingUserId = ctx.user.id;
		// Linking by email needs the existing user's own address verified too.
		const authCtx = await (auth as any).$context;
		await authCtx.internalAdapter.updateUser(preExistingUserId, {
			emailVerified: true,
		});

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "firebase-token" },
		});

		const data = res.data as any;
		expect(data.user.id).toBe(preExistingUserId);
	});

	it("should NOT take over an existing account with an unverified Firebase token", async () => {
		// The attack: mint a project token for a victim's email via the public
		// Identity Toolkit signUp (email_verified=false), then sign in.
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			...mockDecodedToken,
			uid: "attacker-uid",
			email_verified: false,
		});

		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
				],
			},
			{ disableTestUser: true },
		);

		const victim = await auth.api.signUpEmail({
			body: {
				email: "integration@example.com",
				password: "victim-password-123",
				name: "Victim",
			},
		});

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "attacker-token" },
		});

		expect(res.error).toBeDefined();
		expect((res.error as any).status).toBe(401);
		expect((res.error as any).message).toBe(
			"Verify your email address before signing in with this method.",
		);

		// The victim's account is untouched: no Firebase account linked to it.
		const ctx = await (auth as any).$context;
		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "userId", value: victim.user.id }],
		});
		expect(
			accounts.some((a: any) => a.providerId === "firebase"),
		).toBe(false);
	});

	it.each([
		"/firebase-auth/sign-in-with-email",
		"/firebase-auth/sign-in-with-phone",
	])(
		"should not sign in to an existing user with an unverified email via %s",
		async (path) => {
			const { client, auth } = await getTestInstance(
				{
					plugins: [
						firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
					],
				},
				{ disableTestUser: true },
			);

			const victim = await auth.api.signUpEmail({
				body: {
					email: "victim@example.com",
					password: "victim-password-123",
					name: "Victim",
				},
			});

			mockAdminAuth.verifyIdToken.mockResolvedValue({
				uid: "attacker-uid",
				email: "victim@example.com",
				email_verified: false,
				phone_number: "+15555550199", // required by sign-in-with-phone only
				exp: Math.floor(Date.now() / 1000) + 3600,
			});

			const ctx = await (auth as any).$context;
			const sessionsBefore = await ctx.adapter.findMany({ model: "session" });

			const res = await client.$fetch(path, {
				method: "POST",
				body: { idToken: "attacker-token" },
			});

			expect((res.error as any)?.status).toBe(401);
			expect((res.error as any)?.message).toBe(
				"Verify your email address before signing in with this method.",
			);
			expect(res.data).toBeNull();
			const victimAccounts = await ctx.adapter.findMany({
				model: "account",
				where: [{ field: "userId", value: victim.user.id }],
			});
			expect(victimAccounts.map((a: any) => a.providerId)).toEqual([
				"credential",
			]);
			expect(await ctx.adapter.findMany({ model: "session" })).toHaveLength(
				sessionsBefore.length,
			);
		},
	);

	it.each(["/sign-in/email", "/sign-up/email"])(
		"should not sign in to an existing user with an unverified email through the overrideEmailPasswordFlow %s hook",
		async (path) => {
			const { client, auth } = await getTestInstance(
				{
					plugins: [
						firebaseAuthPlugin({
							firebaseAdminAuth: mockAdminAuth as any,
							overrideEmailPasswordFlow: true,
							firebaseConfig: {
								apiKey: "test-api-key",
								authDomain: "test.firebaseapp.com",
								projectId: "test-project",
							},
						}),
					],
				},
				{ disableTestUser: true },
			);
			const ctx = await (auth as any).$context;
			// Created directly: with the override on, sign-up itself goes through Firebase.
			const victim = await ctx.internalAdapter.createUser({
				email: "victim@example.com",
				name: "Victim",
				emailVerified: true,
			});
			const credential = {
				user: { getIdToken: vi.fn().mockResolvedValue("attacker-token") },
			};
			vi.mocked(signInWithEmailAndPassword).mockResolvedValue(
				credential as any,
			);
			vi.mocked(createUserWithEmailAndPassword).mockResolvedValue(
				credential as any,
			);
			mockAdminAuth.verifyIdToken.mockResolvedValue({
				uid: "attacker-uid",
				email: "victim@example.com",
				email_verified: false,
				exp: Math.floor(Date.now() / 1000) + 3600,
			});

			const res = await client.$fetch(path, {
				method: "POST",
				body: {
					email: "victim@example.com",
					password: "attacker-password-123",
					name: "Attacker",
				},
			});

			expect(
				path === "/sign-in/email"
					? signInWithEmailAndPassword
					: createUserWithEmailAndPassword,
			).toHaveBeenCalledOnce();
			expect((res.error as any)?.status).toBe(401);
			expect((res.error as any)?.message).toBe(
				"Verify your email address before signing in with this method.",
			);
			const accounts = await ctx.adapter.findMany({
				model: "account",
				where: [{ field: "userId", value: victim.id }],
			});
			expect(accounts).toEqual([]);
			expect(await ctx.adapter.findMany({ model: "session" })).toEqual([]);
		},
	);

	// Look-alikes that database collations compare as equal: UCA/ICU base-level
	// equivalents (MySQL and MariaDB unicode, 0900 and uca1400 collations,
	// Postgres ICU), utf8mb4_general_ci folds, and PAD SPACE's trailing spaces.
	it.each([
		...[
			"firebase",
			"Firebase",
			"firebase ",
			"fïrebase",
			"ｆｉｒｅｂａｓｅ",
			"fire\u200bbase",
			"fire\u0001base",
			"f\u0131rebase",
			"fireba\u00dfe",
			"fire\u0640base",
			"\ua77cirebase",
			"firebase\u00a0",
			"fire\u06debase",
			"firebase \u200b",
			" firebase",
		].map((providerId) => [
			"/sso/register",
			{ providerId, issuer: "https://idp.example.com" },
		]),
		["/sso/register", { providerId: "acme", issuer: "local:oauth:firebase" }],
		["/sso/register", { providerId: "acme", issuer: "LOCAL:OAUTH:FIREBASE" }],
		[
			"/sso/register",
			{ providerId: "acme", issuer: "local:oauth:fire\u0640base" },
		],
		[
			"/sso/register",
			{ providerId: "acme", issuer: "local:oaut\u0127:firebase" },
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				samlConfig: {
					idpMetadata: { entityID: "local:\u00f8auth:firebase" },
				},
			},
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				samlConfig: {
					idpMetadata: {
						metadata:
							'<EntityDescriptor entityID="local:oauth:fire&#x640;base"><IDPSSODescriptor/></EntityDescriptor>',
					},
				},
			},
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				samlConfig: { idpMetadata: { entityID: "local:oauth:firebase" } },
			},
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				samlConfig: {
					idpMetadata: {
						metadata:
							'<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="local&#x3A;oauth&#x3a;fire&#98;ase"><IDPSSODescriptor/></EntityDescriptor>',
					},
				},
			},
		],
		[
			"/sso/update-provider",
			{ providerId: "acme", issuer: "local:oauth:firebase" },
		],
		[
			"/sso/update-provider",
			{
				providerId: "acme",
				samlConfig: { idpMetadata: { entityID: "local:oauth:firebase" } },
			},
		],
		// @better-auth/sso stores an issuer trimmed and without tabs or line
		// breaks, and samlify reads those in a SAML entity ID as spaces.
		["/sso/register", { providerId: "acme", issuer: " local:oauth:firebase" }],
		["/sso/register", { providerId: "acme", issuer: "local:oauth:fire\tbase" }],
		[
			"/sso/register",
			{ providerId: "acme", issuer: "\u2028local:oauth:firebase\n" },
		],
		[
			"/sso/update-provider",
			{ providerId: "acme", issuer: " local:oauth:firebase" },
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				samlConfig: { idpMetadata: { entityID: "local:oauth:firebase\t" } },
			},
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				samlConfig: { idpMetadata: { entityID: "local:oauth:firebase\r\n" } },
			},
		],
		["/scim/generate-token", { providerId: "firebase" }],
		["/scim/generate-token", { providerId: "fire\u0640base" }],
		["/scim/generate-token", { providerId: "Fire\u200bbase" }],
	])(
		"should refuse %s with %j, which would claim Firebase account rows",
		async (path, body) => {
			const reached = vi.fn();
			const { client } = await getTestInstance(
				{
					plugins: [
						firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
						foreignProviderEndpointsStub(reached),
					],
				},
				{ disableTestUser: true },
			);

			const res = await client.$fetch(path as string, { method: "POST", body });

			expect((res.error as any)?.status).toBe(422);
			expect(reached).not.toHaveBeenCalled();
		},
	);

	it.each([
		[
			"/sso/register",
			{ providerId: "acme", issuer: "https://idp.example.com" },
		],
		[
			"/sso/register",
			{
				providerId: "acme-saml",
				samlConfig: {
					idpMetadata: { entityID: "https://idp.example.com/saml" },
				},
			},
		],
		[
			"/sso/update-provider",
			{ providerId: "acme", issuer: "https://idp.example.com" },
		],
		// Punctuation and inner spaces count in those collations.
		[
			"/sso/register",
			{ providerId: "fire-base", issuer: "https://idp.example.com" },
		],
		[
			"/sso/register",
			{ providerId: "fire base", issuer: "https://idp.example.com" },
		],
		[
			"/sso/register",
			{
				providerId: "acme",
				issuer: "https://idp.example.com/local/oauth/firebase",
			},
		],
		[
			"/sso/register",
			{
				providerId: "acme-saml",
				samlConfig: {
					idpMetadata: {
						metadata:
							'<EntityDescriptor entityID="https://idp.example.com/metadata"><IDPSSODescriptor><SingleSignOnService Location="https://idp.example.com/local/oauth/firebase"/></IDPSSODescriptor></EntityDescriptor>',
					},
				},
			},
		],
		["/scim/generate-token", { providerId: "okta" }],
	])("should let %s through with %j", async (path, body) => {
		const reached = vi.fn();
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
					foreignProviderEndpointsStub(reached),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch(path as string, { method: "POST", body });

		expect(res.error).toBeNull();
		expect(reached).toHaveBeenCalledWith(path);
	});

	it("should not link a verified sign-in into a user registered first with an unverified token", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
				],
			},
			{ disableTestUser: true },
		);
		const claims = {
			email: "victim@example.com",
			exp: Math.floor(Date.now() / 1000) + 3600,
		};

		mockAdminAuth.verifyIdToken.mockResolvedValue({
			...claims,
			uid: "attacker-uid",
			email_verified: false,
		});
		const squatter = await client.$fetch("/firebase-auth/sign-in-with-email", {
			method: "POST",
			body: { idToken: "attacker-token" },
		});
		const squatterUserId = (squatter.data as any).user.id;

		mockAdminAuth.verifyIdToken.mockResolvedValue({
			...claims,
			uid: "victim-uid",
			email_verified: true,
		});
		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "victim-token" },
		});

		expect((res.error as any)?.status).toBe(401);
		expect((res.error as any)?.message).toBe(
			"Verify the email address of the existing account before signing in with this method.",
		);
		const ctx = await (auth as any).$context;
		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "userId", value: squatterUserId }],
		});
		expect(accounts.map((a: any) => a.accountId)).toEqual(["attacker-uid"]);
	});

	it("should link into an unverified existing user when requireLocalEmailVerified is false", async () => {
		const { client, auth } = await getTestInstance(
			{
				account: { accountLinking: { requireLocalEmailVerified: false } },
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
				],
			},
			{ disableTestUser: true },
		);
		const existing = await auth.api.signUpEmail({
			body: {
				email: "integration@example.com",
				password: "test-password-123",
				name: "Existing User",
			},
		});

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "firebase-token" },
		});

		expect((res.data as any)?.user.id).toBe(existing.user.id);
	});

	it("should end the unverified sign-in's sessions once the same Firebase user verifies the email", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
				],
			},
			{ disableTestUser: true },
		);
		// Once the address is proven, Firebase removes the unverified password from
		// that user, so the verified sign-in arrives with the same UID.
		const claims = {
			uid: "same-firebase-uid",
			email: "victim@example.com",
			exp: Math.floor(Date.now() / 1000) + 3600,
		};

		mockAdminAuth.verifyIdToken.mockResolvedValue({
			...claims,
			email_verified: false,
		});
		const first = await client.$fetch("/firebase-auth/sign-in-with-email", {
			method: "POST",
			body: { idToken: "unverified-token" },
		});

		mockAdminAuth.verifyIdToken.mockResolvedValue({
			...claims,
			email_verified: true,
		});
		const second = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "verified-token" },
		});

		const userId = (second.data as any).user.id;
		expect(userId).toBe((first.data as any).user.id);
		const ctx = await (auth as any).$context;
		const sessions = await ctx.adapter.findMany({
			model: "session",
			where: [{ field: "userId", value: userId }],
		});
		expect(sessions.map((s: any) => s.token)).toEqual([
			(second.data as any).session.token,
		]);
	});

	it("should handle token without email", async () => {
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "uid-no-email",
			email: undefined,
			name: "Anonymous",
			picture: null,
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "anon-token" },
		});

		expect(res.data).toBeDefined();
		const data = res.data as any;
		expect(data.user.name).toBe("Anonymous");
		expect(data.session.token).toBeDefined();
	});

	it("should reject when verifyIdToken throws", async () => {
		mockAdminAuth.verifyIdToken.mockRejectedValue(new Error("Invalid token"));

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "bad-token" },
		});

		expect((res.error as any)?.status).toBe(401);
		expect((res.error as any)?.message).toBe(
			"Firebase token verification failed: Invalid token",
		);
	});

	it.each([
		["/firebase-auth/sign-in-with-google", false],
		["/firebase-auth/sign-in-with-email", false],
		["/sign-in/email", true],
	] as const)(
		"should not echo an internal error from %s",
		async (path, overrideEmailPasswordFlow) => {
			const { client } = await getTestInstance(
				{
					databaseHooks: {
						user: {
							create: {
								before: async () => {
									throw new Error(
										"SQLITE_CONSTRAINT: UNIQUE constraint failed: user.email",
									);
								},
							},
						},
					},
					plugins: [
						firebaseAuthPlugin({
							firebaseAdminAuth: mockAdminAuth as any,
							...(overrideEmailPasswordFlow && {
								overrideEmailPasswordFlow: true,
								firebaseConfig: {
									apiKey: "test-api-key",
									authDomain: "test.firebaseapp.com",
									projectId: "test-project",
								},
							}),
						}),
					],
				},
				{ disableTestUser: true },
			);
			vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
				user: { getIdToken: vi.fn().mockResolvedValue("firebase-token") },
			} as any);

			const res = await client.$fetch(path, {
				method: "POST",
				body: overrideEmailPasswordFlow
					? {
							email: "integration@example.com",
							password: "firebase-password-123",
						}
					: { idToken: "firebase-token" },
			});

			expect((res.error as any)?.status).toBe(500);
			expect(JSON.stringify(res.error)).not.toContain("SQLITE_CONSTRAINT");
		},
	);

	it("should still return 401 for a Firebase sign-in error in the overrideEmailPasswordFlow hook", async () => {
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						overrideEmailPasswordFlow: true,
						firebaseConfig: {
							apiKey: "test-api-key",
							authDomain: "test.firebaseapp.com",
							projectId: "test-project",
						},
					}),
				],
			},
			{ disableTestUser: true },
		);
		vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
			new Error("Firebase: Error (auth/wrong-password)."),
		);

		const res = await client.$fetch("/sign-in/email", {
			method: "POST",
			body: {
				email: "integration@example.com",
				password: "wrong-password-123",
			},
		});

		expect((res.error as any)?.status).toBe(401);
		expect((res.error as any)?.message).toBe(
			"Firebase authentication failed: Firebase: Error (auth/wrong-password).",
		);
	});

	it.each([
		"auth/user-not-found",
		"auth/too-many-requests",
		"auth/invalid-recipient-email",
		"auth/internal-error",
	])(
		"should answer a password reset email that fails with %s like a sent one, so the response doesn't tell whether the email has an account",
		async (code) => {
			const log = vi.fn();
			const { client } = await instanceLoggingTo(log);
			const sendReset = (email: string) =>
				client.$fetch("/firebase-auth/send-password-reset", {
					method: "POST",
					body: { email },
				});

			vi.mocked(sendPasswordResetEmail).mockResolvedValueOnce(undefined);
			const sent = await sendReset("known@example.com");
			vi.mocked(sendPasswordResetEmail).mockRejectedValueOnce(
				firebaseClientError(code),
			);
			const notSent = await sendReset("unknown@example.com");

			expect(sent.error).toBeNull();
			expect(notSent).toEqual(sent);
			expect(log).toHaveBeenCalledWith(
				code === "auth/user-not-found" ? "warn" : "error",
				expect.stringContaining("[better-auth-firebase-auth]"),
				loggedFirebaseClientError(code),
			);
		},
	);

	it.each([
		"auth/invalid-email",
		"auth/network-request-failed",
		"auth/api-key-not-valid.-please-pass-a-valid-api-key.",
	])(
		"should not echo Firebase's error when a password reset email fails with %s, which is the same for every address",
		async (code) => {
			const log = vi.fn();
			const { client } = await instanceLoggingTo(log);
			vi.mocked(sendPasswordResetEmail).mockRejectedValueOnce(
				firebaseClientError(code),
			);

			const res = await client.$fetch("/firebase-auth/send-password-reset", {
				method: "POST",
				body: { email: "known@example.com" },
			});

			expect((res.error as any)?.status).toBe(400);
			expect((res.error as any)?.message).toBe(
				"Failed to send password reset email",
			);
			expect(log).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("[better-auth-firebase-auth]"),
				loggedFirebaseClientError(code),
			);
		},
	);

	it.each([
		"auth/invalid-action-code",
		"auth/expired-action-code",
		"auth/user-disabled",
	])(
		"should not echo Firebase's error when verifying a password reset code fails with %s",
		async (code) => {
			const log = vi.fn();
			const { client } = await instanceLoggingTo(log);
			const error = firebaseClientError(code);
			vi.mocked(verifyPasswordResetCode).mockRejectedValueOnce(error);

			const res = await client.$fetch(
				"/firebase-auth/verify-password-reset-code",
				{ method: "POST", body: { oobCode: "reset-code" } },
			);

			expect((res.error as any)?.status).toBe(400);
			expect((res.error as any)?.message).toBe("Invalid or expired reset code");
			expect(log).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("[better-auth-firebase-auth]"),
				loggedFirebaseClientError(code),
			);
		},
	);

	it.each([
		["auth/invalid-action-code", "Invalid or expired reset code"],
		["auth/expired-action-code", "Invalid or expired reset code"],
		["auth/user-disabled", "Invalid or expired reset code"],
		["auth/user-not-found", "Invalid or expired reset code"],
		["auth/weak-password", "Password does not meet the requirements"],
		[
			"auth/password-does-not-meet-requirements",
			"Password does not meet the requirements",
		],
		["auth/network-request-failed", "Failed to confirm password reset"],
	])(
		"should answer %s from confirming a password reset with %j instead of Firebase's error",
		async (code, message) => {
			const log = vi.fn();
			const { client } = await instanceLoggingTo(log);
			const error = firebaseClientError(code);
			vi.mocked(confirmPasswordReset).mockRejectedValueOnce(error);

			const res = await client.$fetch("/firebase-auth/confirm-password-reset", {
				method: "POST",
				body: { oobCode: "reset-code", newPassword: "new-password-123" },
			});

			expect((res.error as any)?.status).toBe(400);
			expect((res.error as any)?.message).toBe(message);
			expect(log).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("[better-auth-firebase-auth]"),
				loggedFirebaseClientError(code),
			);
		},
	);

	it("should not register endpoints when serverSideOnly is true", async () => {
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						serverSideOnly: true,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "any-token" },
		});

		expect(res.error).toBeDefined();
	});

	// ─── Phone Auth integration tests ────────────────────────────────────

	it("should sign in with phone and create user + session", async () => {
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "phone-uid-123",
			phone_number: "+15555550100",
			email: undefined,
			name: undefined,
			picture: undefined,
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: "fake-phone-token" },
		});

		expect(res.data).toBeDefined();
		const data = res.data as any;
		expect(data.user).toBeDefined();
		expect(data.session).toBeDefined();
		expect(data.session.token).toBeDefined();
	});

	it("should use default fallback email for phone-only users", async () => {
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "phone-uid-fallback",
			phone_number: "+15555550101",
			email: undefined,
			name: undefined,
			picture: undefined,
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: "phone-fallback-token" },
		});

		expect(res.data).toBeDefined();
		const data = res.data as any;
		expect(data.user.email).toBe("phone-uid-fallback@firebase.local");
	});

	it("should use custom getPhoneUserFallbackEmail when provided", async () => {
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "phone-uid-custom",
			phone_number: "+15555550102",
			email: undefined,
			name: undefined,
			picture: undefined,
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						getPhoneUserFallbackEmail: ({ uid }) =>
							`phone-${uid}@myapp.example`,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: "phone-custom-email-token" },
		});

		expect(res.data).toBeDefined();
		const data = res.data as any;
		expect(data.user.email).toBe("phone-phone-uid-custom@myapp.example");
	});

	it("should reject phone sign-in when token has no phone_number", async () => {
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "uid-no-phone",
			email: "someone@example.com",
			phone_number: undefined,
			email_verified: true,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: "no-phone-token" },
		});

		expect(res.error).toBeDefined();
	});

	it("should reject phone sign-in when idToken is missing", async () => {
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: {},
		});

		expect(res.error).toBeDefined();
	});

	it("should sign in phone user idempotently (same user on second call)", async () => {
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "phone-uid-idempotent",
			phone_number: "+15555550103",
			email: undefined,
			name: undefined,
			picture: undefined,
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res1 = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: "phone-token-1" },
		});
		const res2 = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: "phone-token-2" },
		});

		const data1 = res1.data as any;
		const data2 = res2.data as any;
		expect(data1.user.id).toBe(data2.user.id);
		expect(data1.user.email).toBe(data2.user.email);
	});

	it("should sign a phone number back in to its account through its fallback email after its Firebase user is recreated", async () => {
		mockAdminAuth.getUser.mockRejectedValue(userNotFound());
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						getPhoneUserFallbackEmail: ({ phoneNumber }) =>
							`${phoneNumber}@myapp.example`,
					}),
				],
			},
			{ disableTestUser: true },
		);
		const signIn = async (uid: string): Promise<any> => {
			mockAdminAuth.verifyIdToken.mockResolvedValue({
				uid,
				phone_number: "+15555550142",
				...firebaseProject,
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			return client.$fetch("/firebase-auth/sign-in-with-phone", {
				method: "POST",
				body: {
					idToken: idTokenWithClaims({
						sub: uid,
						phone_number: "+15555550142",
						...firebaseProject,
					}),
				},
			});
		};

		const first = await signIn("deleted-phone-uid");
		// The Firebase user is deleted and the number signs up again: a new UID.
		const second = await signIn("recreated-phone-uid");

		expect(second.data?.user.id).toBe(first.data.user.id);
		expect(mockAdminAuth.getUser).toHaveBeenCalledWith("deleted-phone-uid");
		// The session the deleted Firebase user opened doesn't survive the link.
		const ctx = await (auth as any).$context;
		const sessions = await ctx.adapter.findMany({
			model: "session",
			where: [{ field: "userId", value: second.data.user.id }],
		});
		expect(sessions.map((s: any) => s.token)).toEqual([
			second.data.session.token,
		]);
	});

	it("should not link a phone sign-in into an account that registered its fallback email with a password", async () => {
		mockAdminAuth.getUser.mockRejectedValue(userNotFound());
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						getPhoneUserFallbackEmail: ({ phoneNumber }) =>
							`${phoneNumber}@myapp.example`,
					}),
				],
			},
			{ disableTestUser: true },
		);
		const squatter = await auth.api.signUpEmail({
			body: {
				email: "+15555550143@myapp.example",
				password: "squatter-password-123",
				name: "Squatter",
			},
		});
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "victim-phone-uid",
			phone_number: "+15555550143",
			...firebaseProject,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});

		const res = await client.$fetch("/firebase-auth/sign-in-with-phone", {
			method: "POST",
			body: { idToken: idTokenWithClaims({ phone_number: "+15555550143" }) },
		});

		expect((res.error as any)?.status).toBe(401);
		const ctx = await (auth as any).$context;
		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "userId", value: squatter.user.id }],
		});
		expect(accounts.map((a: any) => a.providerId)).toEqual(["credential"]);
	});

	it("should refuse, not merge, other phone numbers when the fallback email is not unique", async () => {
		// Only the phone number can refuse: the first Firebase user looks deleted.
		mockAdminAuth.getUser.mockRejectedValue(userNotFound());
		const { client } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
						getPhoneUserFallbackEmail: () => "phone-user@myapp.example",
					}),
				],
			},
			{ disableTestUser: true },
		);
		const signIn = (uid: string, phoneNumber: string) => {
			mockAdminAuth.verifyIdToken.mockResolvedValue({
				uid,
				phone_number: phoneNumber,
				...firebaseProject,
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			return client.$fetch("/firebase-auth/sign-in-with-phone", {
				method: "POST",
				body: {
					idToken: idTokenWithClaims({
						sub: uid,
						phone_number: phoneNumber,
						...firebaseProject,
					}),
				},
			});
		};

		const first = await signIn("phone-uid-a", "+15555550144");
		const second = await signIn("phone-uid-b", "+15555550145");

		expect((first.data as any)?.user.email).toBe("phone-user@myapp.example");
		expect((second.error as any)?.status).toBe(401);
	});

	it("should re-parent an orphaned account when the user row was deleted", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res1 = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "token-1" },
		});
		const firstUserId = (res1.data as any).user.id;

		// Delete the user without cascading to its account, as stores like
		// Firestore do. The SQLite test database would cascade otherwise.
		const ctx = await (auth as any).$context;
		ctx.options.database.exec("PRAGMA foreign_keys = OFF");
		await ctx.adapter.delete({
			model: "user",
			where: [{ field: "id", value: firstUserId }],
		});
		expect(
			await ctx.adapter.findMany({
				model: "account",
				where: [{ field: "accountId", value: mockDecodedToken.uid }],
			}),
		).toHaveLength(1);

		const res2 = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "token-2" },
		});
		const secondUserId = (res2.data as any).user.id;
		expect(secondUserId).not.toBe(firstUserId);

		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "accountId", value: mockDecodedToken.uid }],
		});
		expect(accounts).toHaveLength(1);
		expect((accounts[0] as any).userId).toBe(secondUserId);
	});

	it.each([
		["a phone token", "/firebase-auth/sign-in-with-phone"],
		["an unverified email token", "/firebase-auth/sign-in-with-google"],
	])(
		"should keep signing in with %s after the user row was deleted without cascading to its account",
		async (_, path) => {
			const { client, auth } = await getTestInstance(
				{
					plugins: [
						firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
					],
				},
				{ disableTestUser: true },
			);
			mockAdminAuth.verifyIdToken.mockResolvedValue({
				uid: "returning-uid",
				email: path.endsWith("phone") ? undefined : "returning@example.com",
				email_verified: false,
				phone_number: "+15555550150",
				exp: Math.floor(Date.now() / 1000) + 3600,
			});
			const signIn = async (): Promise<any> =>
				client.$fetch(path, {
					method: "POST",
					body: { idToken: "returning-token" },
				});

			const first = await signIn();
			// The SQLite test database cascades the delete; stores like Firestore don't.
			const ctx = await (auth as any).$context;
			ctx.options.database.exec("PRAGMA foreign_keys = OFF");
			await ctx.adapter.delete({
				model: "user",
				where: [{ field: "id", value: first.data.user.id }],
			});
			// The next sign-in gives the UID a new user and re-parents its row.
			const second = await signIn();
			const third = await signIn();

			expect(third.data?.user.id).toBe(second.data.user.id);
			// One row, re-parented, rather than a second row for the same UID.
			const accounts = await ctx.adapter.findMany({
				model: "account",
				where: [{ field: "accountId", value: "returning-uid" }],
			});
			expect(accounts.map((a: any) => a.userId)).toEqual([second.data.user.id]);
		},
	);

	it("should not re-parent an orphaned account into another user that only shares its email", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
				],
			},
			{ disableTestUser: true },
		);
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "orphaned-uid",
			email: "shared@example.com",
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});
		const signIn = async (): Promise<any> =>
			client.$fetch("/firebase-auth/sign-in-with-google", {
				method: "POST",
				body: { idToken: "orphaned-token" },
			});

		const first = await signIn();
		const ctx = await (auth as any).$context;
		ctx.options.database.exec("PRAGMA foreign_keys = OFF");
		await ctx.adapter.delete({
			model: "user",
			where: [{ field: "id", value: first.data.user.id }],
		});
		// Someone else registers the address before the UID signs in again.
		await ctx.internalAdapter.createUser({
			email: "shared@example.com",
			name: "Other",
			emailVerified: true,
		});

		const res = await signIn();

		expect(res.error?.status).toBe(401);
		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "accountId", value: "orphaned-uid" }],
		});
		expect(accounts.map((a: any) => a.userId)).toEqual([first.data.user.id]);
	});

	it("should keep signing in a UID whose account row an earlier version duplicated after deleting its user (better-auth < 1.7)", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({ firebaseAdminAuth: mockAdminAuth as any }),
				],
			},
			{ disableTestUser: true },
		);
		const ctx = await (auth as any).$context;
		if ("findAccountOwnerByKey" in ctx.internalAdapter) {
			// Better Auth 1.7 re-parents orphans itself, and 1.7.3+ refuses a UID
			// with two rows outright.
			return;
		}
		mockAdminAuth.verifyIdToken.mockResolvedValue({
			uid: "duplicated-uid",
			email: "duplicated@example.com",
			email_verified: false,
			exp: Math.floor(Date.now() / 1000) + 3600,
		});
		const signIn = async (): Promise<any> =>
			client.$fetch("/firebase-auth/sign-in-with-google", {
				method: "POST",
				body: { idToken: "duplicated-token" },
			});

		const first = await signIn();
		ctx.options.database.exec("PRAGMA foreign_keys = OFF");
		await ctx.adapter.delete({
			model: "user",
			where: [{ field: "id", value: first.data.user.id }],
		});
		// What earlier versions did on the next sign-in: a new user and a second
		// row, which findOAuthUser returns after the orphaned one.
		const current = await ctx.internalAdapter.createUser({
			email: "duplicated@example.com",
			name: "Current",
			emailVerified: false,
		});
		await ctx.internalAdapter.linkAccount({
			providerId: "firebase",
			accountId: "duplicated-uid",
			userId: current.id,
		});

		const res = await signIn();

		expect(res.data?.user.id).toBe(current.id);
		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "accountId", value: "duplicated-uid" }],
		});
		expect(accounts.map((a: any) => a.userId)).toEqual([
			current.id,
			current.id,
		]);
	});

	it("should backfill issuer on pre-1.7 rows so the account is found again", async () => {
		const { client, auth } = await getTestInstance(
			{
				plugins: [
					firebaseAuthPlugin({
						firebaseAdminAuth: mockAdminAuth as any,
					}),
				],
			},
			{ disableTestUser: true },
		);

		const res1 = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "token-1" },
		});
		const userId = (res1.data as any).user.id;

		const ctx = await (auth as any).$context;
		if (!ctx.tables.account?.fields?.issuer) {
			// better-auth 1.5 – 1.6 and 1.7.3+ key accounts by (providerId,
			// accountId): there is nothing to backfill, and nothing is written.
			expect(await backfillAccountIssuers(auth as any)).toEqual({
				total: 1,
				missing: 0,
				updated: 0,
				issuerRequired: false,
			});
			return;
		}

		// Simulate a row written before 1.7 (no meaningful issuer).
		await ctx.adapter.updateMany({
			model: "account",
			where: [{ field: "accountId", value: mockDecodedToken.uid }],
			update: { issuer: "" },
		});

		const dry = await backfillAccountIssuers(auth as any, { dryRun: true });
		expect(dry).toEqual({
			total: 1,
			missing: 1,
			updated: 0,
			issuerRequired: true,
		});

		const result = await backfillAccountIssuers(auth as any);
		expect(result).toEqual({
			total: 1,
			missing: 1,
			updated: 1,
			issuerRequired: true,
		});

		// The stamped row is found by (issuer, accountId) again: same user, no duplicate.
		const res2 = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "token-2" },
		});
		expect((res2.data as any).user.id).toBe(userId);

		const accounts = await ctx.adapter.findMany({
			model: "account",
			where: [{ field: "accountId", value: mockDecodedToken.uid }],
		});
		expect(accounts).toHaveLength(1);
		expect((accounts[0] as any).issuer).toBe(FIREBASE_ACCOUNT_ISSUER);
	});
});
