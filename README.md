Pre-existing: the Second Seat idea and an earlier prototype. Built this week (Oct 26–Nov 4): everything in this repo.

# Second Seat

Vendor calls are where people agree to things they never meant to agree to. Second Seat sits next to you after the call. You paste the meeting text. Glimmer, running on our own GPU, masks the personal details first. You check and approve that redacted text. Only then does Spark write a short brief where every line cites the part of the meeting it came from: what was offered, what was asked, what needs a decision, and where someone leaned on you. You edit a reply, approve that exact text, and copy it out yourself.

Second Seat never sends a reply or message to the vendor, never joins calls, and takes no action. You decide.

Before the approved text is sent, a redaction check has to pass. After the brief is written, a second check has to pass. If a recorded support verdict is available, that is checked too. A hard failure stops the step and the page says "Needs owner review" without quoting the provider. Noisy warnings are sent to you for review and do not block the brief. Offline and Demo Mode run the same checks on the local brief. You still approve the redacted text and the draft yourself.

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
- **Demo Mode.** A streamlined view for recording: a step bar (Paste, Redact, approve the redacted text, Analyze, approve the draft, Copy), larger action buttons, and the payload panel tucked away. Owner approval is unchanged. You still click Approve on the redacted text and Approve draft on the reply. Add `?demo=1` to the URL to start with it on.

Live mode (Glimmer on Modal, then Spark) is available only when the server is started with all three of these, and never when `SECOND_SEAT_TEST_MODE=1`:

```sh
SECOND_SEAT_MODE=live GLIMMER_BASE_URL=<your Modal Glimmer URL> META_API_KEY=<set in your shell, never printed> \
  pnpm --filter @second-seat/web serve
```

Then choose **Live** in the header, or open http://localhost:4173/session?mode=live. If Live isn't configured, the page says so and stays Offline. Run `scripts/warmup.sh` first so the Glimmer container is warm. Live end-to-end was verified on Oct 28, 2026 on `main` at `0365fdb`: 3/3 runs passed against the real endpoints. Glimmer on a Modal A100 redacted in about 12.5 s, and Spark `muse-spark-1.3` wrote the brief in 13–19 s. All names, phones and emails were masked, and GPU cost was about $0.22. The record is the owner's run summary `second-seat-live3-run-summary.md` (private, in the owner's Drive). Rehearsals passed at `8c00c32` and on the November 15 prompt fix (#116). The public link is demo mode with recorded examples. The Oct 28 live run was recorded and is labeled as a recorded run; organizers confirmed recorded runs are fine if labeled. Video URL, founder story, and user observations are still pending.

The image / SAM path is experimental. It is hidden from the UI and makes no calls unless `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`.

## Security

The Glimmer Modal endpoint has no auth (F1). It is deployed only during owner-run sessions and stopped right after (`modal app stop second-seat-glimmer -y`, 0 containers). The public link is demo-only.

## How We Use Meta's Models

**Glimmer: private redaction on open weights.** `meta-models/Muse-Glimmer-30B` runs as open weights, self-hosted with vLLM on Modal (one A100-80GB, scale-to-zero, `infra/modal/glimmer_app.py`). It is served from the `vllm/vllm-openai:muse-glimmer` image with `--reasoning-parser muse_glimmer`. Raw meeting text goes only here. Redaction runs at **temperature 0.0** with no top_p/top_k and low reasoning strength, and returns strict JSON spans (`{"spans":[],"boxes":[]}` when there is nothing to mask, plus "never guess"). That follows the cookbook structured-output recipe. We knowingly depart from the vLLM guide's advice against greedy decoding, because redaction has to be repeatable and auditable. Glimmer requests carry a 90 s timeout and a 2048 max-token default. A request that fails counts as a miss, never as a pass.

