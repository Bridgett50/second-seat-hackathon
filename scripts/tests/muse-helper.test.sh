#!/usr/bin/env bash
# muse-helper.test.sh — self-test for .muse/guard.sh / .muse/verify_pr.sh.
# No muse/model calls. Runs in mktemp dirs only. Dummy sentinel path:
# sentinel/heldout-sealed/dummy.txt (never real sealed data).
REPO="$(git rev-parse --show-toplevel)"
GUARD="$REPO/.muse/guard.sh"
VERIFY="$REPO/.muse/verify_pr.sh"
SENTINEL="sentinel/heldout-sealed/dummy.txt"
FAIL=0

ok() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s: %s\n' "$1" "$2"; FAIL=1; }

gitinit() {
  git init -q "$1"
  git -C "$1" config user.email "t@t.t"
  git -C "$1" config user.name "t"
  printf '.muse/scope.txt\n.muse/criteria.json\n' > "$1/.gitignore"
  git -C "$1" add -A
  git -C "$1" commit -qm init
}

# ---------- H1: guard pre denies sealed reads ----------
R="$(mktemp -d)"; gitinit "$R"
o1="$(printf '{"hook_event_name":"PreToolUse","tool_name":"read_file","tool_input":{"path":"%s"},"cwd":"%s"}' "$SENTINEL" "$R" | bash "$GUARD" pre)"
o2="$(printf '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"cat ./Sentinel/HeldOut-Sealed/dummy.txt"},"cwd":"%s"}' "$R" | bash "$GUARD" pre)"
if printf '%s' "$o1" | grep -q '"deny"' && \
   printf '%s' "$o2" | grep -q '"deny"'; then ok H1; else bad H1 "o1=$o1 o2=$o2"; fi
rm -rf "$R"

# ---------- H2: guard pre scope enforcement for edits ----------
R="$(mktemp -d)"; gitinit "$R"
mkdir -p "$R/.muse" "$R/src"
printf 'src/a.ts\n' > "$R/.muse/scope.txt"
edit() { printf '{"hook_event_name":"PreToolUse","tool_name":"edit_file","tool_input":{"path":"%s"},"cwd":"%s"}' "$1" "$R" | bash "$GUARD" pre; }
e_deny="$(edit src/other.ts)"
e_allow="$(edit src/a.ts)"
rm "$R/.muse/scope.txt"
e_noscope="$(edit src/a.ts)"
printf 'src/a.ts\n' > "$R/.muse/scope.txt"
e_outside="$(edit ../outside.txt)"
if printf '%s' "$e_deny" | grep -q '"deny"' && \
   [ -z "$e_allow" ] && \
   printf '%s' "$e_noscope" | grep -q '"deny"' && \
   printf '%s' "$e_outside" | grep -q '"deny"'; then ok H2; else bad H2 "deny=$e_deny allow=$e_allow noscope=$e_noscope outside=$e_outside"; fi
rm -rf "$R"

# helper: make fake repo, print dir; base commit has files from setup fn
mkbase() { D="$(mktemp -d)"; gitinit "$D"; printf '%s' "$D"; }

# ---------- H3: real fail-then-pass -> passed true ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T3","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -eq 0 ] && printf '%s' "$v" | grep -q '"passed": true'; then ok H3; else bad H3 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H4: test passes on base -> passes_on_base ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T4","cmd":"true","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'passes_on_base'; then ok H4; else bad H4 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H5: change outside scope -> out_of_scope ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
printf 'echo x\n' > "$R/src/other.sh"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T5","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'out_of_scope'; then ok H5; else bad H5 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H6: deleted test file -> test_deleted ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'echo 1\n' > "$R/src/a.sh"
printf 'dummy test\n' > "$R/src/a.test.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
(cd "$R" && git rm -q src/a.test.sh && git commit -qm head)
printf 'src/a.sh\nsrc/a.test.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T6","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'test_deleted'; then ok H6; else bad H6 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H7: changed file under sentinel dir -> sealed_path ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
mkdir -p "$R/sentinel/heldout-sealed"
printf 'sentinel dummy\n' > "$R/$SENTINEL"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n%s\n' "$SENTINEL" > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T7","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'sealed_path'; then ok H7; else bad H7 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H8: base failure 'Cannot find module' -> weak_before ----------
R="$(mkbase)"; mkdir -p "$R/.muse"
(cd "$R" && git add -A && git commit -qm base --allow-empty 2>/dev/null || true)
BASE="$(git -C "$R" rev-parse HEAD)"
printf '#!/bin/sh\nif [ ! -f marker.txt ]; then echo "Error: Cannot find module '"'"'./marker'"'"'" >&2; exit 1; fi\nexit 0\n' > "$R/check.sh"
printf 'here\n' > "$R/marker.txt"
(cd "$R" && git add -A && git commit -qm head)
printf 'check.sh\nmarker.txt\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T8","cmd":"sh check.sh","files":["check.sh"]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'weak_before'; then ok H8; else bad H8 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H9: stop blocks twice, then allows ----------
R="$(mkbase)"
cp -r "$REPO/scripts" "$R/scripts"; mkdir -p "$R/.muse"; cp "$REPO/.muse/verify_pr.sh" "$R/.muse/verify_pr.sh"
mkdir -p "$R/.muse"
printf 'scripts/*\nscripts/tests/*\n.muse/*\n' > "$R/.muse/scope.txt"
printf '{"base":"HEAD","tests":[{"id":"T9","cmd":"false","files":[]}]}' > "$R/.muse/criteria.json"
(cd "$R" && git add -A && git commit -qm head)
export TMPDIR="$R/tmp"; mkdir -p "$TMPDIR"
sin="$(printf '{"hook_event_name":"Stop","session_id":"h9sess","cwd":"%s"}' "$R")"
s1="$(printf '%s' "$sin" | bash "$GUARD" stop)"
s2="$(printf '%s' "$sin" | bash "$GUARD" stop)"
s3="$(printf '%s' "$sin" | bash "$GUARD" stop)"
if printf '%s' "$s1" | grep -q '"block"' && \
   printf '%s' "$s2" | grep -q '"block"' && \
   [ -z "$s3" ]; then ok H9; else bad H9 "s1=$s1 s2=$s2 s3=$s3"; fi
