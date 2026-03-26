import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "better-auth-firebase-auth/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Firebase Admin only when a real service account is present (must look like PEM).
// Placeholder values like FIREBASE_PRIVATE_KEY=dummy would otherwise pass the presence
// check and break `next build` / CI with "Invalid PEM".
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const firebaseConfigured =
	!!process.env.FIREBASE_PROJECT_ID &&
	!!process.env.FIREBASE_CLIENT_EMAIL &&
	!!privateKey &&
	(privateKey.includes("BEGIN PRIVATE KEY") ||
		privateKey.includes("BEGIN RSA PRIVATE KEY"));

if (firebaseConfigured && getApps().length === 0) {
	initializeApp({
		credential: cert({
			projectId: process.env.FIREBASE_PROJECT_ID!,
			clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
			privateKey: privateKey!.replace(/\\n/g, "\n"),
		}),
	});
}

export const auth = betterAuth({
	// Hardcoded fallback: local dev default only. Set BETTER_AUTH_URL in production.
	baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
	// Hardcoded fallback: allows `next build` with no `.env` (Better Auth requires a
	// secret of sufficient length). This value is NOT secret-safe — you MUST set
	// BETTER_AUTH_SECRET for any real environment (dev with auth, staging, prod, CI).
	secret: process.env.BETTER_AUTH_SECRET || "00000000000000000000000000000000",
	plugins: firebaseConfigured
		? [
				firebaseAuthPlugin({
					useClientSideTokens: true,
					firebaseAdminAuth: getAuth(),
				}),
			]
		: [],
});
