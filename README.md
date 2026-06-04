# better-auth-firebase-auth

[![npm version](https://img.shields.io/npm/v/better-auth-firebase-auth.svg)](https://www.npmjs.com/package/better-auth-firebase-auth)
[![CI](https://github.com/yultyyev/better-auth-firebase-auth/actions/workflows/release.yml/badge.svg)](https://github.com/yultyyev/better-auth-firebase-auth/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Use Firebase Authentication — Phone, Google, Email/Password — while Better Auth owns sessions, organizations, plugins, and roles.

- **Install:** `pnpm add better-auth-firebase-auth firebase-admin firebase better-auth`

## Why Firebase Auth with Better Auth?

Firebase Authentication is a battle-tested identity platform. Better Auth is a comprehensive session and user management framework for TypeScript apps. This plugin bridges them:

- Firebase verifies identity and handles SMS OTP, OAuth flows, and password emails.
- Better Auth creates and manages sessions, organizations, roles, API keys, and plugins.
- No Twilio account needed for phone auth — Firebase handles SMS delivery globally.
- No email provider setup needed — Firebase handles password reset and verification emails.

```
Firebase Auth                           Better Auth
─────────────────                       ──────────────────────
Phone OTP (SMS)  ──┐                    Sessions
Google OAuth     ──┼── Firebase ID  ──► Users
Email/Password   ──┘    Token           Organizations
                                        Plugins
                                        Roles
```

## Supported Authentication Methods

### Currently Supported

- **Phone Authentication** — Firebase sends/verifies SMS OTP, plugin creates the Better Auth session (`signInWithPhone`)
- **Google Sign-In** — OAuth via Firebase (`signInWithGoogle`)
- **Email/Password** — sign in, sign up, password reset (`signInWithEmail`)

### Not Yet Supported

Social providers (Facebook, GitHub, Twitter/X, Microsoft, Apple, LinkedIn), anonymous auth, SAML/OIDC, MFA, and custom tokens. Contributions welcome — see [Contributing](#contributing).

---

## Installation

```bash
# npm
npm install better-auth-firebase-auth firebase-admin firebase better-auth

# pnpm
pnpm add better-auth-firebase-auth firebase-admin firebase better-auth

# yarn
yarn add better-auth-firebase-auth firebase-admin firebase better-auth

# bun
bun add better-auth-firebase-auth firebase-admin firebase better-auth
```

## Import Paths

The package exposes separate entry points so bundlers never mix server-only `firebase-admin` into client bundles:

```ts
// Server: API routes, server components, server actions
import { firebaseAuthPlugin } from "better-auth-firebase-auth/server";

// Client: React components, browser code
import { firebaseAuthClientPlugin } from "better-auth-firebase-auth/client";

// Main entry (backward compat — prefer specific paths above)
import { firebaseAuthPlugin, firebaseAuthClientPlugin } from "better-auth-firebase-auth";
```

---

## Setup

**Server (`lib/auth.ts`):**

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "better-auth-firebase-auth/server";
import { getAuth } from "firebase-admin/auth";

export const auth = betterAuth({
  plugins: [
    firebaseAuthPlugin({
      useClientSideTokens: true,
      firebaseAdminAuth: getAuth(),
    }),
  ],
});
```

**Client (`lib/auth-client.ts`):**

```ts
import { createAuthClient } from "better-auth/react";
import { firebaseAuthClientPlugin } from "better-auth-firebase-auth/client";

export const authClient = createAuthClient({
  plugins: [firebaseAuthClientPlugin()],
});
```

---

## Firebase Phone Authentication with Better Auth

Firebase Phone Auth works without Twilio or any third-party SMS provider. Firebase handles delivery globally; this plugin bridges the verified Firebase ID token into a Better Auth session.

### Flow

```
1. User enters phone number
2. Firebase sends SMS OTP (reCAPTCHA verified)
3. User enters OTP → Firebase issues ID token
4. Client sends ID token to this plugin
5. Plugin verifies token with Firebase Admin SDK
6. Plugin creates / links Better Auth user and session
```

### Client-side (React / Next.js)

```tsx
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import { authClient } from "@/lib/auth-client";

const firebaseAuth = getAuth();

// Step 1: Set up reCAPTCHA and send OTP
const verifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", {
  size: "invisible",
});
const confirmation = await signInWithPhoneNumber(
  firebaseAuth,
  "+15555550100",
  verifier,
);

// Step 2: Confirm OTP and exchange for Better Auth session
const result = await confirmation.confirm("123456"); // OTP from SMS
const idToken = await result.user.getIdToken();

await authClient.signInWithPhone({ idToken });
// Better Auth session cookie is now set
```

### Server-side plugin config

No extra options are required for phone auth beyond the basic setup. Optionally customize how synthetic emails are generated for phone-only users (users with no email on their Firebase account):

```ts
firebaseAuthPlugin({
  firebaseAdminAuth: getAuth(),
  getPhoneUserFallbackEmail: ({ uid, phoneNumber }) =>
    `${uid}@phone.myapp.com`, // defaults to `${uid}@firebase.local`
})
```

### Firebase Console setup for Phone Auth

1. Open [Firebase Console](https://console.firebase.google.com/) → your project → **Authentication** → **Sign-in method**
2. Enable **Phone** provider and click **Save**
3. For production, add your domain to **Authorized domains** under **Authentication** → **Settings**
4. For development, add test phone numbers under **Phone** → **Phone numbers for testing** (avoids real SMS)

---

## Google Sign-In

```tsx
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const provider = new GoogleAuthProvider();
const result = await signInWithPopup(getAuth(), provider);
const idToken = await result.user.getIdToken();

await authClient.signInWithGoogle({ idToken });
```

---

## Email/Password Authentication

### Client-side token mode (default)

Sign in with Firebase client SDK, then exchange the token:

```tsx
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const credential = await signInWithEmailAndPassword(
  getAuth(),
  "user@example.com",
  "password",
);
const idToken = await credential.user.getIdToken();

await authClient.signInWithEmail({ idToken });
```

### Server-side token mode

Pass credentials directly — the server handles Firebase client SDK:

```ts
firebaseAuthPlugin({
  useClientSideTokens: false,
  firebaseAdminAuth: getAuth(),
  firebaseConfig: {
    apiKey: process.env.FIREBASE_API_KEY!,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.FIREBASE_PROJECT_ID!,
  },
})
```

```tsx
await authClient.signInWithEmail({
  email: "user@example.com",
  password: "password",
});
```

### Override Better Auth email/password flow

Route Better Auth's built-in `/sign-in/email` and `/sign-up/email` through Firebase (requires `firebaseConfig`):

```ts
firebaseAuthPlugin({
  overrideEmailPasswordFlow: true,
  firebaseConfig: { ... },
  firebaseAdminAuth: getAuth(),
})
```

---

## Password Reset

Firebase handles the email delivery. No email provider setup required.

### Plugin config

```ts
firebaseAuthPlugin({
  firebaseConfig: {
    apiKey: process.env.FIREBASE_API_KEY!,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.FIREBASE_PROJECT_ID!,
  },
  passwordResetUrl: "https://myapp.com/reset-password", // optional custom page
})
```

### Reset flow

```tsx
// 1. Send reset email
await authClient.sendPasswordReset({ email: "user@example.com" });

// 2. On the reset page, extract the code Firebase appended to the URL
import { extractOobCodeFromUrl } from "better-auth-firebase-auth/client";
const oobCode = extractOobCodeFromUrl(); // reads ?oobCode= from current URL

// 3. Optionally verify the code and pre-fill the email
const { email } = await authClient.verifyPasswordResetCode({ oobCode });

// 4. Confirm the new password
await authClient.confirmPasswordReset({ oobCode, newPassword: "newpass123" });
```

### Firebase Console setup for password reset

1. Enable **Email/Password** in **Authentication** → **Sign-in method**
2. Add your domain to **Authentication** → **Settings** → **Authorized domains** (required for custom `passwordResetUrl`)
3. Optionally customize templates in **Authentication** → **Templates** → **Password reset**

---

## Server-side only mode

When `serverSideOnly: true`, no endpoints are registered. Auth happens entirely through hooks that intercept Better Auth routes:

```ts
firebaseAuthPlugin({
  serverSideOnly: true,
  overrideEmailPasswordFlow: true,
  firebaseConfig: { ... },
  firebaseAdminAuth: getAuth(),
})
```

---

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `useClientSideTokens` | `boolean` | `true` | Client obtains Firebase token; server only verifies. |
| `overrideEmailPasswordFlow` | `boolean` | `false` | Intercept Better Auth email routes and route through Firebase. |
| `serverSideOnly` | `boolean` | `false` | Register no endpoints; use hooks only. |
| `firebaseAdminAuth` | `Auth` | `getAuth()` | Firebase Admin Auth instance. |
| `firebaseConfig` | `FirebaseOptions` | — | Required for server-side mode, password reset, and `overrideEmailPasswordFlow`. |
| `sessionExpiresInDays` | `number` | `7` | Better Auth session lifetime. |
| `passwordResetUrl` | `string` | — | Custom URL Firebase appends the reset code to. |
| `getPhoneUserFallbackEmail` | `({ uid, phoneNumber }) => string` | `${uid}@firebase.local` | Generate a stable synthetic email for phone-only users. |

---

## Better Auth Compatibility

- **Better Auth v1.5+:** `createAuthMiddleware` from `better-auth/api` (preferred)
- **Older releases:** falls back to `better-auth/plugins`

---

## FAQ

### What is `better-auth-firebase-auth`?

A Better Auth plugin that bridges Firebase Authentication identities into Better Auth sessions. Firebase verifies identity; Better Auth manages sessions, users, organizations, and plugins.

### Does this support Firebase Phone Authentication?

Yes. Phone Auth is a first-class supported method as of v0.2. Firebase handles SMS OTP verification and issues a signed ID token; this plugin verifies that token and creates the Better Auth session. No Twilio or external SMS provider is needed.

### How is Firebase Phone Auth with Better Auth different from Better Auth's built-in phone plugin?

Better Auth's `phoneNumber` plugin manages the OTP lifecycle itself (requires an SMS provider like Twilio). This plugin delegates OTP to Firebase — Google manages SMS delivery, reCAPTCHA, rate limiting, and fraud prevention. Use this plugin when you are already on Firebase or want to avoid setting up a separate SMS provider.

### Does this plugin support Google Sign-In and email/password?

Yes. Google Sign-In, email/password, and phone are all supported. Password reset uses Firebase email delivery — no separate email provider setup required.

### Should I use client-side or server-side token generation?

Use `useClientSideTokens: true` (default) for the simplest setup. Use `false` when you want the server to own Firebase client initialization.

### Can I use this with Next.js?

Yes. Use `better-auth-firebase-auth/server` in server code and `better-auth-firebase-auth/client` in browser/client code to avoid bundling Firebase Admin into the client bundle.

### Does this plugin override Better Auth email/password by default?

No. Set `overrideEmailPasswordFlow: true` to opt in.

---

## Example Project

See the [minimal Next.js example](./examples/minimal) for a complete working setup including Google Sign-In and email/password. The example README explains build-time defaults so `next build` works without a full `.env`.

---

## Firestore Adapter

To store Better Auth data in Firestore, use [@yultyyev/better-auth-firestore](https://www.npmjs.com/package/@yultyyev/better-auth-firestore):

```ts
import { firestoreAdapter } from "@yultyyev/better-auth-firestore";

export const auth = betterAuth({
  database: firestoreAdapter(),
  plugins: [firebaseAuthPlugin({ ... })],
});
```

---

## Contributing

Contributions are welcome. Please follow the [Better Auth Contributing Guide](https://www.better-auth.com/docs/reference/contributing) for development setup and code style.

## License

MIT
