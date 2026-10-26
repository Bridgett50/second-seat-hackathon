"""Second-seat Glimmer vLLM host on Modal.

Deploy with `python3 -m modal deploy infra/modal/glimmer_app.py`, stop with
`python3 -m modal app stop second-seat-glimmer`. Scale-to-zero.

Live eval with `python3 -m modal run --detach infra/modal/glimmer_app.py`
(ephemeral app, stops when done; build services/bot first).
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

eval_in_container_image = (
    image.run_commands("apt-get update && apt-get install -y curl ca-certificates && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && node --version")  # driver: distro nodejs too old for fetch
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
    subprocess.Popen(cmd)


@app.function(
    image=eval_in_container_image,
    gpu="A100-80GB",
    volumes={"/root/.cache/huggingface": volume},
    timeout=1500,
    max_containers=1,
)
def eval_in_container() -> dict:
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
        "127.0.0.1",
        "--port",
        "8000",
    ]
    vllm = subprocess.Popen(cmd)
    health_url = "http://127.0.0.1:8000/health"
    base_url = "http://127.0.0.1:8000"
    start = time.monotonic()
    deadline = start + 20 * 60
    health_status = None
    seconds_to_healthy = None
    vllm_returncode = None
    try:
        while True:
            if vllm.poll() is not None:
                vllm_returncode = vllm.returncode
                break
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
        if vllm.poll() is not None:
            vllm_returncode = vllm.returncode
        env = {**os.environ, "GLIMMER_BASE_URL": base_url}
        proc = subprocess.run(
            ["node", "scripts/redaction-eval.mjs"],
            cwd="/app/services/bot",
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        result = {
            "health_status": health_status,
            "seconds_to_healthy": seconds_to_healthy,
            "vllm_returncode": vllm_returncode,
            "eval_stdout": proc.stdout,
            "eval_stderr": proc.stderr[-2000:],
            "eval_returncode": proc.returncode,
        }
    finally:
        if vllm.poll() is None:
            vllm.terminate()
    print("GLIMMER_RESULT_JSON " + json.dumps(result))
    return result


@app.local_entrypoint()
def main() -> None:
    result = eval_in_container.remote()
    result["ran_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out_path = (
        Path(__file__).resolve().parents[2]
        / "services/bot/fixtures/glimmer-live-eval.json"
    )
    out_path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
