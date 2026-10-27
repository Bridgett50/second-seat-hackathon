# Model configuration (names only, no keys)

Live model calls never live in `packages/core`. All clients sit behind the
`ModelClient` interface in `services/bot`, run in fixture mode by default,
and log tokens and cost with a $5/day spend cap plus a daily call-count cap
(refuse-and-stop; see `services/bot/src/brief/costGuard.ts` and
[docs/failure-modes.md]).

Live mode is chosen ONLY by `SECOND_SEAT_MODE=live` together with
`GLIMMER_BASE_URL` and `META_API_KEY`; `SECOND_SEAT_TEST_MODE=1` always
forces offline (`apps/web/src/liveConfig.ts`). The live adapter path was
tested only with fake transports — no live model execution performed.

## Pinned models

- `muse-spark-1.3` — brief, Shield classifier, and support judge
  (`BRIEF_MODEL` in `services/bot/src/brief/muse.ts`).
- `meta-models/Muse-Glimmer-30B` — redaction (`GLIMMER_MODEL` in
  `services/bot/src/private/redact.ts`); served as
  `--served-model-name meta-models/Muse-Glimmer-30B` from image
  `vllm/vllm-openai:muse-glimmer` (`infra/modal/glimmer_app.py`).
- `sam-3.1` — experimental, outside the text-only core flow, off by default
  (live calls require `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`).

## Optional models (later phases)

- `muse-voice-transcribe-1.0`
- `muse-wonder-1.0`
- `muse-image-1.0` — experimental, outside the text-only core flow, off by
  default (live calls require `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`).

## Local setup

`export MODEL_API_KEY="$META_API_KEY"` (never print either value).
