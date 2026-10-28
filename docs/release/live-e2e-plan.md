# Live end-to-end run: prepared, NOT run

Status: prepared only. No live model, Modal or Baseten call was made for release/v1. It runs only with Bridgett's explicit go-ahead. **C9 paid execution and sealed holdout access remain BLOCKED.** This plan touches neither.

Data: only the made-up transcript in [RECORDING_SCRIPT.md](../../RECORDING_SCRIPT.md).

## Exact commands

```sh
# 0. Build (offline)
pnpm install && pnpm -r build

# 1. Deploy the Glimmer vLLM server on Modal (A100-80GB, scale-to-zero).
#    GLIMMER_LAUNCH_CONFIG must name a canonical nested run config
#    (runConfig.ts shape, configVersion 1) with model.revision set.
#    The deploy ships those exact bytes into the container (H3).
GLIMMER_LAUNCH_CONFIG=config/live/glimmer-launch-config.json python3 -m modal deploy infra/modal/glimmer_app.py

# 2. Point the app at the endpoint Modal prints for the `serve` function,
#    then warm both models (one tiny request each).
export GLIMMER_BASE_URL=<https://…--second-seat-glimmer-serve.modal.run>
scripts/warmup.sh

# 3. Run the session live and walk RECORDING_SCRIPT.md in the browser:
#    http://localhost:4173/session?mode=live&demo=1
SECOND_SEAT_MODE=live pnpm --filter @second-seat/web serve

# 4. Stop the GPU as soon as you're done (don't rely on the scaledown window).
python3 -m modal app stop second-seat-glimmer
```

`META_API_KEY` must already be set in the shell. Never print it.

## Expected cost (estimate, not a billing cap)

| Item | Basis | Estimate |
|---|---|---|
| Modal A100-80GB | $0.000694/s (modal.com/pricing, checked Oct 27, 2026), about $2.50/h. Billable time: cold start and model load, the session, plus the 300 s scaledown window. Roughly 15–25 min. | $0.62–$1.04 |
| Spark brief | Live dev briefs averaged about $0.018 each (`eval/results/dev-briefs.md`). One brief plus one warmup ping. | about $0.02 |
| **Total** | | **about $0.65–$1.10. Proposed ceiling $1.50.** |

Worst case: a stuck container can bill until the 1500 s startup timeout, or up to the 3600 s function timeout, about $2.50. Step 4 is what prevents that. The code's cost guard covers estimated Spark spend only, not Modal.

## What would make it fail

1. **Launch config (fixed by the H3 PR; still needs a real config file).** Before H3, the deployed `serve` container never got `GLIMMER_LAUNCH_CONFIG` or `launch_contract.py`, so vLLM would have started with `--revision ''`. H3 ships both into the image at `/root/` with `Image.add_local_file`, and `serve()` now refuses to start without a pinned revision. A drafted config with the verified revision and image digest is in `config/live/glimmer-launch-config.json` (H4 PR). It is PENDING Bridgett's confirmation: its review fields are blank, so `validateRunConfig` refuses it until she records the review (see `config/live/README.md`). `serve()` itself does not check the review, so validate before deploying.
2. **Cold start.** If the weights volume `glimmer-weights` is empty, the first start downloads the 30B weights and can exceed the 1500 s startup timeout. Each Glimmer request has a 90 s timeout, so redaction fails if warmup didn't finish.
3. **Glimmer output.** The historical run completed 6/8. The two failures were invalid JSON and a length finish with empty output. Either one fails redaction.
4. **Residual PII.** If Glimmer misses the phone or email, the privacy gate refuses Analyze ("residual PII detected"). The owner must fix the preview first.
5. **Spark.** A 429 or 5xx after 4 retries fails analysis, with no fixture fallback. The cost guard refuses past an estimated $5/day or 50 calls/day.
6. **Config.** Live is never used when `SECOND_SEAT_TEST_MODE=1` is set, when `SECOND_SEAT_MODE` isn't `live`, or when `GLIMMER_BASE_URL` or `META_API_KEY` is missing. The page then says Live is not configured and stays Offline.
7. **Auth.** The box needs a Modal token, and the key must be valid for `muse-spark-1.3`. The Glimmer client sends no auth header. If Modal proxy auth is enabled on the endpoint, Glimmer calls get 401. If it isn't, the endpoint is publicly reachable while it's up. That is a security note, not a fix made here.
8. **Untested path.** The live session path has been tested only with fake transports. This would be its first real end-to-end run.
