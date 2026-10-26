# Demo script (replay, not live analysis) — max 3:00

Timecodes are the script's own timeline, not measured claims. Every other number carries its source file in brackets. If a number below has no bracket, cut it before recording.

| Time | On screen | Bridgett says |
|---|---|---|
| 0:00–0:04 | Disclosure card, held full screen: "Pre-existing: the Second Seat idea and an earlier prototype in a separate repo. Built this week (Oct 26–Nov 4): everything in this repo." | "Pre-existing: the Second Seat idea and an earlier prototype in a separate repo. Built this week (Oct 26 to Nov 4): everything in this repo." |
| 0:04–0:08 | Cold open: pressure badge on the quoted span "You already confirmed the 15th, so I just need a yes before 5 today or the price doubles. Only two production slots left." [eval/truth/hero.transcript.txt] plus the held "Approved" draft. Persistent label: "Replay of an owner-supplied recording. Analysis precomputed; Second Seat never joins your calls." | "This is the moment my AI held my yes until I saw the evidence. No retrieval here. The value is pressure detection plus a gate the model can't override." |
| 0:08–0:20 | Title card: Bridgett, owner of a small South Side business, vendor call on the calendar. | "I run a small business. Vendors push. Agents will push harder. You can't be in every meeting. Hand Second Seat the recording, and it shows you who pushed, and how, before you say yes." |
| 0:20–0:35 | Upload: transcript text file plus a screenshot dropped in, then normalized on screen. No PDF drop anywhere. The PDF normalizer was cut, so no PDF appears. | "I drop in what I already have: the transcript export and a screenshot. Nothing is captured live." |
| 0:35–0:50 | Agent loop diagram, each chip lighting as it fires: ingest, then Glimmer PII redaction on our server, then Muse Spark brief plus tactic classifier, then SAM 3.1 on masked screenshots, then charter checks, then the owner's decision. Caption: "Second Seat takes no action itself." | "Open-weights Glimmer redacts on our server first. Spark only sees redacted text. SAM only sees masked screenshots." |
| 0:50–1:30 | Replay at 2x speed with segments streaming in along the recording timeline, labeled "Replay — precomputed analysis." The hero call: Okafor Bakehouse and Brightline Packaging, synthetic meeting [eval/truth/hero.labels.json]. At [12:41] the vendor says: "You already confirmed the 15th, so I just need a yes before 5 today or the price doubles." [eval/truth/hero.transcript.txt] | "Watch the right side." (Quiet. Let it play.) |
| 1:30–1:45 | Pressure badge with the quoted span and the clickable segment. Conflict card: "Slide says 30th [eval/truth/hero.transcript.txt] vs vendor claims 15th [eval/truth/hero.transcript.txt]." SAM note on screen: text concepts fell back to full-frame boxes, so no zoom-to-evidence claim [docs/failure-modes.md]. | "Scarcity and commitment, quoted word for word, and the slide contradicts him. On SAM, full honesty: text concepts got full-frame boxes, so I show the flag, not a zoom." |
| 1:45–2:00 | I type "Yes, approved, go ahead with the order." into the Draft reply box, which Second Seat never sends. Amber hold appears: "Held: review the 1 pressure item first" (count as rendered on the page, apps/web e2e). I click Approve on the items. "Copy draft" unlocks. | "Even when I draft a yes in the heat of the moment, it holds it until I've seen the evidence. Then the decision is mine." |
| 2:00–2:15 | "What left this server" panel: the Spark payload with PII redacted, no raw transcript, masked images listed. Glimmer recall shown: 10/10 on n=10 [services/bot/fixtures/glimmer-live-eval-n10.json]. | "The raw transcript never left our server. Spark saw redacted text. SAM saw masked screenshots. Redaction recall was 10/10 on n=10 [services/bot/fixtures/glimmer-live-eval-n10.json]. Small sample, so I read it as a smoke test, not proof." |
| 2:15–2:35 | Results table, read exactly as the files say. Support judge, fixture judge standing in for Spark offline [eval/results/support-table.md]: catch 9/9, Wilson 95% CI [0.701, 1] [eval/results/support-table.md]; false alarms 0/4, CI [0, 0.49] [eval/results/support-table.md]. Frozen-live rerun shown with its warts: 2 mismatched cases [eval/results/support-table-frozen-live.md]. The gate row is labeled "0 approvals by construction." No head-to-head claim against any outside study; an outside persuasion study is motivation only, and its numbers are not mine to quote. The 39-item run is not shown and not claimed. | "Here's what our classifier caught, misses included. Catch 9/9 [eval/results/support-table.md]. False alarms 0/4 [eval/results/support-table.md]. The frozen rerun mismatched 2 cases [eval/results/support-table-frozen-live.md], and I show that too. The gate row reads 0 approvals by construction." |
| 2:35–2:50 | One capped live run on a dev meeting the demo has not shown, with the real latency and cost overlay from the log: dev totals validator-clean 10/10, recall 13/16, agreement 9/13, cost $0.0547 [eval/results/dev-briefs.md]. Engineering proof, fixture mode only: HTTP p50 106.6ms, p90 116.3ms; brief pipeline p50 1.4ms, p90 4.2ms [eval/results/load-fixture.md]. Failure-modes table on screen [docs/failure-modes.md]. Caps on screen: $5/day spend cap with refuse-and-stop behavior [docs/failure-modes.md]. | "Capped spend, retries then a hard stop on model errors, and every number here was measured this week. Dev totals: 10/10 clean, 13/16 recall, $0.0547 [eval/results/dev-briefs.md]. Fixture latency p50 106.6ms [eval/results/load-fixture.md]. Caps stop the call at $5 a day [docs/failure-modes.md]." |
| 2:50–3:00 | Logo. "Other tools summarize your meeting. Second Seat shows who is pressuring you, and how." | "Come and build the future of superintelligence, with a human in the final seat." |

## Honesty rules (read before recording)

- Say "replay," never "live analysis." Second Seat never joins calls.
- Show only Oct 26+ artifacts on screen. Never show a hand-written fixture as model output. Recorded fixtures come from a logged live call.
- Glimmer is self-hosted; recall 10/10 holds on n=10 only [services/bot/fixtures/glimmer-live-eval-n10.json]. Small sample, say so.
- Do not claim SAM found a specific concept. SAM fell back to full-frame for text concepts [docs/failure-modes.md].
- Do not mention the invalid 39-item run as a result.
- The resistance table goes on screen only with whatever the log actually says at record time. No shield off/pattern-only/on numbers exist in the allowed inputs, so no such numbers appear above.

## 30–60 s 9:16 clip cut list

- 0:00–0:03: disclosure card, first line spoken, cropped to vertical.
- 0:03–0:20: the [12:41] span [eval/truth/hero.transcript.txt] plus the pressure badge and the held draft.
- 0:20–0:35: the amber hold clearing after review, "Copy draft" unlocking.
- 0:35–0:50: the redaction panel plus recall 10/10 on n=10 [services/bot/fixtures/glimmer-live-eval-n10.json].
- 0:50–1:00: logo and the "who is pressuring you" line.

## Recording checklist

- Fixture mode for every replayed beat; label each replay on screen.
- One capped live clip maximum, on a dev meeting the demo has not shown, with the cost overlay from the log.
- Backups of the recording on 2 devices before editing.
- Before export: every on-screen number traced to a file in brackets; any number without a source cut.
