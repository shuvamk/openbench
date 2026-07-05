#!/usr/bin/env bash
# Test for ensure-workspace-deps.sh (issue #113).
#
# Simulates a fresh worktree whose node_modules (symlinked from the main
# checkout) is STALE — it lacks a newly-added @openbench/* workspace package.
# The preflight must detect the missing package and run `npm install`; when
# every workspace package already resolves it must be a no-op. `npm` is stubbed
# on PATH so the test neither hits the network nor needs a real install.
#
# Run:  bash .claude/scripts/sdlc/ensure-workspace-deps.test.sh
# Exit: 0 all assertions passed, 1 otherwise.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/ensure-workspace-deps.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- Build a fake worktree: 2 packages + 1 app, node_modules missing one pkg ---
WT="$TMP/worktree"
mkdir -p "$WT/packages/foo" "$WT/packages/bar" "$WT/apps/web"
printf '{"workspaces":["apps/*","packages/*"]}\n' > "$WT/package.json"
printf '{"name":"@openbench/foo"}\n' > "$WT/packages/foo/package.json"
printf '{"name":"@openbench/bar"}\n' > "$WT/packages/bar/package.json"
printf '{"name":"@openbench/web"}\n' > "$WT/apps/web/package.json"

# node_modules has bar + web linked, but NOT foo (the newly-added package).
mkdir -p "$WT/node_modules/@openbench/bar" "$WT/node_modules/@openbench/web"
printf '{"name":"@openbench/bar"}\n' > "$WT/node_modules/@openbench/bar/package.json"
printf '{"name":"@openbench/web"}\n' > "$WT/node_modules/@openbench/web/package.json"

# --- Stub npm on PATH: record the cwd it was invoked from on `install` ---
STUB="$TMP/bin"
mkdir -p "$STUB"
cat > "$STUB/npm" <<'NPMSTUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "install" ]]; then printf '%s\n' "$PWD" > "$NPM_STUB_MARKER"; fi
exit 0
NPMSTUB
chmod +x "$STUB/npm"
export PATH="$STUB:$PATH"

# --- Case 1: stale worktree (foo missing) → preflight installs ---------------
export NPM_STUB_MARKER="$TMP/case1-install"
bash "$SUT" "$WT" || fail "preflight exited non-zero on a stale worktree"
[[ -f "$NPM_STUB_MARKER" ]] || fail "npm install was NOT run for a stale worktree"
[[ "$(cat "$NPM_STUB_MARKER")" == "$WT" ]] \
  || fail "npm install ran in the wrong dir: $(cat "$NPM_STUB_MARKER") (want $WT)"
echo "PASS: stale worktree triggered npm install at the worktree root"

# --- Case 3: --check on a stale worktree → guard fails loudly, NO install -----
# (guard semantics for issue #128: exit non-zero with an actionable message,
#  never mutate the tree.)
export NPM_STUB_MARKER="$TMP/case3-install"
set +e
OUT="$(bash "$SUT" --check "$WT" 2>&1)"; RC=$?
set -e
[[ $RC -ne 0 ]] || fail "--check exited 0 on a stale worktree (should fail loudly)"
[[ -f "$NPM_STUB_MARKER" ]] && fail "--check ran npm install (guard must not mutate the tree)"
echo "$OUT" | grep -qi "npm install" || fail "--check message did not mention 'npm install': $OUT"
echo "$OUT" | grep -q "@openbench/foo" || fail "--check did not name the missing package: $OUT"
echo "PASS: --check on a stale worktree failed loudly without installing"

# --- Case 2: fully-linked worktree → no-op (no install) ----------------------
mkdir -p "$WT/node_modules/@openbench/foo"
printf '{"name":"@openbench/foo"}\n' > "$WT/node_modules/@openbench/foo/package.json"
export NPM_STUB_MARKER="$TMP/case2-install"
bash "$SUT" "$WT" || fail "preflight exited non-zero on a fresh worktree"
[[ -f "$NPM_STUB_MARKER" ]] && fail "npm install ran even though all packages resolve"
echo "PASS: fully-linked worktree was a no-op"

# --- Case 4: --check on a fully-linked worktree → exit 0 ----------------------
export NPM_STUB_MARKER="$TMP/case4-install"
bash "$SUT" --check "$WT" >/dev/null 2>&1 || fail "--check exited non-zero when all packages resolve"
[[ -f "$NPM_STUB_MARKER" ]] && fail "--check ran npm install on a fully-linked worktree"
echo "PASS: --check on a fully-linked worktree exited 0"

echo "ALL PASS"
