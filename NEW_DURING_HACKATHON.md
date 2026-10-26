# New during the hackathon (Oct 26–Nov 4, 2026)

Daily log of work added in this repo. Everything below was built this week;
the earlier Second Seat idea and prototype live elsewhere and are not included.

## Oct 26 — Phase 01: Repo bootstrap

- Workspace scaffold: root `package.json` (private, pnpm 9), `pnpm-workspace.yaml`, strict `tsconfig.base.json`.
- `packages/core` with transcript types and the outgoing safeguard (`screenOutgoing`, `classifyIncoming`), zero runtime dependencies.
- `services/bot` stub (fixture model client) and `apps/web` stub (hero heading).
- Tests: `outgoing.test.ts`, `core-deps.test.ts`, plus stub tests.
- CI with typecheck, tests, and a secret scan; README, `.env.example`, license pending note.
