import type { FirebaseOptions } from "firebase/app";
import type { Auth } from "firebase-admin/auth";

export interface FirebaseAuthPluginOptions {
	useClientSideTokens?: boolean;
	overrideEmailPasswordFlow?: boolean;
	serverSideOnly?: boolean;
	firebaseAdminAuth?: Auth;
	firebaseConfig?: FirebaseOptions;
	sessionExpiresInDays?: number;
	passwordResetUrl?: string;
	/**
	 * Generate a stable synthetic email for phone-only Firebase users who have
	 * no email on their Firebase account. The returned value is stored as the
	 * Better Auth user email and must be unique per user.
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
