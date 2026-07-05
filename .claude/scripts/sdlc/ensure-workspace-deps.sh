#!/usr/bin/env bash
# Ensure a worktree's node_modules has every workspace package linked, BEFORE
# tests run. A fresh worktree that symlinks node_modules from the main checkout
# goes STALE the moment a new @openbench/* workspace package lands: the package
# exists in the worktree's source tree but not in node_modules, so imports fail
# to resolve and a green change looks red — a false "main is red" that has
# wasted worker cycles (issue #113; the concrete case was #93,
# @openbench/schematic-ops). This preflight detects that and runs `npm install`
# ONCE; when every workspace package already resolves it is a fast no-op.
#
# Two modes:
#   (default)  auto-fix — run `npm install` once when a package is missing.
#   --check    guard    — assert every package is linked; on a miss, exit
#                         non-zero with an actionable message and DO NOT install
#                         (never mutates the tree). Use as a fast pretest guard
#                         (issue #128).
#
# Usage: ensure-workspace-deps.sh [--check] [worktree-dir]   (dir defaults to CWD)
# Exit:  0 deps OK · 1 install failed (default) / packages missing (--check)
#        · 2 misuse.

set -euo pipefail

CHECK_ONLY=0
WT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift;;
    -*) echo "ensure-workspace-deps: unknown flag: $1" >&2; exit 2;;
    *) WT="$1"; shift;;
  esac
done
[[ -n "$WT" ]] || WT="$PWD"

if [[ ! -f "$WT/package.json" ]]; then
  echo "ensure-workspace-deps: no package.json at '$WT'" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ensure-workspace-deps: jq is required" >&2
  exit 2
fi

# Collect workspace package names from the worktree's OWN source tree (apps/* +
# packages/*), so a package added on this branch is always accounted for even if
# the symlinked node_modules predates it. Mirrors the root package.json
# workspaces globs; bash 3.2-safe (no mapfile, no empty-array expansion).
NAMES=()
for f in "$WT"/packages/*/package.json "$WT"/apps/*/package.json; do
  if [[ -f "$f" ]]; then
    name="$(jq -r '.name // empty' "$f")"
    if [[ -n "$name" ]]; then
      NAMES+=("$name")
    fi
  fi
done

if [[ ${#NAMES[@]} -eq 0 ]]; then
  echo "ensure-workspace-deps: no workspace packages found under '$WT' — nothing to check"
  exit 0
fi

# A workspace package resolves when node_modules/<name>/package.json exists.
# `-e` follows symlinks, so a broken link and an absent one both read as missing.
missing=()
for name in "${NAMES[@]}"; do
  if [[ ! -e "$WT/node_modules/$name/package.json" ]]; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  echo "ensure-workspace-deps: all ${#NAMES[@]} workspace packages resolve — no install needed"
  exit 0
fi

echo "ensure-workspace-deps: ${#missing[@]} of ${#NAMES[@]} workspace package(s) missing from node_modules:" >&2
for name in "${missing[@]}"; do
  echo "  - $name" >&2
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  # Guard mode (issue #128): fail loudly, don't mutate the tree.
  echo "ensure-workspace-deps: stale node_modules — run 'npm install' at '$WT' before tests" >&2
  exit 1
fi

echo "ensure-workspace-deps: running 'npm install' at '$WT' (stale symlink refresh) ..."
( cd "$WT" && npm install ) || {
  echo "ensure-workspace-deps: npm install failed" >&2
  exit 1
}
echo "ensure-workspace-deps: install complete — workspace packages linked"
