# Dependency majors not yet taken

Skipped by the in-major bump of 2026-10-17. One line per package:
`package current → latest`, with what holds it.

## Direct dependencies

- `@types/node` 24.19.2 → 26.6.5 — follows CI's Node 24 (`^24` override in
  `pnpm-workspace.yaml`, Dependabot ignores its majors); move it together with
  `node-version` in `ci.yml`.
- `firebase` 12.19.0 → 13.0.0 — Dependabot #84.
- `typescript` (examples/minimal) 6.0.3 → 7.0.2 — pinned `~6.0.3` in f3691cd:
  typescript-eslint has no release that runs on TypeScript 7 yet.
- `vite` 7.3.7 → 8.3.4 — capped by the `vite: ">=7.3.5 <8"` override in
  `pnpm-workspace.yaml`.

## Transitive, capped by an override

- `undici` 7.30.1 → 8.12.2 — `">=7.29.1 <8"`.
- `protobufjs` 7.6.6 → 8.8.1 — `"^7.6.3"`.
- `kysely` 0.28.17 → 0.29.7 — `"^0.28.14"` (0.x minor, treated as a major).

## Held back within a major

None.
