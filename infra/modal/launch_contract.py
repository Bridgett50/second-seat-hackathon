"""Launch/download/freeze contract for container eval runs (stdlib only).

No third-party imports: this module must never import modal. It is
imported both by tests and by infra/modal/glimmer_app.py.
"""

import datetime
import hashlib
import os
import re

_SOURCE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_MODEL_REV_RE = re.compile(r"^[0-9a-f]{40}$")
_IMAGE_DIGEST_RE = re.compile(r"@sha256:[0-9a-fA-F]{64}$")


def _check_dataset(dataset):
    if (
        not isinstance(dataset, str)
        or dataset == ""
        or "/" in dataset
        or "\\" in dataset
        or ".." in dataset
    ):
        raise ValueError(f"dataset selection missing or invalid: {dataset!r}")


def eval_command(dataset, out_dir, run_id, run_config_path=None):
    """Node eval invocation for a dataset.

    run_config_path is the frozen run config the eval must consume: when
    given (non-blank) it is threaded as `--run-config <path>` so the eval
    inherits the frozen token/retry/decoding settings instead of defaults.
    Omitted (None/blank) preserves the legacy bare command.
    """
    _check_dataset(dataset)
    cmd = [
        "node",
        "scripts/redaction-eval.mjs",
        "--cases",
        dataset,
        "--out-dir",
        out_dir,
        "--run-id",
        run_id,
    ]
    if run_config_path is not None and str(run_config_path) != "":
        cmd = cmd + ["--run-config", str(run_config_path)]
    return cmd


_VLLM_MODEL = "meta-models/Muse-Glimmer-30B"
_VLLM_DEFAULT_MAX_MODEL_LEN = 16384


def _run_config_model_name(run_config):
    if isinstance(run_config, dict):
        model = run_config.get("model")
        if isinstance(model, dict):
            name = model.get("name")
            if isinstance(name, str) and name != "":
                return name
        elif isinstance(model, str) and model != "":
            return model
    return _VLLM_MODEL


def _run_config_revision(run_config):
    if isinstance(run_config, dict):
        model = run_config.get("model")
        if isinstance(model, dict):
            revision = model.get("revision")
            if isinstance(revision, str) and revision != "":
                return revision
        flat = run_config.get("model_revision")
        if isinstance(flat, str) and flat != "":
            return flat
    return ""


def _run_config_max_model_len(run_config):
    if isinstance(run_config, dict):
        limits = run_config.get("tokenLimits")
        if isinstance(limits, dict):
            maximum = limits.get("maxTokens")
            if isinstance(maximum, bool):
                pass
            elif isinstance(maximum, int) and maximum > 0:
                return maximum
    return _VLLM_DEFAULT_MAX_MODEL_LEN


def vllm_argv(run_config, host="127.0.0.1", port=8000):
    """Pure vLLM serve argv derived from a parsed run config.

    --revision comes from the run config (nested model.revision, or the
    flat launch-contract model_revision); --max-model-len comes from the
    run config tokenLimits.maxTokens, defaulting to the historical 16384
    when the config carries no token limit. Every other flag is the fixed
    Glimmer serve shape.
    """
    model = _run_config_model_name(run_config)
    revision = _run_config_revision(run_config)
    max_len = _run_config_max_model_len(run_config)
    return [
        "vllm",
        "serve",
        model,
        "--revision",
        revision,
        "--served-model-name",
        model,
        "--tensor-parallel-size",
        "1",
        "--dtype",
        "bfloat16",
        "--max-model-len",
        str(max_len),
        "--gpu-memory-utilization",
        "0.92",
        "--reasoning-parser",
        "muse_glimmer",
        "--generation-config",
        "auto",
        "--host",
        str(host),
        "--port",
        str(port),
    ]


def package_dirs(repo, dataset):
    """Local -> remote dir pairs for the eval image."""
    _check_dataset(dataset)
    base = str(repo)
    return [
        [os.path.join(base, "services/bot/dist"), "/app/services/bot/dist"],
        [os.path.join(base, "services/bot/scripts"), "/app/services/bot/scripts"],
        [
            os.path.join(base, "services/bot/fixtures", dataset),
            "/app/services/bot/fixtures/" + dataset,
        ],
    ]


