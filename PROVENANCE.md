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

### Review fix B-6 (Oct 29, 2026)

The meeting room page now always shows a "Run plugins" button (`#run-plugins`, disabled once plugins
cannot run: after takeover or once the package leaves "unsent"), so plugins run outside the guided
demo. Written by Muse Code on meta-models/muse-spark-open-1026 via Baseten.

### Review fix B-7 (Oct 29, 2026)

The `mr_store` cookie now carries `Secure` except for plain-http loopback requests
(`meetingRoomSetCookie` in apps/web/src/meetingRoom.ts). Written by Muse Code on
meta-models/muse-spark-open-1026 via Baseten.

### Review fix R2-1 and owner decision MR-G7 (Oct 29, 2026)

Bridgett confirmed MR-G7 as an owner decision (Oct 29, 4:55 PM CT): approval stays on a
same-browser reopen while the server keeps the room. The restored-room line now says so
("draft, send state and approval stay while this server keeps the room") instead of claiming
approval never survives. Written by Muse Code on meta-models/muse-spark-open-1026 via Baseten.

### Review fix R2-3 (Oct 29, 2026)

A `?demo=1` page now always starts on its own fresh, unshared room and store, so the guided demo
never opens on (or writes into) the cookie's real room. Written by Muse Code on
meta-models/muse-spark-open-1026 via Baseten.

### Review fixes B-3 and R2-2 (Oct 29, 2026)

