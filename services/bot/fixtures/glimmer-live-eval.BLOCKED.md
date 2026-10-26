# Glimmer in-Modal eval — BLOCKED (2026-10-26)

- `modal run infra/modal/glimmer_app.py` started 14:04:52 CDT; vLLM reported "Application startup complete" at 14:09:43 CDT.
- `eval_live` (separate Modal function) polled `serve.get_web_url()/health` for ~6 min and vLLM logged no `/health` request at all, so the web endpoint never routed to the container — even from inside Modal. This rules out the box egress proxy as the only cause.
- Run was cancelled 14:15:36 CDT (local client heartbeat lost); app stopped, 0 containers confirmed.
- NO real numbers: recall / spans are not available. Nothing invented.
- Next idea: run `redaction-eval.mjs` inside the same container as vLLM against `http://127.0.0.1:8000` (no web endpoint), using `modal run --detach`.