unset TMPDIR
rm -rf "$R"

# ---------- H10: root pointer layout ----------
H10_BAD=""
[ -f "$REPO/.agents/AGENTS.md" ] || H10_BAD="${H10_BAD} missing-agents-rules;"
if ! grep -q "Failing test first" "$REPO/.agents/AGENTS.md" 2>/dev/null; then H10_BAD="${H10_BAD} rules-text-missing;"; fi
if ! grep -q ".muse/guard.sh" "$REPO/.muse/hooks.json" 2>/dev/null; then H10_BAD="${H10_BAD} hooks-no-guard;"; fi
if grep -q "scripts/" "$REPO/.muse/hooks.json" 2>/dev/null; then H10_BAD="${H10_BAD} hooks-refs-scripts;"; fi
if [ -e "$REPO/scripts/muse_guard.sh" ]; then H10_BAD="${H10_BAD} stray-muse_guard;"; fi
if [ -e "$REPO/scripts/verify_pr.sh" ]; then H10_BAD="${H10_BAD} stray-verify_pr;"; fi
if [ ! -f "$REPO/AGENTS.md" ]; then H10_BAD="${H10_BAD} no-root-pointer;"; fi
if ! grep -q ".agents/AGENTS.md" "$REPO/AGENTS.md" 2>/dev/null; then H10_BAD="${H10_BAD} pointer-no-ref;"; fi
if grep -q "Failing test first" "$REPO/AGENTS.md" 2>/dev/null; then H10_BAD="${H10_BAD} pointer-copies-rules;"; fi
if [ -z "$H10_BAD" ]; then ok H10; else bad H10 "$H10_BAD"; fi

# ---------- H12: root pointer resolves ----------
H12_BAD=""
H12_TOKS="$(grep -o -E '[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)+(:[0-9]+)?|[A-Za-z0-9_.-]*\.(md|json|sh)(:[0-9]+)?' "$REPO/AGENTS.md" 2>/dev/null | sed -E 's/:[0-9]+$//; s/[`.,;:!?)]+$//; s/^[(`]+//' | sort -u)"
H12_UNRESOLVED=""
for H12_T in $H12_TOKS; do
  [ -z "$H12_T" ] && continue
  if [ ! -e "$REPO/$H12_T" ]; then H12_UNRESOLVED="${H12_UNRESOLVED} $H12_T"; fi
done
if [ -n "$H12_UNRESOLVED" ]; then H12_BAD="${H12_BAD} unresolved:$H12_UNRESOLVED;"; fi
H12_LINES="$(grep -c '[^[:space:]]' "$REPO/AGENTS.md" 2>/dev/null || true)"
if [ "$H12_LINES" -gt 3 ]; then H12_BAD="${H12_BAD} too-many-lines=$H12_LINES;"; fi
if ! printf '%s\n' "$H12_TOKS" | grep -qxF ".agents/AGENTS.md"; then H12_BAD="${H12_BAD} no-agents-ref;"; fi
if [ -z "$H12_BAD" ]; then ok H12; else bad H12 "$H12_BAD"; fi

