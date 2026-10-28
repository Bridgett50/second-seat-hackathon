#!/usr/bin/env bash
# muse-helper.test.sh — self-test for muse_guard.sh / verify_pr.sh.
# No muse/model calls. Runs in mktemp dirs only. Dummy sentinel path:
# sentinel/heldout-sealed/dummy.txt (never real sealed data).
REPO="$(git rev-parse --show-toplevel)"
GUARD="$REPO/scripts/muse_guard.sh"
VERIFY="$REPO/scripts/verify_pr.sh"
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
cp -r "$REPO/scripts" "$R/scripts"
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

if [ "$FAIL" -ne 0 ]; then printf '%s\n' "SELF-TEST FAILED"; exit 1; fi
printf '%s\n' "SELF-TEST OK"
