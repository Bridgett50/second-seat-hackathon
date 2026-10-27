#!/usr/bin/env bash
# verify_pr.sh [--base REF] [--full] — fail-then-pass PR verification.
# Bash + python3 stdlib only. Prints one JSON line; exit 0 iff passed.
# Reads .muse/criteria.json {base, prepare, tests:[{id, cmd, files}]}.
set -u

BASE_OVERRIDE=""
FULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_OVERRIDE="${2:-}"; shift 2;;
    --full) FULL=1; shift;;
    *) echo "usage: verify_pr.sh [--base REF] [--full]" >&2; exit 2;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/muse-verify-XXXXXX")"
PROBLEMS="$WORK/problems.jsonl"
TESTSTATUS="$WORK/status"
TESTLOGS="$WORK/logs"
mkdir -p "$TESTSTATUS" "$TESTLOGS"
: > "$PROBLEMS"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

add_problem() {
  python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1],"detail":sys.argv[2]}))' \
    "$1" "$2" >> "$PROBLEMS"
}

# --- sealed regex: same sources as muse_guard.sh (small duplicated block) ---
sealed_regex() {
  python3 - <<'EOF'
import os, re
patterns = ["heldout-sealed", "holdout-v1", "eval/heldout", r"\.sealed", r"(^|/)\.env"]
if os.path.exists(".sealed-paths"):
    with open(".sealed-paths") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(re.escape(line))
print("|".join("(%s)" % s for s in patterns))
EOF
}
SEALED_RX="$(sealed_regex)"

# --- criteria ---
BASE="$BASE_OVERRIDE"
PREPARE=""
if [ ! -f .muse/criteria.json ]; then
  add_problem "no_criteria" ".muse/criteria.json is missing"
else
  eval "$(python3 - <<'EOF'
import json
try:
    c = json.load(open(".muse/criteria.json"))
except Exception as e:
    print('CRIT_ERR=%s' % e)
else:
    import shlex
    print('CRIT_BASE=%s' % shlex.quote(str(c.get("base", ""))))
    print('CRIT_PREPARE=%s' % shlex.quote(str(c.get("prepare", "") or "")))
EOF
)"
  if [ -n "${CRIT_ERR:-}" ]; then add_problem "no_criteria" "bad criteria.json: $CRIT_ERR"; fi
  if [ -z "$BASE" ]; then BASE="${CRIT_BASE:-}"; fi
  PREPARE="${CRIT_PREPARE:-}"
fi
if [ -z "$BASE" ]; then BASE="HEAD"; fi
BASE_SHA="$(git rev-parse --verify "$BASE" 2>/dev/null || echo "")"
if [ -z "$BASE_SHA" ]; then
  add_problem "bad_base" "cannot resolve base ref: $BASE"
  BASE_SHA="HEAD"
fi

# --- changed paths: committed + working tree + untracked non-ignored ---
CHANGED="$WORK/changed.txt"
{
  git diff --name-only "$BASE_SHA" HEAD -- 2>/dev/null
  git diff --name-only "$BASE_SHA" -- 2>/dev/null
  git ls-files --others --exclude-standard 2>/dev/null
} | sed '/^[[:space:]]*$/d' | grep -v '^evidence/' | sort -u > "$CHANGED"

# --- scope globs + criteria test files ---
SCOPE_OK=1
if [ ! -f .muse/scope.txt ]; then SCOPE_OK=0; fi
TESTFILES="$WORK/testfiles.txt"
: > "$TESTFILES"
python3 - >> "$TESTFILES" 2>/dev/null <<'EOF'
import json
try:
    c = json.load(open(".muse/criteria.json"))
except Exception:
    pass
else:
    for t in c.get("tests", []) or []:
        for f in t.get("files", []) or []:
            print(f)
EOF

while IFS= read -r p; do
  [ -n "$p" ] || continue
  # a) scope check
  inscope="$(SCOPE_OK="$SCOPE_OK" P="$p" python3 - <<'EOF'
