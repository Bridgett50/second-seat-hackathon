# New during the hackathon (Oct 26–Nov 4, 2026)

Daily log of work added in this repo. Everything below was built this week;
the earlier Second Seat idea and prototype live elsewhere and are not included.

## Oct 26 — Phase 01: Repo bootstrap

- Workspace scaffold: root `package.json` (private, pnpm 9), `pnpm-workspace.yaml`, strict `tsconfig.base.json`.
- `packages/core` with transcript types and the outgoing safeguard (`screenOutgoing`, `classifyIncoming`), zero runtime dependencies.
- `services/bot` stub (fixture model client) and `apps/web` stub (hero heading).
- Tests: `outgoing.test.ts`, `core-deps.test.ts`, plus stub tests.
- CI with typecheck, tests, and a secret scan; README, `.env.example`, license pending note.
Truth seal proof: seal commit 3690746 (2026-10-26 12:14:14 -05:00), made before any model run, in squash-merged PR #2 https://github.com/Bridgett50/second-seat-hackathon/pull/2 (main 8abe1d1); SHA256SUMS sha256 at seal 1e68350f2b4a3b50cd1fc7dff67b52ee5eaf7ace3d66247dc0085faaf67b3614.
- Phase 03a: deterministic brief validators (`validateBrief` in `packages/core/src/evidence/validate.ts` plus `test/evidence-regressions.test.ts`).
