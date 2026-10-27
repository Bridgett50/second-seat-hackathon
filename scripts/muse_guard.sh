#!/usr/bin/env bash
# muse_guard.sh <pre|stop> — Muse Code hook enforcement.
# Bash + python3 stdlib only. Never prints env.
set -u

MODE="${1:-}"

# --- sealed-path matcher, shared logic with scripts/verify_pr.sh ---
# Builds a case-insensitive regex from .sealed-paths entries (escaped) plus
# heldout-sealed, holdout-v1, eval/heldout, \.sealed, (^|/)\.env.
sealed_regex() {
  # $1 = repo root; prints the regex on stdout
  python3 - "$1" <<'EOF'
import os, re, sys
root = sys.argv[1]
patterns = ["heldout-sealed", "holdout-v1", "eval/heldout", r"\.sealed", r"(^|[/\"'\s=:])\.env(?!\.example)"]
p = os.path.join(root, ".sealed-paths")
if os.path.exists(p):
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(re.escape(line))
print("|".join("(%s)" % s for s in patterns))
EOF
}

deny_pre() {
  # $1 = reason; prints PreToolUse deny JSON, exits 0
  python3 - "$1" <<'EOF'
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "deny", "permissionDecisionReason": sys.argv[1]}}))
EOF
  exit 0
}

guard_pre() {
  input="$(cat)"
  cwd="$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cwd","") or "")')"
  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then cwd="$PWD"; fi
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "$cwd")"
  regex="$(sealed_regex "$root")"

  # 1) sealed check: whole serialized tool_input, case-insensitive,
  #    also with backslashes turned into /.
  sealed_hit="$(printf '%s' "$input" | SEALED_REGEX="$regex" python3 -c '
import json, os, re, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    data = {}
blob = json.dumps(data.get("tool_input", data))
blob2 = blob.replace(chr(92), "/")
rx = re.compile(os.environ["SEALED_REGEX"], re.IGNORECASE)
print("yes" if rx.search(blob) or rx.search(blob2) else "no")
')"
  if [ "$sealed_hit" = "yes" ]; then
    deny_pre "sealed path: tool input references a sealed or heldout path"
  fi

  # 2) scope check for edit tools only.
  is_edit="$(printf '%s' "$input" | python3 -c '
import json, re, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    data = {}
name = data.get("tool_name", "") or ""
print("yes" if re.search(r"write|edit|patch|apply|create|delete|move|rename", name, re.IGNORECASE) else "no")
')"
  if [ "$is_edit" != "yes" ]; then exit 0; fi

  scope_file="$root/.muse/scope.txt"
  if [ ! -f "$scope_file" ]; then
    deny_pre "out of scope: .muse/scope.txt is missing, all edits denied"
  fi

  verdict="$(ROOT="$root" SCOPE_FILE="$scope_file" HOOK_INPUT="$input" python3 <<'EOF'
import json, os, re, sys, fnmatch

raw = os.environ["HOOK_INPUT"]
try:
    data = json.loads(raw)
except Exception:
    data = {}
tool_input = data.get("tool_input", {})
root = os.environ["ROOT"]

KEYS = {"path", "file_path", "filepath", "target", "old_path", "new_path"}
found = []

def walk(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and k.lower() in KEYS and isinstance(v, str) and v:
                found.append(v)
            else:
                walk(v)
    elif isinstance(node, list):
        for v in node:
            walk(v)
    elif isinstance(node, str):
        for m in re.finditer(r"\*\*\* (?:Add|Update|Delete) File: (\S+)", node):
            found.append(m.group(1))

walk(tool_input)
# also scan any stray strings for apply_patch bodies missed above
def walk_str(node):
    if isinstance(node, dict):
        for v in node.values():
            walk_str(v)
    elif isinstance(node, list):
        for v in node:
            walk_str(v)
walk_str(tool_input)

# load scope globs (# comments, blanks skipped)
pats = []
with open(os.environ["SCOPE_FILE"]) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        pats.append(line)

def bash_glob_match(pat, path):
    # translate bash glob (no globstar): * and ? do not cross /
    i, n, out = 0, len(pat), ""
    while i < n:
        c = pat[i]
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        elif c == "[":
            j = i + 1
            if j < n and pat[j] in "!^":
                j += 1
            if j < n and pat[j] == "]":
                j += 1
            while j < n and pat[j] != "]":
                j += 1
            if j < n:
                inner = pat[i+1:j]
                if inner[:1] in ("!", "^"):
                    inner = "^" + inner[1:]
                out += "[" + inner + "]"
                i = j
            else:
                out += re.escape(c)
        else:
            out += re.escape(c)
        i += 1
    return re.match(out + r"\Z", path) is not None

problems = []
for p in found:
    norm = p.replace("\\", "/")
    if os.path.isabs(norm):
        abs_p = os.path.normpath(norm)
    else:
        abs_p = os.path.normpath(os.path.join(root, norm))
    if abs_p != root and not abs_p.startswith(root + "/"):
        problems.append("outside repo: %s" % p)
        continue
    rel = os.path.relpath(abs_p, root)
    if not any(bash_glob_match(g, rel) for g in pats):
        problems.append("out of scope: %s" % rel)

print("\n".join(problems))
EOF
)"
  if [ -n "$verdict" ]; then
    first="$(printf '%s' "$verdict" | head -n 1)"
    deny_pre "$first"
  fi
  exit 0
}

guard_stop() {
  input="$(cat)"
  cwd="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("cwd","") or "")
except Exception: print("")')"
  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then cwd="$PWD"; fi
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "$cwd")"
  if [ ! -f "$root/.muse/criteria.json" ]; then exit 0; fi

  session="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id","") or "unknown")
except Exception: print("unknown")')"
  tmpdir="${TMPDIR:-/tmp}"
  counter="$tmpdir/muse-stop-$session"
  n=0
  if [ -f "$counter" ]; then n="$(cat "$counter" 2>/dev/null || echo 0)"; fi
  case "$n" in ''|*[!0-9]*) n=0;; esac
  if [ "$n" -ge 2 ]; then exit 0; fi

  out="$(cd "$root" && bash scripts/verify_pr.sh 2>/dev/null)"
  st=$?
  if [ "$st" -eq 0 ]; then exit 0; fi
  printf '%s' "$((n + 1))" > "$counter"
  printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    probs = json.loads(raw).get("problems", [])
except Exception:
    probs = [{"code": "verify_failed", "detail": raw[-2000:]}]
print(json.dumps({"decision": "block", "reason": json.dumps(probs)}))'
  exit 0
}

case "$MODE" in
  pre) guard_pre;;
  stop) guard_stop;;
  *) echo "usage: muse_guard.sh <pre|stop>" >&2; exit 2;;
esac
