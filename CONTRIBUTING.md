# Contributing to Better Auth Firebase Auth Plugin

Thank you for your interest in contributing to the Better Auth Firebase Auth plugin! This guide will help you get started with the contribution process.

## Code of Conduct

This project follows the Better Auth [Code of Conduct](https://github.com/better-auth/better-auth/blob/canary/CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Project Structure

This is a standalone plugin for Better Auth with the following structure:

- `/src` - Plugin source code
  - `firebase-auth-plugin.ts` - Server-side plugin implementation
  - `firebase-auth-client-plugin.ts` - Client-side plugin implementation
  - `types.ts` - TypeScript types and interfaces
  - `*.test.ts` - Test files
- `/examples` - Example applications demonstrating plugin usage
  - `/minimal` - Minimal Next.js integration example
- `/dist` - Built output (generated)
- `README.md` - Main documentation
- `AGENTS.md` - AI assistant guidelines

## Development Guidelines

When contributing to this plugin:

- Keep changes focused. Large PRs are harder to review and unlikely to be accepted.
- Ensure all code is type-safe and takes full advantage of TypeScript features.
- Write clear, self-explanatory code. Use comments only when truly necessary.
- Follow Better Auth plugin patterns from the [Plugin Guide](https://www.better-auth.com/docs/guides/your-first-plugin).
- Follow the existing code style and conventions.
- Add tests for all new features and bug fixes.

## Getting Started

1. Fork the repository to your GitHub account

2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/better-auth-firebase-auth.git
   cd better-auth-firebase-auth
   ```

3. Install Node.js (LTS version recommended)

4. Install `pnpm` if you haven't already:
   ```bash
   npm install -g pnpm
   ```

5. Install project dependencies:
   ```bash
   pnpm install
   ```

6. Build the project:
   ```bash
   pnpm build
   ```

7. Run tests to ensure everything works:
   ```bash
   pnpm test
   ```

## Code Formatting with BiomeJS

We use [BiomeJS](https://biomejs.dev/) for code formatting and linting. Before committing, please ensure your code is properly formatted:

```bash
# Check for linting issues
pnpm lint

# Fix auto-fixable issues
pnpm lint:fix
```

## Development Workflow

1. Create a new branch for your changes:
   ```bash
   git checkout -b type/description
   # Example: git checkout -b feat/phone-auth-support
   ```
   
   Branch type prefixes:
   - `feat/` - New features (e.g., new authentication methods)
   - `fix/` - Bug fixes
   - `docs/` - Documentation changes
   - `refactor/` - Code refactoring
   - `test/` - Test-related changes
   - `chore/` - Build process or tooling changes

2. Make your changes following the code style guidelines

3. Add tests for your changes:
   - Place test files next to the source files they test
   - Follow existing test patterns
   - Test all code paths and error scenarios
   - Test different configuration options (e.g., `serverSideOnly`, `useClientSideTokens`)

4. Run the test suite:
   ```bash
   pnpm test
   ```

5. Ensure the build works:
   ```bash
   pnpm build
   ```

6. Check for linting issues:
   ```bash
   pnpm lint
   ```

7. Commit your changes with a descriptive message following Conventional Commits format:
   ```bash
   # For new features
   feat(firebase-auth): add phone number authentication support
   
   # For bug fixes
   fix(server): resolve token verification error for expired tokens
   
   # For documentation
   docs: improve password reset flow examples
   
   # For non-functional changes
   chore: update dependencies to latest versions
   ```

8. Push your branch to your fork

9. Open a pull request against the **main** branch. In your PR description:
   - Clearly describe what changes you made and why
   - Include any relevant context or background
   - List any breaking changes or deprecations
   - Reference related issues or discussions
   - Include examples if adding new features

## Testing

All contributions must include appropriate tests. Follow these guidelines:

- Write unit tests for new features
- Ensure all tests pass before submitting a pull request
- Update existing tests if your changes affect their behavior
- Follow the existing test patterns and structure
- Test different plugin configurations:
  - `serverSideOnly: true` and `false`
  - `useClientSideTokens: true` and `false`
  - `overrideEmailPasswordFlow: true` and `false`

## Adding New Authentication Methods

When adding support for new Firebase authentication methods:

1. Follow the existing pattern from `signInWithGoogle` endpoint
2. All methods should use `provider: "firebase"` in account records
3. Store Firebase UID as `providerAccountId`
4. Use `internalAdapter` for user operations (not `adapter`)
5. Use `adapter` for account operations
6. Follow the core flow:
   - Get and verify Firebase ID token
   - Create/update Better Auth user
   - Create Better Auth session
   - Store account link

## Pull Request Process

1. Create a draft pull request early to facilitate discussion
2. Reference any related issues in your PR description (e.g., "Closes #123")
3. Ensure all tests pass and the build is successful
4. Update documentation as needed (README.md, examples)
5. Keep your PR focused on a single feature or bug fix
6. Be responsive to code review feedback
7. Update AGENTS.md if architectural patterns change

## Code Style

- Follow the existing code style
- Use TypeScript types and interfaces effectively
- Keep functions small and focused
- Use meaningful variable and function names
- Add comments for complex logic only
- Update relevant documentation when making API changes
- Follow the BiomeJS formatting rules (tab indentation)
- Avoid using Classes (follow Better Auth conventions)

## Component-Specific Guidelines

### Server Plugin (`firebase-auth-plugin.ts`)
- Use `createAuthEndpoint` from `better-auth/api` for endpoints
- Use `createAuthMiddleware` from `better-auth/plugins` for hooks
- Throw `APIError` for error handling
- Follow existing endpoint patterns
- Ensure proper Firebase token verification
- Use `internalAdapter` for user operations

### Client Plugin (`firebase-auth-client-plugin.ts`)
- Use `$InferServerPlugin` to infer types from server plugin
- Use `getActions` to provide client-side methods
- Methods should accept one data argument and optional `fetchOptions`
- Return properly typed responses

### Types (`types.ts`)
- Export all public types
- Use clear, descriptive type names
- Add JSDoc comments for complex types
- Keep types consistent with Better Auth patterns

## Documentation

When making changes that affect usage:

- Update README.md with new features or API changes
- Update examples if the change affects integration
- Add code examples for new features
- Document any breaking changes clearly
- Update AGENTS.md for architectural changes

## Example Project

The `/examples/minimal` directory contains a working Next.js integration. When adding features:

- Update the example if your changes affect integration
- Ensure the example still works after your changes
- Add new examples for significant new features

## References

- [Better Auth Plugin Guide](https://www.better-auth.com/docs/guides/your-first-plugin)
- [Better Auth Plugin Concepts](https://www.better-auth.com/docs/concepts/plugins)
- [Better Auth Contributing Guide](https://github.com/better-auth/better-auth/blob/canary/CONTRIBUTING.md)
- [Firebase Admin SDK Documentation](https://firebase.google.com/docs/admin/setup)
- [Firebase Authentication Documentation](https://firebase.google.com/docs/auth)

## Questions or Problems?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Be clear and provide reproduction steps for bugs
- For security issues, please report them privately

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT License).

Thank you for contributing to Better Auth Firebase Auth plugin! 🎉

