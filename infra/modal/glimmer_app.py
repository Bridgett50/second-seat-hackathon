"""Second-seat Glimmer vLLM host on Modal.

Deploy with `python3 -m modal deploy infra/modal/glimmer_app.py`, stop with
`python3 -m modal app stop second-seat-glimmer`. Scale-to-zero.

Live eval with `GLIMMER_EVAL_DATASET=<dataset> python3 -m modal run
--detach infra/modal/glimmer_app.py --dataset <dataset> --config <config>`
(ephemeral app, stops when done; build services/bot first).
"""

import datetime
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import launch_contract

import modal

app = modal.App("second-seat-glimmer")

image = (
    modal.Image.from_registry("vllm/vllm-openai:muse-glimmer")
    .dockerfile_commands(["RUN ln -sf \"$(command -v python3)\" /usr/local/bin/python"])
    .entrypoint([])
)

volume = modal.Volume.from_name("glimmer-weights", create_if_missing=True)
results = modal.Volume.from_name("glimmer-results", create_if_missing=True)

_here = Path(__file__).resolve()
_repo = _here.parents[2] if len(_here.parents) > 2 else Path("/")  # driver: container path is shallow

# Dataset baked into the eval image, read at import. When unset the eval
# image carries no eval fixtures; when set it is built via package_dirs.
_EVAL_DATASET = os.environ.get("GLIMMER_EVAL_DATASET", "")

_node_base = image.run_commands("apt-get update && apt-get install -y curl ca-certificates && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && node --version")  # driver: distro nodejs too old for fetch

if _EVAL_DATASET:
    eval_in_container_image = _node_base
    for _local, _remote in launch_contract.package_dirs(str(_repo), _EVAL_DATASET):
        eval_in_container_image = eval_in_container_image.add_local_dir(_local, _remote)
    eval_in_container_image = eval_in_container_image.add_local_file(
        str(_repo / "services/bot/package.json"), "/app/services/bot/package.json"
    )
else:
    eval_in_container_image = (
        _node_base
        .add_local_dir(str(_repo / "services/bot/dist"), "/app/services/bot/dist")
        .add_local_dir(str(_repo / "services/bot/scripts"), "/app/services/bot/scripts")
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


# NOTE: single_use_containers=True is intentionally omitted: it is unclear
# whether this Modal version accepts that kwarg, and an unknown kwarg would
# fail app definition at import time.
@app.function(
    image=eval_in_container_image,
    gpu="A100-80GB",
    volumes={"/root/.cache/huggingface": volume, "/results": results},
    timeout=840,
    max_containers=1,
    retries=0,
)
def eval_in_container(dataset: str) -> dict:
    func_start = time.monotonic()
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
    # Own process group so the whole vLLM tree can be signalled on teardown.
    vllm = subprocess.Popen(cmd, start_new_session=True)
    health_url = "http://127.0.0.1:8000/health"
    base_url = "http://127.0.0.1:8000"
    health_status = None
    seconds_to_healthy = None
    eval_returncode = None
    eval_stdout = ""
    eval_stderr = ""
    run_id = None
    try:
        def _probe():
            try:
                with urllib.request.urlopen(health_url, timeout=10) as resp:
                    return resp.status
            except Exception:
                return None

        # Model load and the readiness wait run INSIDE the 780 s work
        # deadline: they consume it.
        timing = launch_contract.wait_ready(time.monotonic, time.sleep, _probe, func_start)
        if timing["ready"]:
            seconds_to_healthy = time.monotonic() - func_start
            health_status = 200
        if not timing["ready"]:
            eval_stderr = "vllm not healthy within 300s; skipping eval"
        else:
            remaining_ms = timing["remaining_ms"]
            remaining_s = timing["remaining_s"]
            if remaining_ms <= 0 or remaining_s <= 0:
                eval_stderr = "no time remaining for eval"
            else:
                # One unique run dir per run: /results/<run_id>/ holds
                # manifest.json, records.jsonl, summary.json, report.txt, and
                # the raw-response log.
                run_id = (
                    "run-"
                    + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
                    + f"-{os.getpid()}"
                )
                node_cmd = launch_contract.eval_command(dataset, "/results", run_id)
                env = {
                    **os.environ,
                    "GLIMMER_BASE_URL": base_url,
                    "GLIMMER_DEADLINE_MS": str(remaining_ms),
                }
                try:
                    proc = subprocess.run(
                        node_cmd,
                        cwd="/app/services/bot",
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=remaining_s,
                    )
                    eval_returncode = proc.returncode
                    eval_stdout = proc.stdout
                    eval_stderr = proc.stderr[-2000:]
                except subprocess.TimeoutExpired as exc:
                    eval_stderr = f"eval timed out: {exc}"
    finally:
        result = {
            "health": health_status,
            "seconds_to_healthy": seconds_to_healthy,
            "eval_returncode": eval_returncode,
            "eval_stdout": eval_stdout,
            "eval_stderr": eval_stderr,
            "ran_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": run_id if health_status == 200 else None,
        }
        live_eval_path = (
            Path(f"/results/{result['run_id']}/glimmer-live-eval.json")
            if result["run_id"]
            else Path("/results/glimmer-live-eval.json")
        )
        live_eval_path.parent.mkdir(parents=True, exist_ok=True)
        live_eval_path.write_text(json.dumps(result, indent=2))
        try:
            if vllm.poll() is None:
                os.killpg(vllm.pid, signal.SIGTERM)
                try:
                    vllm.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(vllm.pid, signal.SIGKILL)
        finally:
            results.commit()
    print("GLIMMER_RESULT_JSON " + json.dumps(result))
    return result


@app.local_entrypoint()
def main(dataset: str = "", config: str = "") -> None:
    env_dataset = os.environ.get("GLIMMER_EVAL_DATASET", "")
    cfg = {}
    if config:
        with open(config, "r", encoding="utf-8") as fh:
            cfg = json.load(fh)
    fixtures_root = str(_repo / "services" / "bot" / "fixtures")
    blockers = launch_contract.check_launch(cfg, fixtures_root, invoked_dataset=dataset)
    if dataset != env_dataset:
        blockers = [
            f"dataset mismatch: invoked {dataset!r} != GLIMMER_EVAL_DATASET {env_dataset!r}"
        ] + blockers
    if blockers:
        for b in blockers:
            print(f"BLOCKED: {b}")
        raise SystemExit(2)
    call = eval_in_container.spawn(dataset)
    print("CALL_ID " + call.object_id)
    return None


@app.local_entrypoint()
def fetch(run_id: str = "") -> None:
    if not run_id:
        print("run_id is required", file=sys.stderr)
        raise SystemExit(2)
    out_dir = (
        Path(__file__).resolve().parents[2] / "services/bot/fixtures/glimmer-run" / run_id
    )

    def list_files(rid):
        return list(results.listdir(rid, recursive=True))

    def read_file(remote):
        return b"".join(results.read_file(remote))

    launch_contract.download_run(list_files, read_file, run_id, str(out_dir))
    print(f"downloaded {run_id} -> {out_dir}")
