# Demo script (offline replay of one pasted meeting) — max 3:00

Timecodes are the script's own timeline, not measured claims. Every other number carries its source file in brackets. If a number below has no bracket, cut it before recording.

Founder story: PENDING — not yet supplied. User observations: PENDING — not yet supplied. Video URLs: PENDING — not yet supplied. Record nothing for these slots until they are supplied; invent no quotes, anecdotes, or URLs.

The whole video follows ONE meeting through the connected `/session` flow (`apps/web`, PRs A4–A8): paste transcript text, redaction review, approval, analysis, correction, editable draft, exact-draft approval, copy. No screenshot upload. No SAM. No timed replay. SAM/image features are experimental, outside the core flow, and off by default — they do not appear in this video.

| Time | On screen | Bridgett says |
|---|---|---|
| 0:00–0:04 | Disclosure card, held full screen: "Pre-existing: the Second Seat idea and an earlier prototype in a separate repo. Built this week (Oct 26–Nov 4): everything in this repo." | "Pre-existing: the Second Seat idea and an earlier prototype in a separate repo. Built this week (Oct 26 to Nov 4): everything in this repo." |
| 0:04–0:10 | The `/session` page with the persistent "Offline demo" label (`#offline-label`). Empty `#transcript-input`. | "This is Second Seat, in offline demo mode. One meeting, pasted as text, start to finish. It never joins calls and never sends a reply or message to the vendor." |
| 0:10–0:30 | Paste: meeting text filled into `#transcript-input`. Click `#btn-redact`. State reads "Review required" (`#session-state`). The redacted text is shown for review. | "I paste in the meeting text. The offline redaction step masks the PII first, and I review the redacted text before anything else happens." |
| 0:30–0:50 | Review and correction: the redacted text on screen; a correction is made to the redacted text. Click `#btn-approve`. State reads "Approved." | "I check the redaction and fix what it got wrong. Nothing moves forward until I approve this exact text." |
| 0:50–1:20 | Analysis: click `#btn-analyze`. State reads "Completed." Findings with citations (`#results .result .citations a`, `#seg-N` resolving to `#segments`). Pressure badge on the quoted span "You already confirmed the 15th, so I just need a yes before 5 today or the price doubles. Only two production slots left." [eval/truth/hero.transcript.txt]. | "Only the text I approved gets analyzed. Every finding cites the exact segment it came from, and pressure items quoting the current transcript are shown as an assessment and must each be reviewed before Copy is enabled." |
| 1:20–1:35 | Pressure review: tick each `.pressure-review` checkbox (check); `#btn-copy` stays disabled until all are reviewed. | "I review each pressure item first — Copy stays disabled until every item is checked." |
| 1:35–1:50 | Draft: the editable draft (`#draft-text`). I type the reply, including a yes I should not send yet. `#btn-copy` stays disabled until approval. Click `#btn-draft-approve`; `#draft-status` confirms; `#btn-copy` enables. Click `#btn-copy`. | "I write the reply myself — even a hasty yes. Copy stays disabled until I approve the exact current draft text and review every pressure item; it only writes that text to my clipboard; any edit to the draft or transcript clears the approval. Then I copy it out. Second Seat never sends a reply or message to the vendor." |
| 1:50–2:15 | Results table, read exactly as the files say. Support judge, fixture judge standing in for Spark offline [eval/results/support-table.md]: catch 9/9, Wilson 95% CI [0.701, 1] [eval/results/support-table.md]; false alarms 0/4, CI [0, 0.49] [eval/results/support-table.md]. Frozen-live rerun shown with its warts: 2 mismatched cases [eval/results/support-table-frozen-live.md]. No head-to-head claim against any outside study; an outside persuasion study is motivation only, and its numbers are not mine to quote. | "The judge caught 9 out of 9 seeded errors with zero false alarms on these cases — small samples, shown warts and all, including the two mismatches on the rerun." |
| 2:15–2:40 | Glimmer redaction, historical run with its limitations on screen: requests 6/8 completed, legacy entity disappearance 18/29 on completed cases and 18/39 end-to-end, `complete: false`; span coverage not re-scorable [services/bot/fixtures/glimmer-run/rescore.json]. The n=10 10/10 figure [services/bot/fixtures/glimmer-live-eval-n10.json] shown only as a small smoke test, never as the headline. | "The larger Glimmer run is incomplete: six of eight requests finished, eighteen of thirty-nine entities end to end. I show it because hiding it would be dishonest. The ten-out-of-ten is a tiny smoke test, not proof." |
| 2:40–2:55 | Engineering proof, fixture mode only: HTTP p50 106.6ms, p90 116.3ms; brief pipeline p50 1.4ms, p90 4.2ms [eval/results/load-fixture.md]. Failure-modes table on screen [docs/failure-modes.md]. Caps on screen: $5/day spend cap plus daily call-count cap with refuse-and-stop behavior [docs/failure-modes.md] (`services/bot/src/brief/costGuard.ts`). Privacy stated as code behavior only: approved redacted text goes through the privacy gate; test mode stays offline even with credentials present [apps/web/src/liveConfig.ts]. | "Estimated-cost refuse-and-stop at the $5/day estimate and daily call-count caps, retries then a hard stop on model errors, and every number here traces to a file in this repo." |
| 2:55–3:00 | Logo. | "Come and build the future of superintelligence, with a human in the final seat." |

## Honesty rules (read before recording)

- Say "replay" or "offline demo," never "live analysis." Second Seat never joins calls and never sends a reply.
- Show only the connected `/session` paste-to-copy flow with real UI states (`#transcript-input`, `#btn-redact`, `#session-state`, `#btn-approve`, `#btn-analyze`, `#draft-text`, `#btn-draft-approve`, `#btn-copy`, `#offline-label`).
- No screenshot upload, no SAM, no timed replay in the core video. SAM/image features are experimental and off by default.
- Show the incomplete historical Glimmer run WITH its limitations (6/8 requests, 18/39 end-to-end, span coverage not re-scorable) [services/bot/fixtures/glimmer-run/rescore.json]. Never present the n=10 10/10 smoke test [services/bot/fixtures/glimmer-live-eval-n10.json] as the headline.
- Never state "the raw transcript never left our server" as a guarantee. Say what the code does: the approved redacted text goes through the privacy gate, and test mode stays offline even with credentials present [apps/web/src/liveConfig.ts].
- Founder story, user observations, and video URLs are PENDING — not yet supplied. Invent nothing: no user quotes, no founder anecdotes, no URLs.
- Statuses spoken accurately: A1–A9 merged, criteria met on the tested commits, live execution NOT performed, partner none; draft PRs B1–B8 pending review.

## 30–60 s 9:16 clip cut list

- 0:00–0:03: disclosure card, first line spoken, cropped to vertical.
- 0:03–0:20: paste into `#transcript-input`, `#btn-redact`, "Review required" state.
- 0:20–0:35: `#btn-approve`, `#btn-analyze`, findings with citations resolving to `#segments`.
- 0:35–0:50: `#draft-text` edit, `#btn-draft-approve`, `#btn-copy` enabling, copy.
- 0:50–1:00: logo and closing line.

## Recording checklist

- Fixture mode for every replayed beat; the "Offline demo" label visible throughout.
- One capped live clip maximum ONLY if a live run has actually been performed and logged; otherwise no live clip. Never substitute a fixture for a live call.
- Backups of the recording on 2 devices before editing.
- Before export: every on-screen number traced to a file in brackets; any number without a source cut.
