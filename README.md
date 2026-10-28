Pre-existing: the Second Seat idea and an earlier prototype. Built this week (Oct 26–Nov 4): everything in this repo.

# Second Seat

Vendor calls are where people agree to things they never meant to agree to. Second Seat sits next to you after the call. You paste the meeting text. Glimmer, running on our own GPU, masks the personal details first. You check and approve that redacted text. Only then does Spark write a short brief where every line cites the part of the meeting it came from: what was offered, what was asked, what needs a decision, and where someone leaned on you. You edit a reply, approve that exact text, and copy it out yourself.

Second Seat never sends a reply or message to the vendor, never joins calls, and takes no action. You decide.

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

Then choose **Live** in the header, or open http://localhost:4173/session?mode=live. If Live isn't configured, the page says so and stays Offline. Run `scripts/warmup.sh` first so the Glimmer container is warm. The live session path has been tested only with fake transports. It has not yet been run end-to-end against the real endpoints.

The image / SAM path is experimental. It is hidden from the UI and makes no calls unless `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`.

## How We Use Meta's Models

**Glimmer: private redaction on open weights.** `meta-models/Muse-Glimmer-30B` runs as open weights, self-hosted with vLLM on Modal (one A100-80GB, scale-to-zero, `infra/modal/glimmer_app.py`). It is served from the `vllm/vllm-openai:muse-glimmer` image with `--reasoning-parser muse_glimmer`. Raw meeting text goes only here. Redaction runs at **temperature 0.0** with no top_p/top_k and low reasoning strength, and returns strict JSON spans (`{"spans":[],"boxes":[]}` when there is nothing to mask, plus "never guess"). That follows the cookbook structured-output recipe. We knowingly depart from the vLLM guide's advice against greedy decoding, because redaction has to be repeatable and auditable. Glimmer requests carry a 90 s timeout and a 2048 max-token default. A request that fails counts as a miss, never as a pass.

**Spark: the cited brief.** `muse-spark-1.3` (Standard mode) gets only the redacted text you approved. Settings: reasoning medium, seed 42, max tokens 16000, and a strict JSON schema in which every brief entry must cite transcript segment IDs. Deterministic checks reject any citation that doesn't resolve to a real segment. A 429 or 5xx is retried up to 4 times, then fails loudly, with no silent fallback to fixtures. A cost guard refuses calls past an estimated $5/day or 50 calls/day. That is an estimate, not a billing guarantee.

**Prompt cache keys.** Each call family sends one stable `prompt_cache_key`: `second-seat-brief`, `second-seat-shield` and `second-seat-support`. Every family's request then starts with the same prefix, so the cache can actually hit. The demo page shows the cache-hit ratio from stored `cachedTokens`. The recorded brief shows 0 of 2271 input tokens cached. We haven't measured a live cache hit yet.

**What we rejected and why**

- *Sending raw text to Spark.* Rejected. Personal details are masked on our own GPU first, and a human approves the redacted text before anything reaches Spark.
- *One shared cache key for every call.* Rejected. Different prompts under one key fragment the cache, so we use one key per call family.
- *Default sampling for redaction.* Rejected. Temperature 0 gives the same masks for the same input.
- *A model-based pressure classifier in the live session.* Rejected for now. The session uses deterministic patterns, and you must review every flagged item before Copy unlocks. The Spark Shield classifier is a standalone path and isn't credited in the demo.
- *Recursive JSON schemas.* Rejected. The API returns HTTP 400 on a `$ref` cycle, so the brief schema is flattened to a fixed depth.
- *Images and SAM in the core flow.* Rejected. The core flow is text-only, and images stay behind an explicit experimental flag.
- *Auto-sending replies.* Rejected. Copy is the only exit, and only after you approve the exact draft.

## Results so far

- Dev meetings (live Spark, recorded): 10/10 validator-clean, recall 13/16, about $0.0547 total (`eval/results/dev-briefs.md`).
- Glimmer redaction, historical Modal run (Oct 26): 6/8 requests completed, `complete: false`. It's shown with its limits, not as a headline (`services/bot/fixtures/glimmer-run/`).
- Seeded-error support judge: caught 9/9 with 0/4 false alarms on a small synthetic suite (`eval/results/support-score.json`).

## More

- Full PR ledger and engineering log: [docs/engineering-log.md](docs/engineering-log.md)
- Models and settings: [docs/models.md](docs/models.md)
- Failure modes: [docs/failure-modes.md](docs/failure-modes.md)
- Recording script: [RECORDING_SCRIPT.md](RECORDING_SCRIPT.md)

Built with Muse Code (Meta's coding agent) as the build agent. Grok Bot drove and verified.

License: MIT. See [LICENSE](LICENSE).
