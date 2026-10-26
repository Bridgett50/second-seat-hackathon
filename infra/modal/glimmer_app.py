"""Second-seat Glimmer vLLM host on Modal.

Deploy with `python3 -m modal deploy infra/modal/glimmer_app.py`, stop with
`python3 -m modal app stop second-seat-glimmer`. Scale-to-zero.

Live eval with `python3 -m modal run infra/modal/glimmer_app.py` (ephemeral
app, stops when done; build services/bot first).
"""

import datetime
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

import modal

app = modal.App("second-seat-glimmer")

image = (
    modal.Image.from_registry("vllm/vllm-openai:muse-glimmer")
    .dockerfile_commands(["RUN ln -sf \"$(command -v python3)\" /usr/local/bin/python"])
    .entrypoint([])
)

volume = modal.Volume.from_name("glimmer-weights", create_if_missing=True)

_here = Path(__file__).resolve()
_repo = _here.parents[2] if len(_here.parents) > 2 else Path("/")  # driver: container path is shallow

eval_image = (
    modal.Image.debian_slim()
    .apt_install("nodejs", "curl")
    .add_local_dir(str(_repo / "services/bot/dist"), "/app/services/bot/dist")
    .add_local_dir(str(_repo / "services/bot/scripts"), "/app/services/bot/scripts")
    .add_local_dir(
        str(_repo / "services/bot/fixtures/pii"), "/app/services/bot/fixtures/pii"
    )
    .add_local_file(
        str(_repo / "services/bot/package.json"), "/app/services/bot/package.json"
    )
)


@app.function(
    image=image,
    gpu="A100-80GB",
    volumes={"/root/.cache/huggingface": volume},
    timeout=3600,
    scaledown_window=300,
    max_containers=1,
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=8000, startup_timeout=1500)
def serve() -> None:
    cmd = [
        "vllm",
        "serve",
        "meta-models/Muse-Glimmer-30B",
        "--served-model-name",
        "meta-models/Muse-Glimmer-30B",
        "--tensor-parallel-size",
        "1",
        "--dtype",
        "bfloat16",
        "--max-model-len",
        "16384",
        "--gpu-memory-utilization",
        "0.92",
        "--reasoning-parser",
        "muse_glimmer",
        "--generation-config",
        "auto",
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
    ]
    proc = subprocess.Popen(cmd)
    proc.wait()


@app.function(image=eval_image, timeout=1800)
def eval_live() -> dict:
    url = serve.get_web_url()
    health_url = f"{url}/health"
    start = time.monotonic()
    deadline = start + 25 * 60
    health_status = None
    seconds_to_healthy = None
    while True:
        try:
            with urllib.request.urlopen(health_url, timeout=60) as resp:
                health_status = resp.status
                if resp.status == 200:
                    seconds_to_healthy = time.monotonic() - start
                    break
        except Exception:
            pass
        if time.monotonic() >= deadline:
            break
        time.sleep(5)
    env = {**os.environ, "GLIMMER_BASE_URL": url}
    proc = subprocess.run(
        ["node", "scripts/redaction-eval.mjs"],
        cwd="/app/services/bot",
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
    )
    return {
        "url_host": urllib.parse.urlparse(url).hostname,
        "health_status": health_status,
        "seconds_to_healthy": seconds_to_healthy,
        "eval_stdout": proc.stdout,
        "eval_returncode": proc.returncode,
    }


@app.local_entrypoint()
def main() -> None:
    result = eval_live.remote()
    result["ran_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out_path = (
        Path(__file__).resolve().parents[2]
        / "services/bot/fixtures/glimmer-live-eval.json"
    )
    out_path.write_text(json.dumps(result, indent=2))
    print(f"health_status: {result.get('health_status')}")
    print(result.get("eval_stdout", ""))
