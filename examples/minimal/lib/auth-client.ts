import { firebaseAuthClientPlugin } from "@yultyyev/better-auth-firebase-auth/client";
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000",
	plugins: [firebaseAuthClientPlugin()],
});