**Spark: the cited brief.** `muse-spark-1.3` (Standard mode) gets only the redacted text you approved. Settings: reasoning medium, seed 42, max tokens 16000, and a strict JSON schema in which every brief entry must cite transcript segment IDs. Deterministic checks reject any citation that doesn't resolve to a real segment. A 429 or 5xx is retried up to 4 times, then fails loudly, with no silent fallback to fixtures. A cost guard refuses calls past an estimated $5/day or 50 calls/day. That is an estimate, not a billing guarantee.

**Prompt cache keys.** Each call family sends one stable `prompt_cache_key`: `second-seat-brief`, `second-seat-shield` and `second-seat-support`. Every family's request then starts with the same prefix, so the cache can actually hit. The demo page shows the cache-hit ratio from stored `cachedTokens`. The recorded brief shows 0 of 2271 input tokens cached. We haven't measured a live cache hit yet.

**What we rejected and why**

- *Sending raw text to Spark.* Rejected. Personal details are masked on our own GPU first, and a human approves the redacted text before anything reaches Spark.
- *One shared cache key for every call.* Rejected. Different prompts under one key fragment the cache, so we use one key per call family.
- *Default sampling for redaction.* Rejected. Temperature 0 gives the same masks for the same input.
- *A model-based pressure classifier in the live session.* Rejected for now. The session uses deterministic patterns, and you must review every flagged item before Copy unlocks. Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it. It isn't credited in the demo.
- *Recursive JSON schemas.* Rejected. The API returns HTTP 400 on a `$ref` cycle, so the brief schema is flattened to a fixed depth.
- *Images and SAM in the core flow.* Rejected. The core flow is text-only, and images stay behind an explicit experimental flag.
- *Auto-sending replies.* Rejected. Copy is the only exit, and only after you approve the exact draft.

## Results so far

- Dev meetings (live Spark, recorded): 10/10 validator-clean, recall 13/16, about $0.0547 total (`eval/results/dev-briefs.md`).
- Glimmer redaction, historical Modal run (Oct 26): 6/8 requests completed, `complete: false`. It's shown with its limits, not as a headline (`services/bot/fixtures/glimmer-run/`).
- Live end-to-end (Oct 28, 2026, `main` `0365fdb`): 3/3 runs passed. Glimmer on Modal A100 redaction about 12.5 s, Spark `muse-spark-1.3` brief 13–19 s, all names/phones/emails masked, about $0.22 GPU (owner's private run summary).
- Seeded-error support judge: caught 9/9 with 0/4 false alarms on a small synthetic suite (`eval/results/support-score.json`).
- Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it (`node eval/resistance-table.mjs --split dev` and `node eval/shield-report.mjs --split dev`, #114/#115).

## Known Issues

- **Ordinary calendar dates are no longer instructed to be masked as `date_of_birth`.** Bridgett Sanders approved this prompt change on Oct 28, 2026. The Glimmer system prompt now says to mask a date as `date_of_birth` only when the text states it is a date of birth or birthday, and to leave ordinary meeting dates unmasked. A generic `DATE` label is not relabeled to `date_of_birth`. Real DOB aliases (`DOB`, `DATE_OF_BIRTH`, `BIRTHDATE`, `BIRTH_DATE`, `BIRTHDAY`) are still masked. The label schema and model pins are unchanged.
  - *Live runs before this change:* the Oct 28 runs masked "November 15" because the previous prompt said to mask every calendar date. Those recorded outputs are unchanged. The live endpoint uses the new prompt only after this re-freeze is deployed.
  - *Offline mode:* "November 15" as a meeting date stays in the text. A phrase such as "born on March 4, 1990" is still masked, as are names, phones, and emails.

## More

- Full PR ledger and engineering log: [docs/engineering-log.md](docs/engineering-log.md)
- Models and settings: [docs/models.md](docs/models.md)
- Failure modes: [docs/failure-modes.md](docs/failure-modes.md)
- Recording script: [RECORDING_SCRIPT.md](RECORDING_SCRIPT.md)
- Friday buyer tryouts: [docs/tryout-protocol.md](docs/tryout-protocol.md)

Built with Muse Code (Meta's coding agent) as the build agent. Grok Bot drove and verified.

License: MIT. See [LICENSE](LICENSE).
