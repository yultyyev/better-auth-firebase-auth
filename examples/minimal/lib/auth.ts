import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "better-auth-firebase-auth/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (getApps().length === 0) {
	initializeApp({
		credential: cert({
			projectId: process.env.FIREBASE_PROJECT_ID!,
			clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
			privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
		}),
	});
}

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
	secret: process.env.BETTER_AUTH_SECRET!,
	plugins: [
		firebaseAuthPlugin({
			useClientSideTokens: true,
			firebaseAdminAuth: getAuth(),
		}),
	],
});
