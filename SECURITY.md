# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in **better-auth-firebase-auth**, please report it through GitHub:

**Preferred:** [Private vulnerability reporting](https://github.com/yultyyev/better-auth-firebase-auth/security/advisories/new) on this repository.

**Alternative:** Open a [GitHub issue](https://github.com/yultyyev/better-auth-firebase-auth/issues/new) or [pull request](https://github.com/yultyyev/better-auth-firebase-auth/compare) with:

- A description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Suggested mitigation, if any

For non-security bugs and feature requests, use [GitHub issues](https://github.com/yultyyev/better-auth-firebase-auth/issues) as usual.

We aim to acknowledge reports within **72 hours** and will work with you on a fix and coordinated disclosure.

## Scope

In scope:

- This plugin's server and client code (`src/`, published package)
- Authentication flows, token handling, session creation, and account linking implemented by the plugin

Out of scope (report upstream instead):

- Vulnerabilities in [Better Auth](https://github.com/better-auth/better-auth), [Firebase Auth](https://firebase.google.com/support), or your application configuration
- Misconfigured Firebase service accounts, API keys, or environment variables in consumer apps
- Denial-of-service or abuse of Firebase/Better Auth features not specific to this plugin

## Supported Versions

Only the **latest published npm version** of `better-auth-firebase-auth` receives security fixes. Upgrade before reporting issues against older releases.

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |

## Disclosure Policy

- Confirmed issues are patched and released as soon as practicable.
- Advisories are published after a fix is available.
- If no fix is available within **90 days**, we may disclose the issue publicly with credit to the reporter, unless otherwise agreed.

## Security Best Practices for Integrators

When using this plugin in production:

- Keep `firebase-admin` credentials server-side only; never expose service account keys to the client.
- Verify Firebase ID tokens on the server (this plugin does this via Firebase Admin SDK).
- Use HTTPS for all auth endpoints.
- Keep `better-auth`, `firebase`, `firebase-admin`, and this plugin up to date.
- Restrict Firebase API keys with appropriate domain/app restrictions in the Firebase console.

Thank you for helping keep this project and its users safe.
