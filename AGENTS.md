# AI Assistant Guidelines

This document provides additional context for AI assistants working on this Better Auth Firebase Auth plugin project. **Please read [README.md](./README.md) first** for project overview and features.

**Note:** All planned phases are complete. The plugin is fully implemented and ready for use.

## Quick Reference

- **Main Documentation:** See [README.md](./README.md) for project overview
- **Contributing Guidelines:** See [Better Auth Contributing Guide](https://www.better-auth.com/docs/reference/contributing)
- **Plugin Architecture:** See [Better Auth Plugin Guide](https://www.better-auth.com/docs/guides/your-first-plugin)

## Current Project State

**Phase 1: Project Foundation** ✅ Complete
**Phase 2: Types and Core Structure** ✅ Complete
**Phase 3: Server Plugin - Endpoints** ✅ Complete
**Phase 4: Server Plugin - Hooks** ✅ Complete
**Phase 5: Client Plugin - Methods** ✅ Complete
**Phase 6: Tests** ✅ Complete
**Phase 7: CI/CD and Example Project** ✅ Complete

The project is complete and includes:
- **Configuration files:** `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `biome.json`
- **Build tooling:** `.gitignore`, `.releaserc.json`
- **Documentation:** `README.md`, `AGENTS.md`, `LICENSE`
- **Source code:**
  - `src/types.ts` - TypeScript interfaces and types
  - `src/firebase-auth-plugin.ts` - Server plugin with endpoints and hooks
  - `src/firebase-auth-client-plugin.ts` - Client plugin with methods
  - `src/index.ts` - Main exports
- **Tests:**
  - `src/firebase-auth-plugin.test.ts` - Server plugin tests (12 tests)
  - `src/firebase-auth-client-plugin.test.ts` - Client plugin tests (9 tests)
- **CI/CD:** GitHub Actions workflows for testing and releases
- **Example:** Minimal Next.js example project in `examples/minimal/`

## Project Structure

```
src/
  firebase-auth-plugin.ts      # Server plugin implementation (endpoints and hooks complete)
  firebase-auth-client-plugin.ts # Client plugin implementation (methods complete)
  index.ts                      # Export both plugins and types
  types.ts                      # Plugin-specific types and interfaces
examples/
  minimal/                      # Minimal Next.js example project
.github/
  workflows/
    release.yml                 # CI/CD release workflow
    ci.yml                      # CI workflow for PRs
```

## Key Implementation Patterns

### Server Plugin Structure

- Export a function that returns a `BetterAuthPlugin`
- Plugin must have unique `id: "firebase-auth"`
- Use `createAuthEndpoint` from `better-auth/api` for endpoints
- Use `createAuthMiddleware` from `better-auth/plugins` for hooks
- Follow Better Auth plugin patterns from [plugin guide](https://www.better-auth.com/docs/guides/your-first-plugin)

### Client Plugin Structure

- Export a function that returns a `BetterAuthClientPlugin`
- Use `$InferServerPlugin` to infer types from server plugin
- Use `getActions` to provide client-side methods
- Methods should accept one data argument and optional `fetchOptions`

### Account Storage

- All Firebase Auth methods use `provider: "firebase"` in account records
- `providerAccountId` should be the Firebase UID
- Use `context.adapter.account.create()` or `context.adapter.account.upsert()` for account records

### Endpoint Creation Pattern

```ts
import { createAuthEndpoint } from "better-auth/api";

endpoints: {
	signInWithGoogle: createAuthEndpoint("/firebase-auth/sign-in-with-google", {
		method: "POST",
	}, async (ctx) => {
		// Implementation
		return ctx.json({ success: true });
	}),
}
```

### Hook Pattern

```ts
import { createAuthMiddleware } from "better-auth/plugins";

hooks: {
	before: [
		{
			matcher: (context) => context.path.startsWith("/sign-in/email"),
			handler: createAuthMiddleware(async (ctx) => {
				// Implementation
				return { context: ctx };
			}),
		},
	],
}
```

### Error Handling Pattern

```ts
import { APIError } from "better-auth/api";

if (!token) {
	throw new APIError("BAD_REQUEST", { message: "Token is required" });
}
```

### User and Session Creation

- Use `context.adapter` to create/update users
- Use `context.internalAdapter.createSession()` to create sessions
- Map Firebase user data (uid, email, name, photoURL) to Better Auth user schema

## Important Constraints

- When `serverSideOnly: true`, endpoints are NOT registered
- When `serverSideOnly: true`, client plugin returns empty object from `getActions`
- When `useClientSideTokens: false`, `firebaseConfig` is required
- When `overrideEmailPasswordFlow: true`, `firebaseConfig` is required
- All endpoints should be conditionally registered based on `serverSideOnly` flag
- Password reset requires Firebase Client SDK (needs `firebaseConfig`)
- Hooks intercept Better Auth's `/sign-in/email` and `/sign-up/email` endpoints when `overrideEmailPasswordFlow: true`

## Code Style

- Use BiomeJS for formatting (tab indentation)
- Follow TypeScript strict mode
- Avoid using Classes (follow Better Auth conventions)
- Keep functions small and focused
- Use meaningful variable and function names

## Testing

- Place test files next to source files they test
- Use Vitest for testing
- Use Better Auth test helpers when available
- Test all code paths and error scenarios
- Test with both `useClientSideTokens: true` and `false`
- Test with `overrideEmailPasswordFlow: true` and `false`
- Test with `serverSideOnly: true` and `false`

## Build Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Build the project
- `pnpm test` - Run tests
- `pnpm lint` - Check for linting issues
- `pnpm lint:fix` - Fix auto-fixable linting issues

## Commit Messages

Follow Conventional Commits format:

- `feat(firebase-auth): description` - New features
- `fix(server): description` - Bug fixes
- `docs: description` - Documentation changes
- `chore: description` - Build/tooling changes
- `test(server): description` - Test changes

## References

- [Better Auth Plugin Guide](https://www.better-auth.com/docs/guides/your-first-plugin)
- [Better Auth Plugin Concepts](https://www.better-auth.com/docs/concepts/plugins)
- [Better Auth Contributing Guide](https://www.better-auth.com/docs/reference/contributing)
- [Better Auth Firestore Package](https://github.com/yultyyev/better-auth-firestore) (reference implementation)