def dataset_sha256(path):
    """Hex sha256 over sorted relative posix paths and file bytes."""
    entries = []
    for root, _dirs, files in os.walk(path):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, path).replace(os.sep, "/")
            entries.append((rel, full))
    entries.sort(key=lambda item: item[0])
    h = hashlib.sha256()
    for rel, full in entries:
        with open(full, "rb") as fh:
            data = fh.read()
        h.update(rel.encode("utf-8") + b"\0" + data + b"\0")
    return h.hexdigest()


def packaged_source_sha256(repo, dataset):
    """Hex sha256 over every packaged file for the eval image.

    Covers every file under the local dirs from package_dirs(repo, dataset)
    plus services/bot/package.json, keyed by sorted remote-relative posix
    paths with the same framing as dataset_sha256.
    """
    pairs = package_dirs(str(repo), dataset)
    pkg_local = os.path.join(str(repo), "services/bot/package.json")
    pkg_remote = "/app/services/bot/package.json"
    seen_locals = {p[0] for p in pairs}
    if pkg_local not in seen_locals:
        pairs = list(pairs) + [[pkg_local, pkg_remote]]
    entries = []
    for local, remote in pairs:
        if os.path.isdir(local):
            for root, _dirs, files in os.walk(local):
                for name in files:
                    full = os.path.join(root, name)
                    rel_local = os.path.relpath(full, local).replace(os.sep, "/")
                    key = remote.replace(os.sep, "/").rstrip("/").lstrip("/") + "/" + rel_local
                    with open(full, "rb") as fh:
                        data = fh.read()
                    entries.append((key, data))
        elif os.path.isfile(local):
            key = str(remote).replace(os.sep, "/").lstrip("/")
            with open(local, "rb") as fh:
                data = fh.read()
            entries.append((key, data))
        else:
            raise FileNotFoundError(f"packaged source missing: {local!r}")
    entries.sort(key=lambda item: item[0])
    h = hashlib.sha256()
    for key, data in entries:
        h.update(key.encode("utf-8") + b"\0" + data + b"\0")
    return h.hexdigest()


def _reviewer_ok(reviewer):
    return isinstance(reviewer, str) and reviewer.strip() != ""


def _reviewed_at_ok(value):
    if not isinstance(value, str) or value.strip() == "":
        return False
    s = value.strip()
    try:
        datetime.date.fromisoformat(s)
        return True
    except Exception:
        pass
    try:
        iso = s[:-1] + "+00:00" if s.endswith("Z") else s
        datetime.datetime.fromisoformat(iso)
        return True
    except Exception:
        return False


def _review_attestation_ok(review, dataset_sha):
    """Shared attestation contract for review bindings."""
    if not isinstance(review, dict):
        return False
    if review.get("status") != "reviewed":
        return False
    if not _reviewer_ok(review.get("reviewer")):
        return False
    if not _reviewed_at_ok(review.get("reviewed_at")):
        return False
    if review.get("dataset_sha256") != dataset_sha:
        return False
    return True


def _image_ok(image):
    if not isinstance(image, str):
        return False
    m = _IMAGE_DIGEST_RE.search(image)
    if not m:
        return False
    digest = image.rsplit("@sha256:", 1)[1]
    if digest.lower() == "0" * 64:
        return False
    return True


def _model_revision_ok(rev):
    return (
        isinstance(rev, str)
        and bool(_MODEL_REV_RE.match(rev))
        and rev != "0" * 40
    )


def review_status_ok(review, dataset_sha256):
    """True only for a completed review attestation bound to the dataset hash."""
    return _review_attestation_ok(review, dataset_sha256)


