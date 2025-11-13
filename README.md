# better-auth-firebase-auth

[![npm version](https://img.shields.io/npm/v/@yultyyev/better-auth-firebase-auth.svg)](https://www.npmjs.com/package/@yultyyev/better-auth-firebase-auth)
[![CI](https://github.com/yultyyev/better-auth-firebase-auth/actions/workflows/release.yml/badge.svg)](https://github.com/yultyyev/better-auth-firebase-auth/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**Firebase Authentication plugin for Better Auth.** Integrate Firebase Auth with Better Auth, allowing users to authenticate using Firebase Auth and create Better Auth sessions.

- **Install:** `pnpm add @yultyyev/better-auth-firebase-auth firebase-admin firebase better-auth`

---

## Installation

# npm

```bash
npm install @yultyyev/better-auth-firebase-auth firebase-admin firebase better-auth
```

# pnpm

```bash
pnpm add @yultyyev/better-auth-firebase-auth firebase-admin firebase better-auth
```

# yarn

```bash
yarn add @yultyyev/better-auth-firebase-auth firebase-admin firebase better-auth
```

# bun

```bash
bun add @yultyyev/better-auth-firebase-auth firebase-admin firebase better-auth
```

## Import Paths

To prevent bundling issues where client-side code tries to include server-side dependencies (like `firebase-admin`), the package provides separate export paths:

### Client-side (React components, browser code)

```ts
import { firebaseAuthClientPlugin } from "@yultyyev/better-auth-firebase-auth/client";
```

Use this import in client components, browser-only code, or anywhere the code will run in the browser. This ensures bundlers don't try to include `firebase-admin`.

### Server-side (API routes, server components)

```ts
import { firebaseAuthPlugin } from "@yultyyev/better-auth-firebase-auth/server";
```

Use this import in API routes, server-side code, or server components where Node.js is available.

### Main export (backward compatibility)

```ts
import { firebaseAuthPlugin, firebaseAuthClientPlugin } from "@yultyyev/better-auth-firebase-auth";
```

The main entry point still exports both plugins for backward compatibility, but using the specific paths above is recommended to avoid bundling issues.

## Features

- ✅ Client-side and server-side token generation modes
- ✅ Optional override of Better Auth's built-in email/password flow
- ✅ Password reset functionality
- ✅ Server-side only mode (hidden endpoints, all auth through hooks)
- ✅ Sign in with Google
- ✅ Sign in with email/password
- ✅ Full TypeScript support

## Usage

### Client-side token generation (default)

**Server-side setup (API routes, `lib/auth.ts`):**

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "@yultyyev/better-auth-firebase-auth/server";
import { getAuth } from "firebase-admin/auth";

export const auth = betterAuth({
  plugins: [
    firebaseAuthPlugin({
      useClientSideTokens: true, // Client generates Firebase tokens
      firebaseAdminAuth: getAuth(), // Firebase Admin SDK instance
    }),
  ],
});
```

**Client-side setup (React components, `lib/auth-client.ts`):**

```ts
import { createAuthClient } from "better-auth/react";
import { firebaseAuthClientPlugin } from "@yultyyev/better-auth-firebase-auth/client";

export const authClient = createAuthClient({
  plugins: [
    firebaseAuthClientPlugin({
      // Optional: Add Firebase client config for additional features
    }),
  ],
});
```

### Server-side token generation

**Server-side setup (API routes, `lib/auth.ts`):**

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "@yultyyev/better-auth-firebase-auth/server";
import { getAuth } from "firebase-admin/auth";
import type { FirebaseOptions } from "firebase/app";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.FIREBASE_API_KEY!,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.FIREBASE_PROJECT_ID!,
};

export const auth = betterAuth({
  plugins: [
    firebaseAuthPlugin({
      useClientSideTokens: false, // Server handles Firebase Auth
      firebaseAdminAuth: getAuth(),
      firebaseConfig, // Required for server-side mode
    }),
  ],
});
```

**Client-side setup (React components, `lib/auth-client.ts`):**

```ts
import { createAuthClient } from "better-auth/react";
import { firebaseAuthClientPlugin } from "@yultyyev/better-auth-firebase-auth/client";

export const authClient = createAuthClient({
  plugins: [
    firebaseAuthClientPlugin({
      // No Firebase config needed - server handles everything
    }),
  ],
});
```

## Options

```ts
firebaseAuthPlugin({
  useClientSideTokens?: boolean; // Default: true
  overrideEmailPasswordFlow?: boolean; // Default: false
  serverSideOnly?: boolean; // Default: false
  firebaseAdminAuth?: admin.auth.Auth; // Optional
  firebaseConfig?: FirebaseOptions; // Required for server-side mode
});
```

## Example

See the [minimal example](./examples/minimal) for a complete Next.js setup demonstrating the plugin usage.

## Contributing

Contributions are welcome! Please follow the [Better Auth Contributing Guide](https://www.better-auth.com/docs/reference/contributing) for development setup and code style.

## License

MIT
