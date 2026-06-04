import { setSessionCookie } from "better-auth/cookies";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrUpdateUser, firebaseAuthPlugin } from "./firebase-auth-plugin";

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

describe("firebaseAuthPlugin", () => {
	const mockAdminAuth = {
		verifyIdToken: vi.fn(),
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
		mockInternalAdapter.createSession.mockResolvedValue(mockSession);
		mockAdminAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);
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

		it("should not register hooks when overrideEmailPasswordFlow is false", () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: false,
			});
			expect(plugin.hooks).toBeUndefined();
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
			expect(plugin.hooks?.before?.length).toBe(2);
		});
	});

	// ─── createOrUpdateUser ──────────────────────────────────────────────

	describe("createOrUpdateUser", () => {
		describe("new user (no existing OAuth or email match)", () => {
			it("should call findOAuthUser with correct args", async () => {
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

				expect(mockInternalAdapter.createUser).toHaveBeenCalledWith({
					email: "test@example.com",
					name: "Test User",
					image: "https://example.com/photo.jpg",
					emailVerified: true,
				});
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

		describe("token without email", () => {
			const tokenNoEmail = {
				uid: "firebase-uid-no-email",
				email: null,
				name: "No Email User",
				picture: null,
				email_verified: false,
				exp: Math.floor(Date.now() / 1000) + 3600,
			};

			it("should pass empty string as email to findOAuthUser", async () => {
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

				expect(mockInternalAdapter.createUser).toHaveBeenCalledWith({
					email: "",
					name: "No Email User",
					image: undefined,
					emailVerified: false,
				});
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
		vi.mocked(setSessionCookie).mockResolvedValue(undefined);
	});

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

		const res = await client.$fetch("/firebase-auth/sign-in-with-google", {
			method: "POST",
			body: { idToken: "firebase-token" },
		});

		const data = res.data as any;
		expect(data.user.id).toBe(preExistingUserId);
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

		expect(res.error).toBeDefined();
	});

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
});
