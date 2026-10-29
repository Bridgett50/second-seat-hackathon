Pre-existing: the Second Seat idea and an earlier prototype. Built this week (Oct 26–Nov 4): everything in this repo.

# Second Seat

Vendor calls are where people agree to things they never meant to agree to. Second Seat sits next to you after the call. You paste the meeting text. Glimmer, running on our own GPU, masks the personal details first. You check and approve that redacted text. Only then does Spark write a short brief where every line cites the part of the meeting it came from: what was offered, what was asked, what needs a decision, and where someone leaned on you. You edit a reply, approve that exact text, and copy it out yourself.

Second Seat never sends a reply or message to the vendor, never joins calls, and takes no action. You decide.

Before the approved text is sent, a redaction check has to pass. After the brief is written, a second check has to pass. If a recorded support verdict is available, that is checked too. A hard failure stops the step and the page says "Needs owner review" without quoting the provider. Noisy warnings are sent to you for review and do not block the brief. Offline and Demo Mode run the same checks on the local brief. You still approve the redacted text and the draft yourself.

## Why this matters to me

I didn't build Second Seat because I wanted to play with AI. I built it because I was losing money on the phone.

As a small business owner, my livelihood depends on vendor calls. Just last month, on September 7, I was negotiating the purchase of point-of-sale hardware for my store. We had a phone call. We agreed on a price of $700 a month. But when the written quote arrived, it said $750.

I caught the difference, emailed the vendor, and he corrected it. But it made me realize: what happens on the weeks when I don't catch it? What happens to the business owner who is exhausted, juggling ten other things, and just trusts the written quote or an AI summary to be accurate? They lose money. They miss the hidden price increase, the conditional deadline, or the liability shift.

In the meeting assistants I tried, I hit two problems. They summarized the whole call and missed the specific financial details I actually needed to act on. And to get those summaries, I had to send private client data, vendor names, and proprietary numbers to someone else's cloud. As a business owner, that was a privacy risk I couldn't take.

So I built Second Seat for myself first. The idea predates this hackathon; this week's build is the live engine. It takes the messy transcript, uses Meta's open-weights model (Glimmer) on GPU hardware I control to mask the supported sensitive-data categories, and asks for my explicit approval. I still review every mask. This is not a guarantee that every sensitive detail is gone. Only then does it use Meta's Spark model to hand me a bulleted brief of what was offered, what was asked, and what needs a decision—with every single claim cited back to the transcript.

Second Seat exists to prove a core philosophy: The future of superintelligence isn't replacing human judgment. It's putting a human in the final seat.

## How to run

Requires Node 20+ and pnpm (via corepack).

```sh
pnpm install
pnpm -r build
pnpm -r test
```

Offline demo (default; no network, no model calls):

```sh
SECOND_SEAT_TEST_MODE=1 pnpm --filter @second-seat/web serve
```

Open http://localhost:4173/session. The header has:

- **Mode: Offline | Live (Glimmer + Spark).** Offline is the default for every session. Offline redaction and briefs come from deterministic local code, not from Glimmer or Spark, and the page says "Offline demo".
- **Demo Mode.** A streamlined view for recording: a step bar (Paste, Redact, approve the redacted text, Analyze, approve the draft, Copy), larger action buttons, and the payload panel tucked away. Demo Mode is presentation only; owner approval is unchanged. You still click Approve on the redacted text and Approve draft on the reply. Add `?demo=1` to the URL to start with it on.

Live mode (Glimmer on Modal, then Spark) is available only when the server is started with all three of these, and never when `SECOND_SEAT_TEST_MODE=1`:

```sh
SECOND_SEAT_MODE=live GLIMMER_BASE_URL=<your Modal Glimmer URL> META_API_KEY=<set in your shell, never printed> \
  pnpm --filter @second-seat/web serve
```

Then choose **Live** in the header, or open http://localhost:4173/session?mode=live. If Live isn't configured, the page says so and stays Offline. Run `scripts/warmup.sh` first so the Glimmer container is warm. Live end-to-end was verified on Oct 28, 2026 on `main` at `0365fdb`: 3/3 runs passed against the real endpoints. Glimmer on a Modal A100 redacted in about 12.5 s, and Spark `muse-spark-1.3` wrote the brief in 13–19 s. All names, phones and emails were masked, and GPU cost was about $0.22. The Oct 28 live run has an owner-attested run summary (`second-seat-live3-run-summary.md`, private). That is a recorded output, not a screen-recorded video. Rehearsals at `8c00c32` and on the November 15 prompt fix (#116) are owner-attested live calls; this repository does not independently verify those private summaries. The public link is demo mode with recorded examples. Video URL and user observations are still pending.

The image / SAM path is experimental. It is hidden from the UI and makes no calls unless `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`.

## Security

The Glimmer Modal endpoint has no auth (F1). It is deployed only during owner-run sessions and stopped right after (`modal app stop second-seat-glimmer -y`, 0 containers). The public link is demo-only.

## How We Use Meta's Models

**Glimmer: private redaction on open weights.** `meta-models/Muse-Glimmer-30B` runs as open weights, self-hosted with vLLM on Modal (one A100-80GB, scale-to-zero, `infra/modal/glimmer_app.py`). It is served from the `vllm/vllm-openai:muse-glimmer` image with `--reasoning-parser muse_glimmer`. Raw meeting text goes only here. Redaction runs at **temperature 0.0** with no top_p/top_k and low reasoning strength, and returns strict JSON spans (`{"spans":[],"boxes":[]}` when there is nothing to mask, plus "never guess"). That follows the cookbook structured-output recipe. We knowingly depart from the vLLM guide's advice against greedy decoding, because redaction has to be repeatable and auditable. Glimmer requests on the web session default to 240 seconds (`LIVE_REDACT_TIMEOUT_MS` in `apps/web/src/liveConfig.ts`). The client and batch default is 90 seconds. A positive `GLIMMER_TIMEOUT_MS` overrides the web default. A request that fails counts as a miss, never as a pass.

