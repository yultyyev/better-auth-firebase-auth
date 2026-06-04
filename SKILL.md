---
name: firebase-auth-better-auth
description: >-
  Add Firebase Authentication (Phone SMS OTP, Google Sign-In, Email/Password)
  to a Better Auth app using the better-auth-firebase-auth plugin. Use when
  adding phone authentication to Better Auth without Twilio, integrating
  Firebase Auth with Better Auth sessions, working with the
  better-auth-firebase-auth package, or deciding between Firebase Phone Auth
  and Better Auth's built-in phoneNumber plugin.
---

# Firebase Auth + Better Auth

`better-auth-firebase-auth` bridges Firebase Authentication identity providers into Better Auth sessions. Firebase verifies the user; Better Auth owns the session, users, and plugins.

**Package:** `better-auth-firebase-auth` — [GitHub](https://github.com/yultyyev/better-auth-firebase-auth) · [npm](https://www.npmjs.com/package/better-auth-firebase-auth)

---

## Decision: Firebase Phone Auth vs Better Auth `phoneNumber` plugin

**Use `better-auth-firebase-auth`** when:
- You want phone auth without setting up Twilio or any SMS provider
- You are already using Firebase in your project
- You want Google to manage SMS delivery, reCAPTCHA, and fraud prevention

**Use Better Auth's built-in `phoneNumber` plugin** when:
- You want no Firebase dependency
- You need a specific SMS provider for compliance or cost reasons

---

## Install

```bash
pnpm add better-auth-firebase-auth firebase-admin firebase
```

---

## Import paths — CRITICAL

Always split server and client imports. Never import `firebase-admin` into client bundles.

```ts
// Server ONLY (API routes, server components, server actions)
import { firebaseAuthPlugin } from "better-auth-firebase-auth/server";

// Client ONLY (React components, browser code)
import { firebaseAuthClientPlugin } from "better-auth-firebase-auth/client";
```

---

## Server setup (`lib/auth.ts`)

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "better-auth-firebase-auth/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Initialize Firebase Admin once
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
  plugins: [
    firebaseAuthPlugin({
      useClientSideTokens: true, // client gets Firebase token, server only verifies
      firebaseAdminAuth: getAuth(),
    }),
  ],
});
```

## Client setup (`lib/auth-client.ts`)

```ts
import { createAuthClient } from "better-auth/react";
import { firebaseAuthClientPlugin } from "better-auth-firebase-auth/client";

export const authClient = createAuthClient({
  plugins: [firebaseAuthClientPlugin()],
});
```

---

## Phone Authentication (SMS OTP)

Firebase sends the SMS and verifies the OTP. No Twilio needed.

**Prerequisite:** Enable Phone in Firebase Console → Authentication → Sign-in method.

```tsx
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { authClient } from "@/lib/auth-client";

const firebaseAuth = getAuth();

// 1. Send OTP
const verifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", {
  size: "invisible",
});
const confirmation = await signInWithPhoneNumber(firebaseAuth, "+15555550100", verifier);

// 2. Confirm OTP → get Firebase token → create Better Auth session
const result = await confirmation.confirm(userEnteredCode);
const idToken = await result.user.getIdToken();
await authClient.signInWithPhone({ idToken });
```

Phone-only users (no email on their Firebase account) get a stable synthetic email: `${uid}@firebase.local` by default. Override with `getPhoneUserFallbackEmail`.

---

## Google Sign-In

```tsx
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const result = await signInWithPopup(getAuth(), new GoogleAuthProvider());
const idToken = await result.user.getIdToken();
await authClient.signInWithGoogle({ idToken });
```

---

## Email/Password

```tsx
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const credential = await signInWithEmailAndPassword(getAuth(), email, password);
const idToken = await credential.user.getIdToken();
await authClient.signInWithEmail({ idToken });
```

Password reset is handled by Firebase — no email provider (SendGrid, Resend) needed:

```ts
await authClient.sendPasswordReset({ email });
```

---

## Key options

| Option | Default | Notes |
|---|---|---|
| `useClientSideTokens` | `true` | `false` = server handles Firebase client SDK (needs `firebaseConfig`) |
| `overrideEmailPasswordFlow` | `false` | Intercept Better Auth's `/sign-in/email` and `/sign-up/email` routes |
| `serverSideOnly` | `false` | No endpoints registered; use hooks only |
| `sessionExpiresInDays` | `7` | Better Auth session lifetime |
| `passwordResetUrl` | — | Custom URL for password reset page |
| `getPhoneUserFallbackEmail` | `${uid}@firebase.local` | Stable email for phone-only users |

---

## Common mistakes

- **Importing `firebaseAuthPlugin` in client code** — crashes on `firebase-admin`. Always use the `/server` path on the server and `/client` path in the browser.
- **Forgetting to enable the provider in Firebase Console** — Phone, Google, and Email/Password must each be explicitly enabled under Authentication → Sign-in method.
- **Missing reCAPTCHA container** — `signInWithPhoneNumber` requires a `RecaptchaVerifier` with a DOM element id. For invisible reCAPTCHA use `size: "invisible"`.
- **Firebase Admin not initialized before `getAuth()`** — call `initializeApp()` once before passing `getAuth()` to the plugin.
- **Using `overrideEmailPasswordFlow: true` without `firebaseConfig`** — throws at startup. This mode requires the Firebase client SDK config.
