# Provenance

Ported Oct 29, 2026 by Muse Code (muse-spark-1.3 via scripts/muse_pr.sh) from
Bridgett50/loving-grace-holo-demo PR #6 (https://github.com/Bridgett50/loving-grace-holo-demo/pull/6),
merged as holo main `8499e74`. PR #6 was built on Oct 29, 2026.
SHAs below are the holo commits that touched each source file.

## Ported core (packages/core/src/t2/ ← holo second-seat/packages/core/src/t2/)

| File | Holo source commits |
|---|---|
| a11y.ts | 9db0ebe |
| demo-e2e.ts | 8a2925d 8c42199 |
| demo-mode.ts | 8a2925d d116ccb |
| email-compare.ts | a9cec24 |
| evidence.ts | e9ecd2b 2d10781 402fbb7 53a49c6 12b4d82 d146b11 |
| guidance.ts | 2d10781 |
| index.ts | e9ecd2b 9db0ebe 8c42199 2d10781 d116ccb 3b514d1 12b4d82 d146b11 a9cec24 b773269 |
| persistence.ts | 8a2925d 2d10781 402fbb7 ae1dd2a 3b514d1 53a49c6 12b4d82 |
| plugins.ts | 8a2925d 402fbb7 3b514d1 |
| redaction.ts | d146b11 |
| sha256.ts | b773269 |
| test-mode-gate.ts | e9ecd2b |
| twin-room.ts | 986880e 1aa6a22 aaaf5d8 e9ecd2b 8a2925d 2fe9f9e 2d10781 402fbb7 ae1dd2a 3b514d1 53a49c6 12b4d82 d146b11 a9cec24 b773269 |

Port edits: NodeNext `.js` import suffixes, strict-mode type fixes
(noUncheckedIndexedAccess, exactOptionalPropertyTypes), and connector injection
(below). No behavior change.

## Ported tests (services/bot/test/ ← holo second-seat/packages/core/test/)

| File | Holo source commits |
|---|---|
| t2-a11y.test.ts | 9db0ebe |
| t2-demo-e2e.test.ts | 8c42199 |
| t2-demo-mode.test.ts | d116ccb |
| t2-email-compare.test.ts | a9cec24 |
| t2-evidence.test.ts | d146b11 |
| t2-gaps.test.ts | ae1dd2a |
| t2-guidance.test.ts | 2d10781 |
| t2-hardening.test.ts | 1aa6a22 e9ecd2b 8a2925d 2fe9f9e |
| t2-lock-cancel.test.ts | 53a49c6 |
| t2-persistence.test.ts | e9ecd2b 12b4d82 |
| t2-plugins.test.ts | e9ecd2b 3b514d1 |
| t2-review-fixes.test.ts | e9ecd2b |
| t2-review-fixes-f2.test.ts | aaaf5d8 |
| t2-review-fixes-r.test.ts | 1aa6a22 |
| t2-takeover-snapshot.test.ts | 402fbb7 |
| t2-twin-room.test.ts | 825cd2b b773269 |

The tests live in services/bot because they run the room against the real
frozen connector, and core cannot import the bot. Two UI/holo-only cases moved
to session B: T17-6 (reads the web meeting-room page) and T18-6 (reads the holo
demo script and README). F2-9 removed in port: asserted holo mirror-connector id
generation; frozen services/bot/src/meeting/connector.ts uses node:crypto.

Not ported:
- holo `t2/connector.ts` (a mirror of this repo's connector)
- `t2-connector-mirror.test.ts` (tests that mirror)
- `t2-connector-suite.test.ts` (this repo's `services/bot/test/meeting-connector.test.ts` covers the real connector)
- the web UI and Playwright (session B)

## New in this repo (Muse Code, this PR; no holo source)

- packages/core/src/t2/connector-port.ts: the connector port type and
  `packageHash`. `@second-seat/bot` depends on core, and core's dependency
  guard allows only relative/`node:` imports, so the twin room takes an
  injected connector factory instead of importing the bot.
- services/bot/src/t2-room.ts: wires the frozen
  `services/bot/src/meeting/connector.ts` into the room. The connector file is unchanged.
- packages/core/test/t2-port.test.ts, services/bot/test/t2-port-wiring.test.ts.

## Pre-event assets

- `apps/web/public/ai-self.png` is a cropped copy of the Oct 14
  `ai-self-bridgett.png` (holo commit a774b23). It shows Bridgett's own likeness.

## Pre-event code

None found (Opus copy check, Oct 29, 2026).

## Commit identities (git log on main `ea11592`, Oct 29, 2026)

- `muse-code@second-seat.local`: 196 commits.
  - 131 are authored "Muse Code".
  - 65 are Bridgett's own hand edits, labeled "Bridgett Sanders (maintainer hand edit)" (47) or "Bridgett Sanders" (18).
- Bridgett50 (GitHub): 96 commits, 81 of them merge commits.
- Cursor Agent: 60 commits.
- Grok Bot: 10 commits.

## Session B: meeting room page (written fresh in the event repo, Oct 29, 2026)

These files were written fresh in this repo on Oct 29, 2026 by Muse Code
(sessions B1–B3 via scripts/muse_pr.sh); behavior follows holo PR #6 (holo
main 8499e74: meeting-room.tsx, page.tsx, demo-flow.spec.ts, demo-e2e
script, README) as a spec only; no holo code copied; the page drives the
twin room only through services/bot/src/t2-room.ts.

- apps/web/src/meetingRoom.ts
- apps/web/src/meetingRoomRender.ts
- apps/web/src/server.ts (routes added)
- apps/web/test/meeting-room-gate.test.ts
- apps/web/test/meeting-room-imports.test.ts
- apps/web/test/meeting-room-render.test.ts (T17-6)
- apps/web/test/meeting-room-demo-docs.test.ts (T18-6)
- apps/web/test/meeting-room-deploy-guard.test.ts
- apps/web/playwright.meeting-room.config.ts
- apps/web/e2e-meeting-room/meeting-room.spec.ts
- scripts/meeting-room-demo.mjs
- README.md (walkthrough section)
- services/bot/test/t2-port-wiring.test.ts (T2P-6)

### Review fix B-1 (Oct 29, 2026)

`act()` in apps/web/src/meetingRoom.ts now enforces input caps before calling
any room method: at most 2,000 characters of guide text, 20,000 characters of
edit-draft or compare text (over a length cap returns 413 with the room
unchanged), and at most 50 guidance entries per meeting (the 51st returns
400). Only `text.length` is checked; over-limit text is never scanned or
redacted. `packages/core/src/t2/redaction.ts` `EMAIL_PATTERN` was bounded
(local part 1-64, domain 1-253, TLD 2-24) to stop quadratic backtracking on
long non-email input; core behavior on normal emails is unchanged.

### Review fix B-4 (Oct 29, 2026)

A refused Send now renders its reason in `#send-notice` (role="alert") next to the Send
button (snapshot field `sendNotice`). Written by Muse Code on meta-models/muse-spark-open-1026
via Baseten (owner-approved after the Meta credits ran out).

### Review fix B-5 (Oct 29, 2026)

The meeting room import guard (apps/web/test/meeting-room-imports.test.ts) now also catches star
re-exports, require/createRequire, path specifiers into packages/core or node_modules/@second-seat/core,
and destructured, bracket or non-literal dynamic imports, and scans .mts/.cts/.cjs/.jsx too.
Written by Muse Code on meta-models/muse-spark-open-1026 via Baseten.
