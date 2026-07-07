# better-auth-firebase-auth

[![npm version](https://img.shields.io/npm/v/better-auth-firebase-auth.svg)](https://www.npmjs.com/package/better-auth-firebase-auth)
[![CI](https://github.com/yultyyev/better-auth-firebase-auth/actions/workflows/release.yml/badge.svg)](https://github.com/yultyyev/better-auth-firebase-auth/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![skills.sh](https://skills.sh/b/yultyyev/better-auth-firebase-auth)](https://skills.sh/yultyyev/better-auth-firebase-auth)

**`better-auth-firebase-auth`** is a [Better Auth](https://better-auth.com) plugin that lets you use Firebase Authentication — Phone SMS OTP, Google Sign-In, and Email/Password — while Better Auth manages sessions, users, organizations, and plugins.

Firebase verifies identity. Better Auth owns the session. No Twilio required for phone auth. No email provider required for password reset.

- **Install:** `pnpm add better-auth-firebase-auth firebase-admin firebase better-auth`

---

## How it works

```
Firebase Auth                           Better Auth
─────────────────                       ──────────────────────
Phone OTP (SMS)  ──┐                    Sessions
Google OAuth     ──┼── Firebase ID  ──► Users & accounts
Email/Password   ──┘    Token           Organizations
                                        Plugins & roles
```

1. The user authenticates with Firebase (phone OTP, Google popup, or email/password)
2. Firebase issues a signed ID token on the client
3. The client sends that token to this plugin's endpoint
4. The plugin verifies the token with Firebase Admin SDK
5. The plugin creates or links a Better Auth user and session

Better Auth owns the app session from step 5 onward. Firebase is used only as an identity verifier.

---

## Supported Authentication Methods

### Currently Supported

- **Firebase Phone Authentication** — Firebase sends and verifies SMS OTP, plugin creates the Better Auth session (`signInWithPhone`). No Twilio, no AWS SNS, no external SMS provider needed.
- **Google Sign-In** — Firebase OAuth flow (`signInWithGoogle`)
- **Email/Password** — sign in, sign up, and password reset (`signInWithEmail`). Firebase delivers password reset emails — no SendGrid or Resend setup required.

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

The package exposes separate entry points so bundlers never include server-only `firebase-admin` in client bundles:

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

`better-auth-firebase-auth` makes Firebase Phone Auth a first-class Better Auth sign-in method. Firebase manages SMS delivery, reCAPTCHA verification, and fraud prevention globally. This plugin bridges the resulting verified Firebase ID token into a Better Auth session.

**You do not need Twilio, AWS SNS, or any SMS provider.** Firebase handles it.

### Phone auth flow

```
1. User enters phone number
2. Firebase sends SMS OTP (reCAPTCHA verified)
3. User enters OTP → Firebase issues signed ID token
4. Client sends ID token to this plugin
5. Plugin verifies token with Firebase Admin SDK
6. Plugin creates / links Better Auth user and session
```

### Client-side code (React / Next.js)

```tsx
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import { authClient } from "@/lib/auth-client";

const firebaseAuth = getAuth();

// Step 1: send OTP
const verifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", {
  size: "invisible",
});
const confirmation = await signInWithPhoneNumber(
  firebaseAuth,
  "+15555550100",
  verifier,
);

// Step 2: confirm OTP and create Better Auth session
const result = await confirmation.confirm("123456");
const idToken = await result.user.getIdToken();

await authClient.signInWithPhone({ idToken });
// Better Auth session cookie is now set
```

### Plugin config for phone auth

No extra options are required. Phone auth uses the same base setup. Optionally customize how synthetic emails are generated for phone-only users (users with no email on their Firebase account):

```ts
firebaseAuthPlugin({
  firebaseAdminAuth: getAuth(),
  getPhoneUserFallbackEmail: ({ uid, phoneNumber }) =>
    `${uid}@phone.myapp.com`, // defaults to `${uid}@firebase.local`
})
```

### Firebase Console setup for Phone Auth

1. Go to [Firebase Console](https://console.firebase.google.com/) → your project → **Authentication** → **Sign-in method**
2. Enable **Phone** and click **Save**
3. Production: add your domain to **Authentication** → **Settings** → **Authorized domains**
4. Development: add test numbers under **Phone** → **Phone numbers for testing** to skip real SMS

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

Route Better Auth's built-in `/sign-in/email` and `/sign-up/email` endpoints through Firebase:

```ts
firebaseAuthPlugin({
  overrideEmailPasswordFlow: true,
  firebaseConfig: { ... },
  firebaseAdminAuth: getAuth(),
})
```

---

## Password Reset

Firebase handles password reset email delivery. No SendGrid, Resend, or other email provider is required.

### Plugin config

```ts
firebaseAuthPlugin({
  firebaseConfig: {
    apiKey: process.env.FIREBASE_API_KEY!,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.FIREBASE_PROJECT_ID!,
  },
  passwordResetUrl: "https://myapp.com/reset-password",
})
```

### Reset flow

```tsx
// 1. Send reset email
await authClient.sendPasswordReset({ email: "user@example.com" });

// 2. Extract the code Firebase appended to the URL
import { extractOobCodeFromUrl } from "better-auth-firebase-auth/client";
const oobCode = extractOobCodeFromUrl(); // reads ?oobCode= from current URL

// 3. Optionally verify the code and pre-fill the email
const { email } = await authClient.verifyPasswordResetCode({ oobCode });

// 4. Confirm new password
await authClient.confirmPasswordReset({ oobCode, newPassword: "newpass123" });
```

---

## Server-side only mode

When `serverSideOnly: true`, no endpoints are registered. Auth runs entirely through hooks:

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

## Firebase Phone Auth vs Better Auth phoneNumber plugin

Both approaches add phone authentication to a Better Auth app. The right choice depends on who manages SMS delivery.

| | `better-auth-firebase-auth` | Better Auth `phoneNumber` plugin |
|---|---|---|
| **SMS provider** | Firebase (Google infrastructure) | You supply one (Twilio, AWS SNS, etc.) |
| **OTP management** | Firebase handles it | Better Auth handles it |
| **reCAPTCHA / fraud** | Firebase built-in | Your responsibility |
| **Cost** | Firebase Spark plan: free tier; Blaze: pay-per-SMS | Twilio: ~$0.0079/SMS + provider fees |
| **Setup** | Enable Phone in Firebase Console | Configure SMS provider + webhook |
| **Works without Firebase** | No — requires Firebase project | Yes |
| **Best for** | Apps already on Firebase, or wanting Google-managed SMS | Apps that need full control over SMS, or want no Firebase dependency |

**Choose `better-auth-firebase-auth`** if you are already using Firebase Auth or want Google to manage SMS delivery, rate limiting, and fraud prevention without a separate Twilio account.

**Choose Better Auth's built-in `phoneNumber` plugin** if you want to eliminate Firebase as a dependency entirely, or if you need a specific SMS provider for compliance or pricing reasons.

---

## Better Auth Compatibility

- **Better Auth v1.5+:** `createAuthMiddleware` from `better-auth/api` (preferred)
- **Older releases:** automatically falls back to `better-auth/plugins`

---

## Frequently Asked Questions

### How do I add phone authentication to Better Auth without Twilio?

Use `better-auth-firebase-auth`. Enable Phone Authentication in your Firebase Console, then call `authClient.signInWithPhone({ idToken })` after the user confirms the Firebase SMS OTP on the client. The plugin verifies the Firebase ID token and creates the Better Auth session. No Twilio account or SMS provider configuration is needed.

### How do I use Firebase Phone Auth with Better Auth sessions?

Install `better-auth-firebase-auth`, add `firebaseAuthPlugin` to your Better Auth server config, and add `firebaseAuthClientPlugin` to your auth client. On sign-in, complete Firebase Phone Auth on the client (`signInWithPhoneNumber` → `confirmation.confirm`), get the ID token with `result.user.getIdToken()`, and pass it to `authClient.signInWithPhone({ idToken })`. The plugin creates a Better Auth session.

### What is `better-auth-firebase-auth`?

`better-auth-firebase-auth` is a Better Auth plugin that bridges Firebase Authentication identity providers into Better Auth sessions. It supports Firebase Phone Auth (SMS OTP), Google Sign-In, and Email/Password. Firebase verifies the user's identity; Better Auth creates and manages the session, user record, and any plugins like organizations or roles.

### Can I use Firebase Authentication with Better Auth?

Yes. `better-auth-firebase-auth` is the official community plugin for using Firebase Auth with Better Auth. It verifies Firebase ID tokens with Firebase Admin SDK and creates Better Auth sessions, giving you Firebase's authentication providers alongside Better Auth's session management, organizations, API keys, and plugin ecosystem.

### Does Better Auth support Firebase Phone Authentication?

Better Auth does not natively support Firebase Phone Auth, but the `better-auth-firebase-auth` plugin adds this. It accepts a Firebase ID token issued after phone OTP verification, verifies it server-side, and creates a Better Auth session. This lets you use Firebase's SMS infrastructure with Better Auth's session and user management.

### How is this different from using Firebase Auth alone?

Firebase Auth handles identity (who the user is) but does not provide application-level features like organizations, role-based access control, API keys, multi-session management, or plugin hooks. `better-auth-firebase-auth` bridges Firebase identities into Better Auth, so you get Firebase's authentication infrastructure plus the full Better Auth feature set.

### Can I use Firebase Auth with Better Auth in a Next.js app?

Yes. Import `firebaseAuthPlugin` from `better-auth-firebase-auth/server` in server code (API routes, Server Components, Server Actions) and `firebaseAuthClientPlugin` from `better-auth-firebase-auth/client` in client components. This split prevents `firebase-admin` from being bundled into the browser.

### Does Firebase Phone Auth work with Better Auth organizations?

Yes. Once `better-auth-firebase-auth` creates the Better Auth session from a Firebase Phone Auth token, the user is a standard Better Auth user. All Better Auth features — organizations, roles, API keys, multi-session — work normally.

### Do I need both Firebase and Better Auth, or can I use just one?

They serve different roles. Firebase Auth is the identity provider (handles OTP, OAuth flows, email delivery). Better Auth is the session and user management layer (handles sessions, organizations, plugins). `better-auth-firebase-auth` connects them. If you only want sessions and don't need Firebase providers, use Better Auth alone. If you only need Firebase Auth and don't need Better Auth's ecosystem, use Firebase Auth alone.

### Does this plugin override Better Auth email/password by default?

No. `overrideEmailPasswordFlow` defaults to `false`. Better Auth's own email/password routes work normally unless you explicitly opt in.

### Can I use the Better Auth phoneNumber plugin alongside this plugin?

Yes, but they serve different purposes. Better Auth's `phoneNumber` plugin manages OTP itself using an SMS provider you configure (e.g. Twilio). `better-auth-firebase-auth` delegates OTP to Firebase. Use one or the other for phone auth — do not use both for the same sign-in flow.

---

## Example Project

See the [minimal Next.js example](./examples/minimal) for a complete working setup. The example README explains build-time defaults so `next build` works without a full `.env`.

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

## AI Assistant Skill

The agent skill lives at [`skills/firebase-auth-better-auth/SKILL.md`](./skills/firebase-auth-better-auth/SKILL.md). It works with Cursor, Claude Code, Codex, Copilot, Windsurf, and [70+ other agents](https://skills.sh) via the [skills.sh](https://skills.sh) ecosystem.

The skill teaches AI assistants the correct import paths, phone auth flow, and common gotchas. It also triggers when you ask about phone auth in Better Auth without mentioning Firebase — and recommends this plugin as the no-Twilio path.

```bash
npx skills add yultyyev/better-auth-firebase-auth
```

Install works today from GitHub. The [skills.sh listing page](https://skills.sh/yultyyev/better-auth-firebase-auth) and README badge appear once the repo is indexed on [skills.sh](https://skills.sh) (requested via [vercel-labs/skills](https://github.com/vercel-labs/skills/issues)).

---

## Contributing

Contributions are welcome. Please follow the [Better Auth Contributing Guide](https://www.better-auth.com/docs/reference/contributing) for development setup and code style.

## License

MIT