**Spark: the cited brief.** `muse-spark-1.3` (Standard mode) gets only the redacted text you approved. Settings: reasoning medium, seed 42, max tokens 16000, and a strict JSON schema in which every brief entry must cite transcript segment IDs. Deterministic checks reject any citation that doesn't resolve to a real segment. A 429 or 5xx gets 4 attempts total (the first try plus at most 3 retries), then fails loudly, with no silent fallback to fixtures. The daily counter counts accounted completions, not every HTTP attempt. A cost guard refuses calls past an estimated $5/day or 50 accounted calls/day. That estimate is not a provider bill and not a Modal cap.

**Prompt cache keys.** Each call family sends one stable `prompt_cache_key`: `second-seat-brief`, `second-seat-shield` and `second-seat-support`. Every family's request then starts with the same prefix, so the cache can actually hit. The demo page shows the cache-hit ratio from stored `cachedTokens`. The recorded brief shows 0 of 2271 input tokens cached. We haven't measured a live cache hit yet.

**What we rejected and why**

- *Sending raw text to Spark.* Rejected. Personal details are masked on our own GPU first, and a human approves the redacted text before anything reaches Spark.
- *One shared cache key for every call.* Rejected. Different prompts under one key fragment the cache, so we use one key per call family.
- *Default sampling for redaction.* Rejected. Temperature 0 is set to reduce sampling variation and make masks easier to audit. It is not a proof that the same input always yields identical masks.
- *A model-based pressure classifier in the live session.* Rejected for now. The session uses deterministic patterns, and you must review every flagged item before Copy unlocks. Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it. It isn't credited in the demo.
- *Recursive JSON schemas.* Rejected. The API returns HTTP 400 on a `$ref` cycle, so the brief schema is flattened to a fixed depth.
- *Images and SAM in the core flow.* Rejected. The core flow is text-only, and images stay behind an explicit experimental flag.
- *Auto-sending replies.* Rejected. Copy is the only exit, and only after you approve the exact draft.

## Results so far

- Dev meetings (live Spark, recorded outputs): 10/10 brief entries across three development meetings, recall 13/16, about $0.0547 total (`eval/results/dev-briefs.md`).
- Glimmer redaction, historical Modal run (Oct 26): 6/8 requests completed, `complete: false`. It's shown with its limits, not as a headline (`services/bot/fixtures/glimmer-run/`).
- Live end-to-end (Oct 28, 2026, `main` `0365fdb`): 3/3 runs passed. Glimmer on Modal A100 redaction about 12.5 s, Spark `muse-spark-1.3` brief 13–19 s, all names/phones/emails masked, about $0.22 GPU (owner's private run summary).
- Seeded-error support judge: caught 9/9 with 0/4 false alarms on a small synthetic suite (`eval/results/support-score.json`).
- Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it (`node eval/resistance-table.mjs --split dev` and `node eval/shield-report.mjs --split dev`, #114/#115).

## Known Issues

- **Ordinary calendar dates are no longer instructed to be masked as `date_of_birth`.** Bridgett Sanders approved this prompt change on Oct 28, 2026. The Glimmer system prompt now says to mask a date as `date_of_birth` only when the text states it is a date of birth or birthday, and to leave ordinary meeting dates unmasked. A generic `DATE` label is not relabeled to `date_of_birth`. Real DOB aliases (`DOB`, `DATE_OF_BIRTH`, `BIRTHDATE`, `BIRTH_DATE`, `BIRTHDAY`) are still masked. The label schema and model pins are unchanged.
  - *Live runs before this change:* the Oct 28 runs masked "November 15" because the previous prompt said to mask every calendar date. Those recorded outputs are unchanged. The current client in `services/bot/src/private/redact.ts` already sends the new prompt on each redaction request. `infra/modal/glimmer_app.py` does not reference that prompt. Redeploying Modal does not activate it.
  - *Offline mode:* "November 15" as a meeting date stays in the text. A phrase such as "born on March 4, 1990" is still masked, as are names, phones, and emails.

## More

- Full PR ledger and engineering log: [docs/engineering-log.md](docs/engineering-log.md)
- Models and settings: [docs/models.md](docs/models.md)
- Failure modes: [docs/failure-modes.md](docs/failure-modes.md)
- Recording script: [RECORDING_SCRIPT.md](RECORDING_SCRIPT.md)
- Friday buyer tryouts: [docs/tryout-protocol.md](docs/tryout-protocol.md)

## Still for Bridgett

These are human tasks. They are not done by tests or by this repair:

- Record the founder clip and the demo on a machine whose citation and clipboard checks have actually passed.
- Keep user tryouts and the video URL pending until she supplies them.
- Review any X post herself before it is posted. Nothing here sends it.

Muse Code authored 127 commits on this history, the most of any one name, not every commit. Bridgett Sanders and Bridgett50 authored 142. The repair stack (FR1–FR10) was done by Cursor Agent (51 commits). Grok Bot authored 10. Grok and Codex reviewed. This history's token usage was not reported here. Bridgett Sanders directed the work and made hand edits. Cursor implemented the FR1–FR10 repairs; Grok and Codex reviewed the work. Those commit counts name the git author. They are not a line-by-line proof of which model wrote each line.

License: MIT. See [LICENSE](LICENSE).
