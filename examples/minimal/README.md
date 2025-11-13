# Better Auth Firebase Auth - Minimal Example

This is a minimal Next.js example demonstrating how to use the Better Auth Firebase Auth plugin.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Set up environment variables in `.env.local`:

```env
BETTER_AUTH_SECRET=your-secret-key-here
BETTER_AUTH_URL=http://localhost:3000

FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY=your-private-key

NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
```

3. Run the development server:

```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features Demonstrated

- Client-side token generation mode
- Sign in with Google
- Sign in with email/password
- Password reset