import os, re
p = os.environ["P"]
ok = False
if os.environ.get("SCOPE_OK") == "1" and os.path.exists(".muse/scope.txt"):
    pats = [l.strip() for l in open(".muse/scope.txt")]
    pats = [l for l in pats if l and not l.startswith("#")]
    def m(pat, path):
        i, n, out = 0, len(pat), ""
        while i < n:
            c = pat[i]
            if c == "*": out += "[^/]*"
            elif c == "?": out += "[^/]"
            elif c == "[":
                j = i + 1
                if j < n and pat[j] in "!^": j += 1
                if j < n and pat[j] == "]": j += 1
                while j < n and pat[j] != "]": j += 1
                if j < n:
                    inner = pat[i+1:j]
                    if inner[:1] in ("!", "^"): inner = "^" + inner[1:]
                    out += "[" + inner + "]"; i = j
                else: out += re.escape(c)
            else: out += re.escape(c)
            i += 1
        return re.match(out + r"\Z", path) is not None
    ok = any(m(g, p) for g in pats)
print("yes" if ok else "no")
EOF
)"
  # criteria test files count as in-scope (exact match)
  if [ "$inscope" != "yes" ] && grep -qxF "$p" "$TESTFILES" 2>/dev/null; then inscope="yes"; fi
  if [ "$inscope" != "yes" ]; then add_problem "out_of_scope" "$p"; fi
  # b) sealed check (case-insensitive, backslashes -> /)
  if printf '%s' "$p" | tr '\\' '/' | grep -qiE "$SEALED_RX"; then
    add_problem "sealed_path" "$p"
  fi
done < "$CHANGED"

