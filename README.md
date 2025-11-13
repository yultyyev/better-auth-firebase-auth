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

## Password Reset

### Firebase Console Setup (Required)

Before using password reset, configure your Firebase project:

#### 1. Enable Email/Password Authentication
- Go to [Firebase Console](https://console.firebase.google.com/)
- Select your project → **Authentication** → **Sign-in method**
- Enable **Email/Password** provider
- Click **Save**

#### 2. Add Authorized Domains (CRITICAL for Custom URLs)
- Go to **Authentication** → **Settings** → **Authorized domains**
- Add your application domains:
  - Development: `localhost` (already included by default)
  - Production: `yourdomain.com`, `www.yourdomain.com`
- ⚠️ **Important**: Any domain used in `passwordResetUrl` MUST be in this list, or Firebase will reject the request

#### 3. Customize Email Template (Optional)
- Go to **Authentication** → **Templates** → **Password reset**
- Customize the email subject, body, and sender name
- The email will contain a link to your `passwordResetUrl` with the reset code

### Plugin Configuration

```ts
import { betterAuth } from "better-auth";
import { firebaseAuthPlugin } from "@yultyyev/better-auth-firebase-auth/server";

export const auth = betterAuth({
  plugins: [
    firebaseAuthPlugin({
      firebaseConfig: {
        apiKey: process.env.FIREBASE_API_KEY!,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.FIREBASE_PROJECT_ID!,
      },
      passwordResetUrl: "https://myapp.com/reset-password", // Your custom reset page
      // OR omit passwordResetUrl to use Firebase's default URL
    }),
  ],
});
```

**Note**: If `passwordResetUrl` is not provided, Firebase uses its default URL (`https://YOUR_PROJECT.firebaseapp.com/__/auth/action`), which works without any additional setup but doesn't match your app's branding.

### Password Reset Flow

#### Step 1: Request Password Reset

```typescript
await authClient.sendPasswordReset({ 
  email: "user@example.com" 
});
// User receives email with link like: https://myapp.com/reset-password?oobCode=ABC123&mode=resetPassword
```

#### Step 2: Extract Code from URL

On your reset password page (`/reset-password`):

```typescript
import { extractOobCodeFromUrl } from "@yultyyev/better-auth-firebase-auth/client";

// Extracts oobCode from current URL query parameters
const oobCode = extractOobCodeFromUrl(); 

if (!oobCode) {
  // Show error: Invalid or missing reset code
  return;
}
```

#### Step 3: Verify Reset Code (Optional but Recommended)

```typescript
try {
  const { valid, email } = await authClient.verifyPasswordResetCode({ 
    oobCode 
  });
  
  // Show reset form with email pre-filled
  console.log("Reset password for:", email);
} catch (error) {
  // Show error: Invalid or expired reset code
}
```

#### Step 4: Confirm New Password

```typescript
try {
  await authClient.confirmPasswordReset({
    oobCode,
    newPassword: "newSecurePassword123",
  });
  
  // Success! Redirect to login page
} catch (error) {
  // Show error: Failed to reset password
}
```

### Complete Example

```tsx
// app/reset-password/page.tsx
"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { extractOobCodeFromUrl } from "@yultyyev/better-auth-firebase-auth/client";

export default function ResetPasswordPage() {
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const code = extractOobCodeFromUrl();
    if (!code) {
      setError("Invalid or missing reset code");
      return;
    }
    setOobCode(code);

    // Verify the code
    authClient.verifyPasswordResetCode({ oobCode: code })
      .then(({ email }) => setEmail(email))
      .catch(() => setError("Invalid or expired reset code"));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oobCode) return;

    try {
      await authClient.confirmPasswordReset({
        oobCode,
        newPassword,
      });
      setSuccess(true);
    } catch (err) {
      setError("Failed to reset password");
    }
  };

  if (error) return <div>Error: {error}</div>;
  if (success) return <div>Password reset successful! <a href="/login">Login</a></div>;

  return (
    <form onSubmit={handleSubmit}>
      <h1>Reset Password</h1>
      <p>Email: {email}</p>
      <input
        type="password"
        placeholder="New password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
      />
      <button type="submit">Reset Password</button>
    </form>
  );
}
```

### Troubleshooting

**Error: "Invalid action code"**
- The reset link has expired (default: 1 hour)
- The code has already been used
- Solution: Request a new password reset email

**Error: "Unauthorized domain"**
- Your `passwordResetUrl` domain is not in Firebase's authorized domains list
- Solution: Add the domain in Firebase Console → Authentication → Settings → Authorized domains

**Email not received**
- Check spam/junk folder
- Verify the email address is registered in Firebase Auth
- Check Firebase Console → Authentication → Templates for email settings

## Options

```ts
firebaseAuthPlugin({
  useClientSideTokens?: boolean; // Default: true
  overrideEmailPasswordFlow?: boolean; // Default: false
  serverSideOnly?: boolean; // Default: false
  firebaseAdminAuth?: admin.auth.Auth; // Optional
  firebaseConfig?: FirebaseOptions; // Required for server-side mode
  passwordResetUrl?: string; // Custom URL for password reset page
  sessionExpiresInDays?: number; // Default: 7
});
```

## Example

See the [minimal example](./examples/minimal) for a complete Next.js setup demonstrating the plugin usage.

## Contributing

Contributions are welcome! Please follow the [Better Auth Contributing Guide](https://www.better-auth.com/docs/reference/contributing) for development setup and code style.

## License

MIT