def check_launch(config, fixtures_root, invoked_dataset=None, repo_root=None):
    """Return blocker strings; empty means launch is allowed."""
    blockers = []
    if not isinstance(config, dict):
        return ["dataset selection missing: config is not an object"]
    dataset = config.get("dataset")
    if not isinstance(dataset, str) or dataset == "":
        blockers.append("dataset selection missing: frozen config has no dataset")
    else:
        if invoked_dataset is not None and invoked_dataset != dataset:
            blockers.append(
                f"dataset mismatch: invoked {invoked_dataset!r} != frozen {dataset!r}"
            )
        expected = config.get("dataset_sha256")
        ds_path = os.path.join(fixtures_root, dataset)
        try:
            if not os.path.isdir(ds_path):
                blockers.append(
                    f"dataset hash mismatch: dataset dir missing for {dataset!r}"
                )
            else:
                actual = dataset_sha256(ds_path)
                if not isinstance(expected, str) or actual != expected:
                    blockers.append(
                        "dataset hash mismatch: fixtures dir does not match frozen sha"
                    )
        except Exception as exc:
            blockers.append(f"dataset hash mismatch: cannot hash dataset ({exc})")
    review = config.get("review")
    if not review_status_ok(review, config.get("dataset_sha256")):
        blockers.append("review incomplete: need reviewed attestation for dataset sha")
    source_sha = config.get("source_sha")
    if (
        not isinstance(source_sha, str)
        or not _SOURCE_SHA_RE.match(source_sha)
        or source_sha == "0" * 40
    ):
        blockers.append(f"source_sha invalid or placeholder: {source_sha!r}")
    image = config.get("image")
    if not _image_ok(image):
        blockers.append(f"image tag mutable: must pin @sha256 digest, got {image!r}")
    model_revision = config.get("model_revision")
    if not _model_revision_ok(model_revision):
        blockers.append(
            f"model_revision unpinned: must be 40 hex, got {model_revision!r}"
        )
    if repo_root is not None and isinstance(dataset, str) and dataset != "":
        try:
            actual_src = packaged_source_sha256(str(repo_root), dataset)
        except Exception as exc:
            blockers.append(f"source identity mismatch: cannot hash packaged source ({exc})")
        else:
            if not isinstance(config.get("source_sha256"), str) or config.get("source_sha256") != actual_src:
                blockers.append("source identity mismatch: frozen source_sha256 does not match packaged source")
    return blockers


def _reject_unsafe_rel(rel):
    if not isinstance(rel, str) or rel == "":
        raise ValueError(f"unsafe rel path: {rel!r}")
    if os.path.isabs(rel) or rel.startswith("/") or rel.startswith("\\"):
        raise ValueError(f"unsafe rel path (absolute): {rel!r}")
    if len(rel) >= 2 and rel[1] == ":":
        raise ValueError(f"unsafe rel path (absolute): {rel!r}")
    parts = rel.replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError(f"unsafe rel path (..): {rel!r}")
    norm = os.path.normpath(rel)
    if norm.startswith("..") or os.path.isabs(norm):
        raise ValueError(f"unsafe rel path: {rel!r}")


def download_run(list_files, read_file, run_id, out_dir):
    """Fetch every file under run_id into out_dir, byte-for-byte."""
    if not isinstance(run_id, str) or run_id == "":
        raise ValueError(f"run_id required, got {run_id!r}")
    rels = list(list_files(run_id))
    if os.path.exists(out_dir):
        if not os.path.isdir(out_dir):
            raise ValueError(f"out_dir is not a directory: {out_dir!r}")
        if os.listdir(out_dir):
            raise ValueError(
                f"refusing to download into existing non-empty out_dir: {out_dir!r}"
            )
    os.makedirs(out_dir, exist_ok=True)
    abs_out = os.path.abspath(out_dir)
    done = []
    for rel in rels:
        _reject_unsafe_rel(rel)
        dest = os.path.abspath(os.path.join(abs_out, *rel.replace("\\", "/").split("/")))
        if dest != abs_out and not dest.startswith(abs_out + os.sep):
            raise ValueError(f"unsafe rel path (escapes out_dir): {rel!r}")
        parent = os.path.dirname(dest)
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)
        data = read_file(f"{run_id}/{rel}")
        if isinstance(data, str):
            data = data.encode("utf-8")
        elif isinstance(data, (bytearray, memoryview)):
            data = bytes(data)
        with open(dest, "wb") as fh:
            fh.write(data)
        done.append(rel)
    return done


def wait_ready(now, sleep, probe, func_start, work_budget_s=780, ready_cap_s=300, poll_s=5):
    """Poll probe() until ready or until the in-budget ready cap.

    Model load and the readiness wait run INSIDE the work deadline: the
    ready cap is min(func_start + ready_cap_s, deadline) and the remaining
    budget is measured against deadline = func_start + work_budget_s.
    """
    deadline = func_start + work_budget_s
    cap = func_start + ready_cap_s
    if deadline < cap:
        cap = deadline
    ready = False
    while now() < cap:
        try:
            status = probe()
        except Exception:
            status = None
        if status == 200:
            ready = True
            break
        sleep(poll_s)
    remaining = deadline - now()
    remaining_ms = int(remaining * 1000) - 30000
    remaining_s = remaining - 5
    if not ready or remaining_ms <= 0 or remaining_s <= 0:
        ready = False
    return {"ready": ready, "remaining_ms": remaining_ms, "remaining_s": remaining_s}