# --- c) deleted / weakened tests ---
DELETED="$WORK/deleted.txt"
{
  git diff --name-only --diff-filter=D "$BASE_SHA" HEAD -- 2>/dev/null
  git diff --name-only --diff-filter=D "$BASE_SHA" -- 2>/dev/null
} | sed '/^[[:space:]]*$/d' | sort -u > "$DELETED"
is_testfile() {
  case "$1" in
    *.test.*|*.spec.*|test/*|*/test/*|e2e/*|*/e2e/*) return 0;;
    *) return 1;;
  esac
}
count_its() {
  # $1 = file path at HEAD (working tree); $2 = 1 for base version via git show
  if [ "$2" = "1" ]; then
    git show "$BASE_SHA:$1" 2>/dev/null | grep -cE '\b(it|test)(\.[A-Za-z0-9_]+)?\(' || true
  else
    grep -cE '\b(it|test)(\.[A-Za-z0-9_]+)?\(' "$1" 2>/dev/null || true
  fi
}
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if is_testfile "$p"; then add_problem "test_deleted" "$p"; fi
done < "$DELETED"
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if ! is_testfile "$p"; then continue; fi
  if grep -qxF "$p" "$DELETED" 2>/dev/null; then continue; fi
  if ! git cat-file -e "$BASE_SHA:$p" 2>/dev/null; then continue; fi  # new file
  if [ ! -f "$p" ]; then continue; fi
  before="$(count_its "$p" 1)"; after="$(count_its "$p" 0)"
  before="${before:-0}"; after="${after:-0}"
  if [ "$after" -lt "$before" ]; then
    add_problem "test_weakened" "$p: it/test count $before -> $after"
  fi
done < "$CHANGED"

# --- d) per-test fail-then-pass ---
WEAK_RX='Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load|No test files found|does not provide an export named|is not a function|SyntaxError'
NTESTS="$(python3 -c 'import json
try: print(len(json.load(open(".muse/criteria.json")).get("tests", []) or []))
except Exception: print(0)')"

i=0
while [ "$i" -lt "$NTESTS" ]; do
  eval "$(python3 - "$i" <<'EOF'
import json, shlex, sys
t = json.load(open(".muse/criteria.json"))["tests"][int(sys.argv[1])]
print("TID=%s" % shlex.quote(str(t.get("id", "t"))))
print("TCMD=%s" % shlex.quote(str(t.get("cmd", ""))))
import os
files = t.get("files", []) or []
print("TFILES_N=%d" % len(files))
for n, f in enumerate(files):
    print("TFILE_%d=%s" % (n, shlex.quote(str(f))))
EOF
)"
  sid="$(printf '%s' "$TID" | tr -c 'A-Za-z0-9_.-' '_')"
  # head run
  set +e
  (sh -c "$TCMD" >"$TESTLOGS/$sid.head.log" 2>&1)
  head_st=$?
  set -e
  if [ "$head_st" -eq 0 ]; then head_res="pass"; else
    head_res="fail"
    tail20="$(tail -n 20 "$TESTLOGS/$sid.head.log")"
    add_problem "fails_on_head" "$TID: $tail20"
  fi
  printf '%s' "$head_res" > "$TESTSTATUS/$sid.head"
  # base worktree
  WT="$(mktemp -d "${TMPDIR:-/tmp}/muse-base-XXXXXX")"
  base_res="fail"
  set +e
  git worktree add --detach "$WT" "$BASE_SHA" >/dev/null 2>&1
  wt_st=$?
  set -e
  if [ "$wt_st" -ne 0 ]; then
    add_problem "weak_before" "$TID: cannot create base worktree"
    base_res="weak"
  else
    # sparse-checkout excluding .sealed-paths entries (non-cone)
    if [ -f .sealed-paths ]; then
      {
        echo '/*'
        grep -v '^[[:space:]]*#' .sealed-paths | grep -v '^[[:space:]]*$' \
          | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^/!\//'
      } > "$WORK/sparse-$sid.txt"
      git -C "$WT" sparse-checkout set --no-cone --stdin < "$WORK/sparse-$sid.txt" >/dev/null 2>&1 \
        || { cp "$WORK/sparse-$sid.txt" "$WT/.git/info/sparse-checkout" 2>/dev/null || true;
             git -C "$WT" sparse-checkout reapply >/dev/null 2>&1 || true; }
    fi
    # copy the test's files from the working tree
    n=0
    while [ "$n" -lt "${TFILES_N:-0}" ]; do
      eval "f=\$TFILE_$n"
      if [ -e "$ROOT/$f" ]; then
        mkdir -p "$WT/$(dirname "$f")"
        cp "$ROOT/$f" "$WT/$f"
      fi
      n=$((n + 1))
    done
    if [ -n "$PREPARE" ]; then
      (cd "$WT" && sh -c "$PREPARE" >>"$TESTLOGS/$sid.base.log" 2>&1) || true
    fi
    set +e
    (cd "$WT" && sh -c "$TCMD" >>"$TESTLOGS/$sid.base.log" 2>&1)
    base_st=$?
    set -e
    if [ "$base_st" -eq 0 ]; then
      base_res="pass"
      add_problem "passes_on_base" "$TID"
    else
      if grep -qE "$WEAK_RX" "$TESTLOGS/$sid.base.log" 2>/dev/null; then
        base_res="weak"
        add_problem "weak_before" "$TID"
      else
        base_res="fail"
      fi
    fi
    git worktree remove --force "$WT" >/dev/null 2>&1 || true
    git worktree prune >/dev/null 2>&1 || true
    rmdir "$WT" 2>/dev/null || true
  fi
  printf '%s' "$base_res" > "$TESTSTATUS/$sid.base"
  printf '%s\n' "$TID" >> "$WORK/tids.txt"
  i=$((i + 1))
done

# --- e) full suite ---
if [ "$FULL" -eq 1 ]; then
  set +e
  (pnpm -r test >"$TESTLOGS/full.log" 2>&1)
  full_st=$?
  set -e
  if [ "$full_st" -ne 0 ]; then add_problem "full_suite_failed" "$(tail -n 20 "$TESTLOGS/full.log")"; fi
fi

# --- emit ---
JSON_OUT="$(NTESTS="$NTESTS" BASE_SHA="$BASE_SHA" PROBLEMS="$PROBLEMS" TESTSTATUS="$TESTSTATUS" python3 - <<'EOF'
import json, os
probs = []
with open(os.environ["PROBLEMS"]) as f:
    for line in f:
        line = line.strip()
        if line:
            probs.append(json.loads(line))
tests = []
tids = os.path.join(os.environ.get("TMPD", ""), "")
crit = {}
try:
    crit = json.load(open(".muse/criteria.json"))
except Exception:
    pass
for t in crit.get("tests", []) or []:
    tid = str(t.get("id", "t"))
    import re
    sid = re.sub(r"[^A-Za-z0-9_.-]", "_", tid)
    def rd(kind, default):
        try:
            return open(os.path.join(os.environ["TESTSTATUS"], sid + "." + kind)).read().strip() or default
        except OSError:
            return default
    tests.append({"id": tid, "head": rd("head", "fail"), "base": rd("base", "fail")})
print(json.dumps({"passed": len(probs) == 0, "base": os.environ["BASE_SHA"],
                  "problems": probs, "tests": tests}))
EOF
)"
printf '%s\n' "$JSON_OUT"
if [ -n "${VERIFY_OUT:-}" ]; then
  mkdir -p "$VERIFY_OUT"
  printf '%s\n' "$JSON_OUT" > "$VERIFY_OUT/verify.json"
  cp "$TESTLOGS"/* "$VERIFY_OUT"/ 2>/dev/null || true
fi
if [ -s "$PROBLEMS" ]; then exit 1; else exit 0; fi
