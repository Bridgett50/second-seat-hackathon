"""Second-seat Glimmer vLLM host on Modal.

Deploy with `python3 -m modal deploy infra/modal/glimmer_app.py`, stop with
`python3 -m modal app stop second-seat-glimmer`. Scale-to-zero.
"""

import subprocess

import modal

app = modal.App("second-seat-glimmer")

image = (
    modal.Image.from_registry("vllm/vllm-openai:muse-glimmer")
    .dockerfile_commands(["RUN ln -sf \"$(command -v python3)\" /usr/local/bin/python"])
    .entrypoint([])
)

volume = modal.Volume.from_name("glimmer-weights", create_if_missing=True)


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
