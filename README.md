Pre-existing: the Second Seat idea and an earlier prototype in a separate repo (not included). Built this week (Oct 26–Nov 4): everything in this repo.

# Second Seat

Second Seat is a call companion: it listens along, drafts what Bridgett could say next, and blocks any draft that would commit her to an offer or a purchase. The model does the understanding while small checked gates do the verifying, and every later phase builds on the tested core in this repo.

Run `pnpm i && pnpm test` to install and verify.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 01 | Repo bootstrap | In progress |
| 02 | Parser / normalizer | In progress (branch `hackathon/phase-02-evidence-brief`) |
| 03 | Validators + brief | Planned |
| 04 | Privacy + shield | Planned |
| 05 | Hero page | Planned |
| 06–10 | Support, load, run, docs, video | Planned |

## Use of AI agents

Code in this repo is written with AI coding agents (this phase: Muse Code, model `muse-spark-1.3`, Contributor mode off), reviewed by Bridgett, and merged from draft PRs. Fixtures stand in during development; live calls are only for integration checks.

## Truth seal (Phase 02)

Truth labels are labels, never displayed as model output. Sealed before
any model run; `eval/check-hashes.mjs` makes the scorer refuse to run on
a changed hash.

- Base seal: commit `3690746` (2026-10-26T12:14:14-05:00, SHA256SUMS
  sha256 `1e68350f2b4a3b50cd1fc7dff67b52ee5eaf7ace3d66247dc0085faaf67b3614`).
- Hero slide `eval/truth/frame-01-10.png` added 2026-10-26T12:16:05-05:00,
  regenerated 2026-10-26T12:21:14-05:00 (title separator set as hyphen-minus),
  sha256 `ca1aebcc701b77e86e5d85c74ddd6edf814d68b5bdc52f4c2640f5709cee3d06`
  (only its line changed in `eval/truth/SHA256SUMS`).
