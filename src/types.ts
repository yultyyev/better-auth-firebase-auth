import type { FirebaseOptions } from "firebase/app";
import type { Auth } from "firebase-admin/auth";

export interface FirebaseAuthPluginOptions {
	useClientSideTokens?: boolean;
	overrideEmailPasswordFlow?: boolean;
	serverSideOnly?: boolean;
	firebaseAdminAuth?: Auth;
	firebaseConfig?: FirebaseOptions;
	sessionExpiresInDays?: number;
	/**
	 * On startup, count Firebase account rows that still lack the `issuer`
	 * value Better Auth 1.7.0 – 1.7.2 require and log one warning with the
	 * exact remediation when any are found (two equality-only `count` reads per
	 * process; skipped entirely on Better Auth 1.5 – 1.6 and 1.7.3+, which key
	 * accounts by `(providerId, accountId)`). Set to `false` to disable.
	 *
	 * @default true
	 */
	migrationChecks?: boolean;
	passwordResetUrl?: string;
	/**
	 * Generate a stable synthetic email for phone-only Firebase users who have
	 * no email on their Firebase account. The returned value is stored as the
	 * Better Auth user email and must be unique per user.
	 *
	 * When a Better Auth user already has the returned email, the phone sign-in
	 * is linked to it only if every account on that user is a Firebase account
	 * whose last ID token carried the same number and whose Firebase user no
	 * longer exists (e.g. it was deleted and the number signed up again under a
	 * new UID); that sign-in ends the user's other sessions. Otherwise it is
	 * refused with 401, so a value that isn't unique per phone number, such as a
	 * constant, refuses other phone users instead of merging them.
	 *
	 * Defaults to `${uid}@firebase.local`.
	 */
	getPhoneUserFallbackEmail?: (params: {
		uid: string;
		phoneNumber: string;
	}) => string;
}

export interface SignInWithGoogleRequest {
	idToken: string;
}

export interface SignInWithEmailRequest {
	idToken?: string;
	email?: string;
	password?: string;
}

export interface SignInWithPhoneRequest {
	idToken: string;
}

export interface SendPasswordResetRequest {
	email: string;
}

export interface ConfirmPasswordResetRequest {
	oobCode: string;
	newPassword: string;
}

export interface VerifyPasswordResetCodeRequest {
	oobCode: string;
}

export interface VerifyPasswordResetCodeResponse {
	valid: boolean;
	email: string;
}

export interface AuthResponse {
	user: {
		id: string;
		email: string | null;
		name: string | null;
		image: string | null;
	};
	session: {
		id: string;
		expiresAt: Date;
		token: string;
	};
}
