# Runbook: frozen holdout run (PREPARE ONLY — DO NOT RUN)

Status: PREPARED, NOT AUTHORIZED. The launch and cleanup steps below are
written but marked DO NOT RUN. Do not launch them without separate
authorization of this exact frozen config AND a separate budget approval.

Partner verification: pending. No partner has verified any holdout result
because no holdout run has happened.

A valid evaluation may produce a poor result. Acceptance depends on
trustworthy measurement, not a favorable percentage.

## Frozen config

| Item | Frozen value |
|---|---|
| Source SHA | `<fill at freeze>` (full `git rev-parse HEAD` of the checkout the run uses) |
| Cases | `services/bot/fixtures/holdout-v1` (10 cases), invoked ONLY via `node scripts/redaction-eval.mjs --cases holdout-v1` |
| Holdout manifest | `fixtures/holdout-v1/MANIFEST.json`, `inference_runs: 0`, `review.status: pending-manual-review`; verify with `node scripts/holdout-freeze.mjs` before anything else |
| Label policy | person, phone, email, credit_card, account_number, iban, address, date_of_birth; every calendar date is masked as date_of_birth (`ALLOWED_LABELS` in `src/private/redact.ts`) |
| Scorer | `services/bot/scripts/redaction-eval-lib.mjs`, sha256 `9e0bd446be61c48df5d968b49b8ac1befca54c8fc4a6dbba27b61220263580ae` |
| Runner | `services/bot/scripts/redaction-eval-runner.mjs` (`runEval`: canary-first, concurrency 2, unique run dir, `rescoreRun` for offline rescoring) |
| Prompt | Inline system prompt in `services/bot/src/private/redact.ts` (~line 620: "Return JSON only … Mask every calendar date as date_of_birth …"); sha256 of that file `9e21ebfae292ee55e2d776db0b0e9efe9e4f7158ae542fda4cae13fe5490e6eb`. There is NO separate redaction prompt file (`services/bot/prompts/` covers the brief flow, not redaction) |
| Response schema | Inline JSON schema (`spans[{start,end,label}]`, `boxes[]`) in the same file, sent only when `GLIMMER_JSON_SCHEMA=1`; frozen value for this run: `0` (unset) unless the freeze signs otherwise |
| Model revision | `meta-models/Muse-Glimmer-30B` (`GLIMMER_MODEL` in `src/private/redact.ts`); served as `--served-model-name meta-models/Muse-Glimmer-30B` |
| Container image | `vllm/vllm-openai:muse-glimmer` (see `infra/modal/glimmer_app.py`); image digest `<pending>` (fill at freeze from the deploy output) |
| vLLM flags | `--tensor-parallel-size 1 --dtype bfloat16 --max-model-len 16384 --gpu-memory-utilization 0.92 --reasoning-parser muse_glimmer --generation-config auto` |
| Decoding | `temperature 1.0, top_p 0.95, top_k 64, reasoning_strength low` (never greedy) |
| Token cap | `max_tokens 2048` (`GLIMMER_MAX_TOKENS` unset → `GLIMMER_MAX_TOKENS_DEFAULT`) |
| Work deadline | 780 s (`global_deadline = func_start + 780` in `eval_in_container`) |
| Function timeout | 840 s (`timeout=840` on the Modal `eval_in_container` function) |
| Ready wait | up to 300 s for vLLM `/health`, capped by the work deadline; 30 s + 5 s reserve held back (`remaining_ms - 30_000`, `remaining_s - 5`); per-request timeout `min(90000, remaining budget)` |
| Canary policy | Case 1 (`holdout-01.txt`) runs first and is scored; if it errors, the eval stops, exits 2, and every remaining case is recorded `not_run` |
| Retry policy | None (`retries=0`; no rerun cherry-picking — see publish rules) |
| Architecture | Existing `.spawn()` + Volume architecture (`eval_in_container.spawn()`, `glimmer-weights` + `glimmer-results` Volumes); scale-to-zero; one unique run dir `/results/<run_id>/` per run, never reused |

### Timeouts vs billed allocation time

The 780-second work deadline and the 840-second function timeout are NOT the
total billed allocation time. The work deadline covers only eval work after
function start. Total billed allocation additionally includes container
startup, model load, the ready wait (up to 300 s for vLLM `/health`), and
teardown — all of which burn GPU allocation outside (and before) the eval
budget. Budget approval must cover the whole allocation, not just 780 s.

## Launch steps (DO NOT RUN without separate authorization of this frozen config and a budget)

1. Verify the freeze: `node services/bot/scripts/holdout-freeze.mjs` (exit 0).
2. Record the source SHA in the table above (`<fill at freeze>`).
3. Build: `cd services/bot && pnpm build`.
4. Deploy: `python3 -m modal deploy infra/modal/glimmer_app.py`; record the image digest (`<pending>`).
5. Launch the bounded run: `python3 -m modal run --detach infra/modal/glimmer_app.py` (ephemeral app, stops when done).
6. Fetch results: `python3 -m modal run infra/modal/glimmer_app.py::fetch --run-id <run_id>`.
7. Offline rescore without inference: `node services/bot/scripts/rescore-glimmer-run.mjs` semantics via `rescoreRun(runDir)`; the rescore must reproduce `summary.json`/`report.txt` exactly for a complete run.

## Cleanup steps (DO NOT RUN without the same authorization)

1. `python3 -m modal app stop second-seat-glimmer`.
2. Confirm scale-to-zero (no resident containers) before closing the budget.
3. Publish per the rules below — including incomplete results — then close out.

## What gets published if the canary fails

Publish the incomplete run as-is: the one `error` record for `holdout-01.txt`
plus explicit `not_run` records for the other nine cases, with the full
planned denominator of 10 cases retained (`recall_end_to_end` over all
planned spans, `complete: false`, exit code 2). Do NOT rerun, do NOT
cherry-pick the remaining cases into a new run, and do NOT present
completed-case metrics as the batch result. The report must show
`completion: 0/10` (plus the canary error) alongside the failure reason.

## What gets published if the remaining batch fails

Publish the partial run as-is: each planned case keeps exactly one terminal
status (`ok` / `error` / `not_run`), completed-case metrics stay labelled
`recall_completed`, and end-to-end metrics keep the FULL planned denominator
of 10 cases (`recall_end_to_end`, `complete: false`). Offline
`rescoreRun(runDir)` output is published alongside the saved `summary.json` /
`report.txt`. Missing, duplicate, or unexpected case ids force
`complete: false` with the integrity reason named. No rerun cherry-picking:
failed or `not_run` cases are never silently replaced by a second attempt.

## Verification record

- CPU dry run (offline, fake redactor, no network): `node services/bot/scripts/holdout-dry-run.mjs` — success, failing-canary, and interrupted modes; covered by `services/bot/test/holdout-dry-run.test.ts`.
- Live holdout execution: NOT RUN (requires the separate authorizations above).
- Partner verification: pending.
