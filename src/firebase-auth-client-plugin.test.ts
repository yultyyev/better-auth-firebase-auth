import { beforeEach, describe, expect, it, vi } from "vitest";
import { firebaseAuthClientPlugin } from "./firebase-auth-client-plugin";

describe("firebaseAuthClientPlugin", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue({
			json: () => Promise.resolve({ success: true }),
		});
	});

	describe("plugin initialization", () => {
		it("should create plugin with default options", () => {
			const plugin = firebaseAuthClientPlugin();
			expect(plugin.id).toBe("firebase-auth");
			expect(plugin.$InferServerPlugin).toBeDefined();
		});

		it("should return empty actions when serverSideOnly is true", () => {
			const plugin = firebaseAuthClientPlugin({ serverSideOnly: true });
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			expect(actions).toEqual({});
		});

		it("should return actions when serverSideOnly is false", () => {
			const plugin = firebaseAuthClientPlugin({ serverSideOnly: false });
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			expect(actions).toBeDefined();
			expect(actions?.signInWithGoogle).toBeDefined();
			expect(actions?.signInWithEmail).toBeDefined();
			expect(actions?.sendPasswordReset).toBeDefined();
			expect(actions?.confirmPasswordReset).toBeDefined();
		});
	});

	describe("signInWithGoogle", () => {
		it("should call correct endpoint with idToken", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () =>
					Promise.resolve({
						user: { id: "user-123", email: "test@example.com" },
						session: { id: "session-123", token: "token-123" },
					}),
			});

			await actions.signInWithGoogle({ idToken: "google-id-token" });

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/sign-in-with-google",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ idToken: "google-id-token" }),
				}),
			);
		});

		it("should accept optional fetchOptions", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () => Promise.resolve({ success: true }),
			});

			await actions.signInWithGoogle(
				{ idToken: "google-id-token" },
				{ headers: { "Custom-Header": "value" } },
			);

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/sign-in-with-google",
				expect.objectContaining({
					method: "POST",
					headers: { "Custom-Header": "value" },
				}),
			);
		});
	});

	describe("signInWithEmail", () => {
		it("should call correct endpoint with idToken", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () =>
					Promise.resolve({
						user: { id: "user-123", email: "test@example.com" },
						session: { id: "session-123", token: "token-123" },
					}),
			});

			await actions.signInWithEmail({ idToken: "email-id-token" });

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/sign-in-with-email",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ idToken: "email-id-token" }),
				}),
			);
		});

		it("should call correct endpoint with email and password", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () =>
					Promise.resolve({
						user: { id: "user-123", email: "test@example.com" },
						session: { id: "session-123", token: "token-123" },
					}),
			});

			await actions.signInWithEmail({
				email: "test@example.com",
				password: "password123",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/sign-in-with-email",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						email: "test@example.com",
						password: "password123",
					}),
				}),
			);
		});
	});

	describe("sendPasswordReset", () => {
		it("should call correct endpoint with email", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () =>
					Promise.resolve({
						success: true,
						message: "Password reset email sent",
					}),
			});

			await actions.sendPasswordReset({ email: "test@example.com" });

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/send-password-reset",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ email: "test@example.com" }),
				}),
			);
		});
	});

	describe("confirmPasswordReset", () => {
		it("should call correct endpoint with oobCode and newPassword", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () =>
					Promise.resolve({
						success: true,
						message: "Password reset confirmed",
					}),
			});

			await actions.confirmPasswordReset({
				oobCode: "oob-code-123",
				newPassword: "newpassword123",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/confirm-password-reset",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						oobCode: "oob-code-123",
						newPassword: "newpassword123",
					}),
				}),
			);
		});
	});

	describe("verifyPasswordResetCode", () => {
		it("should call correct endpoint with oobCode", async () => {
			const plugin = firebaseAuthClientPlugin();
			const actions = plugin.getActions?.(
				mockFetch as any,
				{} as any,
				{} as any,
			);
			if (!actions) throw new Error("Actions should be defined");

			mockFetch.mockResolvedValue({
				json: () =>
					Promise.resolve({
						valid: true,
						email: "test@example.com",
					}),
			});

			await actions.verifyPasswordResetCode({
				oobCode: "oob-code-123",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"/firebase-auth/verify-password-reset-code",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						oobCode: "oob-code-123",
					}),
				}),
			);
		});
	});
});
