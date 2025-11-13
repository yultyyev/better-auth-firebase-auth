import { beforeEach, describe, expect, it, vi } from "vitest";
import { firebaseAuthPlugin } from "./firebase-auth-plugin";

vi.mock("firebase-admin/auth", () => ({
	getAuth: vi.fn(() => ({
		verifyIdToken: vi.fn(),
	})),
}));

vi.mock("firebase/app", () => ({
	default: {
		initializeApp: vi.fn(),
		getApps: vi.fn(() => []),
	},
}));

vi.mock("firebase/auth", () => ({
	getAuth: vi.fn(() => ({})),
	signInWithEmailAndPassword: vi.fn(),
	createUserWithEmailAndPassword: vi.fn(),
	sendPasswordResetEmail: vi.fn(),
	confirmPasswordReset: vi.fn(),
	updateProfile: vi.fn(),
}));

describe("firebaseAuthPlugin", () => {
	const mockAdminAuth = {
		verifyIdToken: vi.fn(),
	};

	const mockAdapter = {
		getUser: vi.fn(),
		createUser: vi.fn(),
		updateUser: vi.fn(),
		createAccount: vi.fn(),
	};

	const mockInternalAdapter = {
		createSession: vi.fn(),
	};

	const mockContext = {
		context: {
			adapter: mockAdapter,
			internalAdapter: mockInternalAdapter,
		},
		body: {},
		json: vi.fn((data) => Promise.resolve(new Response(JSON.stringify(data)))),
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

	beforeEach(() => {
		vi.clearAllMocks();
		mockAdapter.getUser.mockResolvedValue(null);
		mockAdapter.createUser.mockResolvedValue(mockUser);
		mockAdapter.updateUser.mockResolvedValue(mockUser);
		mockAdapter.createAccount.mockResolvedValue({});
		mockInternalAdapter.createSession.mockResolvedValue(mockSession);
		mockAdminAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);
	});

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

		it("should register endpoints when serverSideOnly is false", () => {
			const plugin = firebaseAuthPlugin({ serverSideOnly: false });
			expect(plugin.endpoints).toBeDefined();
			expect(plugin.endpoints?.signInWithGoogle).toBeDefined();
			expect(plugin.endpoints?.signInWithEmail).toBeDefined();
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
	});

	describe("signInWithGoogle endpoint", () => {
		it("should register signInWithGoogle endpoint", () => {
			const plugin = firebaseAuthPlugin({
				firebaseAdminAuth: mockAdminAuth as any,
			});

			const endpoint = plugin.endpoints?.signInWithGoogle;
			expect(endpoint).toBeDefined();
		});
	});

	describe("signInWithEmail endpoint", () => {
		it("should register signInWithEmail endpoint", () => {
			const plugin = firebaseAuthPlugin({
				useClientSideTokens: true,
				firebaseAdminAuth: mockAdminAuth as any,
			});

			const endpoint = plugin.endpoints?.signInWithEmail;
			expect(endpoint).toBeDefined();
		});
	});

	describe("sendPasswordReset endpoint", () => {
		it("should register sendPasswordReset endpoint", () => {
			const plugin = firebaseAuthPlugin({
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});

			const endpoint = plugin.endpoints?.sendPasswordReset;
			expect(endpoint).toBeDefined();
		});
	});

	describe("confirmPasswordReset endpoint", () => {
		it("should register confirmPasswordReset endpoint", () => {
			const plugin = firebaseAuthPlugin({
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});

			const endpoint = plugin.endpoints?.confirmPasswordReset;
			expect(endpoint).toBeDefined();
		});
	});

	describe("hooks", () => {
		it("should register hooks when overrideEmailPasswordFlow is true", () => {
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

		it("should not register hooks when overrideEmailPasswordFlow is false", () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: false,
			});

			expect(plugin.hooks).toBeUndefined();
		});

		it("should match /sign-in/email path", () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: true,
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});

			const hooks = plugin.hooks?.before;
			expect(hooks).toBeDefined();

			if (hooks) {
				const signInHook = hooks.find((h) =>
					h.matcher({ path: "/sign-in/email" } as any),
				);
				expect(signInHook).toBeDefined();
			}
		});

		it("should match /sign-up/email path", () => {
			const plugin = firebaseAuthPlugin({
				overrideEmailPasswordFlow: true,
				firebaseConfig: {
					apiKey: "test-api-key",
					authDomain: "test.firebaseapp.com",
					projectId: "test-project",
				},
			});

			const hooks = plugin.hooks?.before;
			expect(hooks).toBeDefined();

			if (hooks) {
				const signUpHook = hooks.find((h) =>
					h.matcher({ path: "/sign-up/email" } as any),
				);
				expect(signUpHook).toBeDefined();
			}
		});
	});
});
