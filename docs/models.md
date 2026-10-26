# Model configuration (names only, no keys)

Live model calls never live in `packages/core`. All clients sit behind the
`ModelClient` interface in `services/bot`, run in fixture mode by default,
and log tokens and cost with a hard cap of $5/day per provider.

## Pinned models

- `muse-spark-1.3` — coding agent for this repo (Contributor mode off).
  Baseten id: `meta-models/muse-spark-open-1026`.
- `sam-3.1` — later phase.
- Glimmer 30B — Phase 04a.

## Optional models (later phases)

- `muse-voice-transcribe-1.0`
- `muse-wonder-1.0`
- `muse-image-1.0`

## Local setup

`export MODEL_API_KEY="$META_API_KEY"` (never print either value).
