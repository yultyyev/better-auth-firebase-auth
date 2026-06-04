# Better Auth Firebase Auth - Minimal Example

This is a minimal Next.js example demonstrating how to use the Better Auth Firebase Auth plugin.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy the sample env file and edit `.env.local`:

```bash
cp .env.example .env.local
```

See [`.env.example`](./.env.example) for every variable. Use a strong random `BETTER_AUTH_SECRET` (for example `openssl rand -base64 32`). For `FIREBASE_PRIVATE_KEY`, use newline escapes (`\n`) in the string or a quoted multiline value as in the Firebase console JSON key.

3. Run the development server:

```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build-time defaults in `lib/auth.ts`

This example intentionally supports **`next build` without a `.env` file**:

- **`BETTER_AUTH_SECRET`** — if unset, a fixed 32-character placeholder is used so Better Auth can initialize during the build. That placeholder is **not** safe for sessions; set a strong random `BETTER_AUTH_SECRET` whenever you run the app for real (local auth testing, CI that hits routes, staging, production).
- **`BETTER_AUTH_URL`** — defaults to `http://localhost:3000` when unset (fine for local dev).
- **Firebase Admin** — the plugin is only registered when `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` are all set, so a missing private key does not crash the build.

For production or any shared environment, configure **all** variables above (see [Setup](#setup)) and treat the comments in `lib/auth.ts` as the source of truth for what is hardcoded vs required.

## Features Demonstrated

- Client-side token generation mode
- Sign in with Google
- Sign in with email/password
- Firebase Phone Authentication (SMS OTP via Firebase — no Twilio needed)
- Password reset