# ---------- H11: prompt injection ----------
H11D="$(mktemp -d)"
H11BIN="$(mktemp -d)"
H11OUT="$(mktemp -d)"
export FAKE_OUT="$H11OUT"
printf '0' > "$H11OUT/count"
cat > "$H11BIN/muse" <<'FAKEEOF'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ]; then
  shift
  PFILE=""; LAST=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --prompt-file) PFILE="${2:-}"; shift 2;;
      --model|--contributor-mode|--reasoning-effort|--max-model-steps|--sandbox-network|--session-id) shift 2;;
      --disable-approval|--trust-workspace|--json) shift 1;;
      *) LAST="$1"; shift;;
    esac
  done
  N="$(cat "$FAKE_OUT/count" 2>/dev/null || echo 0)"
  N=$((N + 1))
  printf '%s' "$N" > "$FAKE_OUT/count"
  if [ -n "$PFILE" ] && [ -f "$PFILE" ]; then
    cat "$PFILE" > "$FAKE_OUT/prompt-$N.txt"
  else
    printf '%s' "$LAST" > "$FAKE_OUT/prompt-$N.txt"
  fi
  exit 0
elif [ "${1:-}" = "export" ]; then
  exit 0
else
  exit 0
fi
FAKEEOF
chmod +x "$H11BIN/muse"
gitinit "$H11D"
mkdir -p "$H11D/scripts" "$H11D/.agents" "$H11D/.muse"
cp "$REPO/scripts/muse_pr.sh" "$H11D/scripts/muse_pr.sh"
chmod +x "$H11D/scripts/muse_pr.sh"
cp "$REPO/.agents/AGENTS.md" "$H11D/.agents/AGENTS.md"
cat > "$H11D/.muse/verify_pr.sh" <<'STUBEOF'
#!/usr/bin/env bash
printf '{"passed":true,"problems":[]}'
exit 0
STUBEOF
chmod +x "$H11D/.muse/verify_pr.sh"
printf 'TASK-SENTINEL-H11\n' > "$H11D/task.txt"
printf '{"base":"HEAD","tests":[]}' > "$H11D/crit.json"
(cd "$H11D" && git add -A && git commit -qm h11base)
H11_OLD_PATH="$PATH"
export PATH="$H11BIN:$PATH"
H11ERR="$(mktemp)"
H11A_WHY=""; H11B_WHY=""
if (cd "$H11D" && bash scripts/muse_pr.sh --task "$H11D/task.txt" --scope "a.txt" --criteria "$H11D/crit.json" --evidence evidence/H11 2>"$H11ERR"); then H11_ST=0; else H11_ST=$?; fi
if [ "$H11_ST" -ne 0 ]; then H11A_WHY="exit=$H11_ST;"; fi
if [ ! -f "$H11OUT/prompt-1.txt" ]; then H11A_WHY="${H11A_WHY}no-prompt-1;"; fi
if [ -z "$H11A_WHY" ]; then
  if ! grep -q "Failing test first" "$H11OUT/prompt-1.txt"; then H11A_WHY="${H11A_WHY}no-rules;"; fi
  if ! grep -q "TASK-SENTINEL-H11" "$H11OUT/prompt-1.txt"; then H11A_WHY="${H11A_WHY}no-sentinel;"; fi
fi
if [ -z "$H11A_WHY" ]; then
  R_POS="$(grep -b -o "Failing test first" "$H11OUT/prompt-1.txt" | head -n1 | cut -d: -f1)"
  S_POS="$(grep -b -o "TASK-SENTINEL-H11" "$H11OUT/prompt-1.txt" | head -n1 | cut -d: -f1)"
  if [ -z "$R_POS" ] || [ -z "$S_POS" ] || [ "$R_POS" -ge "$S_POS" ]; then H11A_WHY="order R=$R_POS S=$S_POS;"; fi
fi
N_BEFORE="$(cat "$H11OUT/count")"
rm "$H11D/.agents/AGENTS.md"
H11ERR2="$(mktemp)"
if (cd "$H11D" && bash scripts/muse_pr.sh --task "$H11D/task.txt" --scope "a.txt" --criteria "$H11D/crit.json" --evidence evidence/H11b 2>"$H11ERR2"); then H11_ST2=0; else H11_ST2=$?; fi
N_AFTER="$(cat "$H11OUT/count")"
if [ "$H11_ST2" -ne 2 ]; then H11B_WHY="missing-exit=$H11_ST2;"; fi
if [ "$N_AFTER" != "$N_BEFORE" ]; then H11B_WHY="${H11B_WHY}muse-called-on-missing;"; fi
export PATH="$H11_OLD_PATH"
if [ -z "$H11A_WHY" ] && [ -z "$H11B_WHY" ]; then ok H11; else bad H11 "inject:${H11A_WHY:-ok} missing:${H11B_WHY:-ok} st=${H11_ST:-?}/${H11_ST2:-?}"; fi
rm -f "$H11ERR" "$H11ERR2"
rm -rf "$H11D" "$H11BIN" "$H11OUT"
unset FAKE_OUT

if [ "$FAIL" -ne 0 ]; then printf '%s\n' "SELF-TEST FAILED"; exit 1; fi
printf '%s\n' "SELF-TEST OK"
