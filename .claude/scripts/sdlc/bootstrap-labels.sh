#!/usr/bin/env bash
# Idempotently create/reconcile the openbench label set on the configured
# GitHub repo. Safe to re-run. Mirrors .github/LABELS.md.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated." >&2
  echo "       Run \`gh auth login\` first, then re-run this script." >&2
  exit 1
fi

repo="$(sdlc_repo)"
if ! gh repo view "$repo" >/dev/null 2>&1; then
  echo "ERROR: cannot access GitHub repo '$repo'." >&2
  echo "       Check that the repo exists and your gh user has read access." >&2
  echo "       (Configured in .claude/sdlc/config.json under \`repo\`.)" >&2
  exit 1
fi

ensure_label() {
  local name="$1" color="$2" desc="$3"
  # Atomic upsert: `gh label create --force` creates the label, or updates its
  # color/description if it already exists. This replaces a check-then-create
  # (list | grep, then create) that raced — a grep miss on an existing label
  # made `create` fail with "already exists" and, under `set -e`, killed the
  # whole run mid-way.
  gh label create "$name" $(gh_repo_flag) --color "$color" --description "$desc" --force >/dev/null
  echo "  [~] $name"
}

echo "Bootstrapping openbench labels on $repo..."

# Status (the state machine — exactly one applied at a time)
ensure_label "status:needs-design"  "5319e7" "Blocked on a genuinely irreversible decision — rare"
ensure_label "status:blocked"       "b60205" "Blocked on another issue"
ensure_label "status:ready"         "0e8a16" "Fully specified, acceptance criteria as tests, claimable"
ensure_label "status:in-progress"   "fbca04" "Claimed; exactly one agent working it"
ensure_label "status:needs-tdd-red" "d93f0b" "Implementation without a failing-test-first history"
ensure_label "status:needs-review"  "1d76db" "PR open, awaiting the reviewer gate"

# Priority (BARE labels — no prefix)
ensure_label "p0" "b60205" "Production broken / pipeline blocked — drop everything"
ensure_label "p1" "d93f0b" "Current milestone"
ensure_label "p2" "c2e0c6" "Nice to have / later"

# Area
ensure_label "area:ir-schema"     "006b75" "packages/ir-schema — the canonical IR"
ensure_label "area:mcp-kicad"     "0052cc" "KiCad adapter"
ensure_label "area:mcp-sim"       "0052cc" "Simulation adapters (ngspice/renode/qemu)"
ensure_label "area:mcp-firmware"  "0052cc" "Firmware adapter (PlatformIO)"
ensure_label "area:registry"      "5319e7" "Component/board registry"
ensure_label "area:frontend"      "1d76db" "apps/web UI"
ensure_label "area:ai"            "8a2be2" "AI product surface — agent tools + in-app copilot"
ensure_label "area:collab-engine" "cccccc" "Multiplayer/CRDT (Phase 2 — should stay empty)"
ensure_label "area:agent-ops"     "555555" "Agent pipeline, skills, hooks, CI"

# Type
ensure_label "type:feature"  "0e8a16" "New user-facing or engine capability"
ensure_label "type:bug"      "d73a4a" "Something broken vs. documented behavior"
ensure_label "type:test"     "c5def5" "Test-only work (coverage, harnesses, contract tests)"
ensure_label "type:refactor" "fbca04" "Behavior-preserving restructure"
ensure_label "type:spike"    "d4c5f9" "Time-boxed research; output is a written finding"
ensure_label "type:infra"    "ededed" "CI/CD, hooks, repo tooling, deploy"
ensure_label "type:docs"     "0075ca" "Documentation"

# Agent
ensure_label "agent:planned" "bfdadc" "Created by the planner agent"
ensure_label "agent:claimed" "fef2c0" "An agent is actively working it"
ensure_label "agent:done"    "c2e0c6" "Agent work complete (set on close)"

echo "Done."