B-3 (a room flood no longer evicts other browsers' rooms: store keys capped at 200 with idle
eviction, `MeetingRoomBusyError`/503, a per-key page cap) was written by Muse Code on muse-spark-1.3
via Meta (session 4bc40127-5104-475d-bb0f-467c792ebdcb); its test typing fix was written by Muse Code
on meta-models/muse-spark-open-1026 via Baseten (session f298034a-3dd6-4959-95af-7e1f0e87b23f).
R2-2 (an evicted key's stale tabs; test MR-F6) was written by Muse Code on
meta-models/muse-spark-open-1026 via Baseten (session dd908779-fcbd-4c36-9847-94d7d8bdbf49).

### Review fix N-1 (Oct 29, 2026)

Store keys that never acted (open only) are now evicted first, least recently opened, so a flood
of plain GETs no longer locks new visitors out; keys that acted are evicted only after 30 idle
minutes, and 503 is returned only when every key acted recently. Written by Muse Code on
meta-models/muse-spark-open-1026 via Baseten.

### Review follow-up to N-1 (Oct 29, 2026)

Only successful state-changing actions (stream-next, guide, select-meeting, edit-draft, approve,
takeover, run-plugins, plugin-*, send, demo-next, demo-restart) mark a store key as acted; GET
opens, `state`, `evidence-export` and refused actions do not (tests MR-A1, MR-A2). An action on an
evicted room now answers 404 with "This room expired. Reload to start again." (test MR-A3).
Written by Muse Code on meta-models/muse-spark-open-1026 via Baseten.

Note: N-1 commit cbe1f21 was run and pushed by hand by Opus on the bot computer at Bridgett's request because the Auto-review safety check was erroring; the code was written by Muse Code.

### Review fixes N-2 and N-3 (Oct 29, 2026)

Demo (?demo=1) pages are capped at 200 globally by evicting the oldest demo page, record no
activity for their key, never mark a key as acted, and no longer count against a key's 20-page
cap (tests MR-DC1, MR-DC2 in apps/web/test/meeting-room-demo-cap.test.ts).
Written by Muse Code on Baseten (meta-models/muse-spark-open-1026).

### Busy page points to the guided demo; limitation L-1 (Oct 29, 2026)

The 503 busy page now reads "Meeting room is busy. Try again later, or open the guided demo at
/meeting-room?demo=1." (test MR-F5), and README "Known limitations" documents L-1: an acting flood
can fill all 200 rooms for up to 30 minutes while the guided demo keeps working.
Written by Muse Code on Baseten (meta-models/muse-spark-open-1026).

### Meeting room actions bound to the browser that opened the room (Oct 29, 2026)

Every POST /api/meeting-room action now checks that the request's own mr_store cookie is the key
that opened the room; another browser's cookie or no cookie gets 404 with no snapshot, across all
action branches including the guided demo (test F140-1a). The cookie Path is now "/" so the browser
sends it to /api/meeting-room; same-cookie tabs share a room and the demo stays isolated (test
F140-1b, real Chrome cookie jar). The test file apps/web/test/meeting-room-browser-binding.test.ts
was written by the runner/executor (Grok Bot) as test scaffolding and copied in by Muse Code with a
single cp; the exact source edits were specified in the task prompt by Grok Bot from a Codex review
finding and applied by Muse Code on Baseten (meta-models/muse-spark-open-1026).

### Approve and Send bound to the displayed package (Oct 29, 2026)

The meeting room snapshot now carries a server-derived packageId (selected meeting id plus the
sha256 of the complete composed package), rendered on the Approve and Send buttons. POST
/api/meeting-room accepts the new packageId field; Approve and Send without a valid identity get
400 and a stale or forged identity gets 409, before the room is touched (tests F140-2a, F140-2b).
The page discards obsolete responses and an unsaved editor change immediately disables Approve,
Send and export and clears the copy/mailto affordances until the edit is saved (test F140-2c).
Both the source edits and the test file apps/web/test/meeting-room-approve-displayed.test.ts were
written by Muse Code on Baseten (meta-models/muse-spark-open-1026), in small edits from exact
contents that Grok Bot specified in the task prompt from a Codex review finding.

### Unsaved package edits survive unrelated responses (Oct 30, 2026)

A Codex recheck of #142 found that any response carrying page HTML (for example Compare) replaced
the page and cleared the unsaved-edit state, so an unsaved correction was discarded and Approve,
Send and export were enabled again for the previously approved text. Now only a successful Save of
the package clears the unsaved state; any other response keeps the editor text and keeps Approve,
Send and export disabled with the copy/mailto affordances cleared. Test F140-2d: approve A, type
unsaved B, Compare, then the editor still shows B, outgoing controls stay disabled and no outgoing
request or fake transport call happens; after Save B and an explicit Approve, exactly one fake
Send carries exactly B. F140-2d failed on aa8f7d9 and passes on this head; F140-2c is unchanged.
The renderer change and the test were written by Muse Code on Baseten
(meta-models/muse-spark-open-1026) from exact contents that Grok Bot specified in the task
prompts, one small part per short Muse session, each committed separately.

### Follow-up: Muse Code rewrote the F140-1 test file (Oct 29, 2026)

The entry "Meeting room actions bound to the browser that opened the room" above records that
apps/web/test/meeting-room-browser-binding.test.ts was first written by
the runner/executor (Grok Bot) as test scaffolding and copied in by Muse Code. In this follow-up
commit Muse Code on Baseten (meta-models/muse-spark-open-1026) deleted that file and wrote it again
itself, in small edits from exact contents Grok Bot specified in the task prompt. The test names
and assertions are unchanged; the only additions are "end of F140-1 test part N" marker comments
that anchored the edits. Original test contents by Grok Bot; Muse Code re-applied them unchanged
with marker comments through Baseten. F140-1a and F140-1b were
re-verified red on d217380 and green on the F140-1 head.

### Package editor edits the owner-written base (Oct 29, 2026)

The meeting room package editor used to hold the full composed package (owner text plus every
included plugin section) while Save stored that text as the editable base, so each unchanged Save
appended the included sections again (799 to 1180 characters in the synthetic fixture) and Exclude
could no longer remove them. The twin room view now exposes draft.base (the owner-editable text
without the managed plugin sections) next to draft.body (the full composed package that is hashed,
approved and sent). The editor renders draft.base; the preview still shows the full draft.body;
Include/Exclude alone manage plugin sections, and no owner-written text is ever deleted by
matching. A real change to an approved package still clears approval (tests F140-3a, F140-3b).
Both the source edits and the test file apps/web/test/meeting-room-editable-base.test.ts were
written by Muse Code on Baseten (meta-models/muse-spark-open-1026), in small edits from exact
contents that Grok Bot specified in the task prompts from a Codex review finding. Because the
provider stream kept failing with protocol errors on one long session, the work was split into
several short sequential Muse sessions, each committed separately on muse/f140-3-editable-base.

### Guided compare and evidence steps show and keep their results (Oct 30, 2026)

Guided steps 7 (compare) and 8 (evidence) used to drop their outputs: the demo-next response
carried only the snapshot and announcements, and every response re-rendered the page empty. The
demo-next response now returns the step-7 comparison and step-8 evidence JSON in the same fields
the Compare and Export actions use, the snapshot keeps both until Restart, and the server render
fills #compare-result and #evidence-json from it, so they stay visible after takeover. On a public
demo the evidence shows the approved package hash and the unsent state, with no send receipt
(tests F140-4c service and browser). The test cases and the source edits in apps/web/src/meetingRoom.ts
and apps/web/src/meetingRoomRender.ts were written by Muse Code on Baseten
(meta-models/muse-spark-open-1026), in small edits from exact contents that Grok Bot specified in the
task prompts from a Codex recheck finding, split into ten short sequential Muse sessions, each
committed separately on muse/f140-4-public-guide.

### Public guided demo no longer stalls at Send; Restart gives a fresh demo room (Oct 29, 2026)

On a public demo (test mode absent or 0) the guided demo used to return 403 at the Send step
forever (completed 5 of 9), and Restart only reset the captions while the room kept its approved,
sent and paused state. Next now records the Send step as not attempted, shows a visible "not sent"
note (no package is marked sent and no send receipt exists), and continues through comparison,
evidence and takeover against the actual approved, unsent package; a direct Send stays 403.
Restart now replaces the demo page's room, in-memory store and guide controller with fresh ones
under the same page id, browser key and demo-cap slot, so a test-mode rerun sends exactly once
more through the fake transport; ordinary rooms are never touched (tests F140-4a, F140-4b). The
demo controller gained skip() for a not-permitted step. The existing MR-R4 render test was updated
to the required behavior (200 and progression to step 6 instead of 403) and keeps its safety
checks: the send-disabled reason is announced, zero fake sends, and the package is not sent.
The source edits, the MR-R4 update and the new test apps/web/test/meeting-room-demo-guide.test.ts
were written by Muse Code on Baseten (meta-models/muse-spark-open-1026), in small edits from exact
contents that Grok Bot specified in the task prompts from a Codex review finding, split into
several short sequential Muse sessions, each committed separately on muse/f140-4-public-guide.
