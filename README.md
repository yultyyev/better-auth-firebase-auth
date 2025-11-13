# better-auth-firebase-auth

[![npm version](https://img.shields.io/npm/v/@yultyyev/better-auth-firebase-auth.svg)](https://www.npmjs.com/package/@yultyyev/better-auth-firebase-auth)
[![CI](https://github.com/yultyyev/better-auth-firebase-auth/actions/workflows/release.yml/badge.svg)](https://github.com/yultyyev/better-auth-firebase-auth/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**Firebase Authentication plugin for Better Auth.** Integrate Firebase Auth with Better Auth, allowing users to authenticate using Firebase Auth and create Better Auth sessions.

- **Install:** `pnpm add @yultyyev/better-auth-firebase-auth firebase-admin firebase better-auth`
- **Status:** 🚧 In Development

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

## Features

This plugin will support:

- Client-side and server-side token generation modes
- Optional override of Better Auth's built-in email/password flow
- Password reset functionality
- Server-side only mode (hidden endpoints, all auth through hooks)

## Planned Usage

### Client-side token generation (default)

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "@yultyyev/better-auth-firebase-auth";
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

### Server-side token generation

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "@yultyyev/better-auth-firebase-auth";
import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase/app";
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

## Planned Options

```ts
firebaseAuthPlugin({
	useClientSideTokens?: boolean; // Default: true
	overrideEmailPasswordFlow?: boolean; // Default: false
	serverSideOnly?: boolean; // Default: false
	firebaseAdminAuth?: admin.auth.Auth; // Optional
	firebaseConfig?: FirebaseOptions; // Required for server-side mode
});
```

## Contributing

Contributions are welcome! Please read our [AI Assistant Guidelines](./AGENTS.md) for development setup and code style.

## License

MIT
