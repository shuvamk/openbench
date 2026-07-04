#!/usr/bin/env bash
# Shared helpers for the SDLC pipeline scripts.
# Source this file from every script:  source "$(dirname "$0")/_lib.sh"
#
# Adapted for openbench's label taxonomy (see .github/LABELS.md):
#   - status labels are prefixed:   status:ready / status:in-progress /
#                                    status:needs-review / status:blocked
#   - priority labels are BARE:     p0 / p1 / p2   (no "priority:" prefix)
#   - area / type labels prefixed:  area:<x> / type:<x>
#   - agent labels prefixed:        agent:claimed / agent:planned / agent:done

set -euo pipefail

SDLC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../sdlc" && pwd)"
SDLC_STATE_DIR="$SDLC_DIR/state"
SDLC_CONFIG="$SDLC_DIR/config.json"

mkdir -p "$SDLC_STATE_DIR"

if [[ ! -f "$SDLC_CONFIG" ]]; then
  echo "FATAL: $SDLC_CONFIG missing" >&2
  exit 2
fi

# --- config accessors ---
sdlc_repo()              { jq -r '.repo' "$SDLC_CONFIG"; }
sdlc_heartbeat_stale()   { jq -r '.heartbeat_stale_after_seconds' "$SDLC_CONFIG"; }
sdlc_priorities()        { jq -r '.priorities[]' "$SDLC_CONFIG"; }
sdlc_areas()             { jq -r '.areas[]' "$SDLC_CONFIG"; }
sdlc_types()             { jq -r '.types[]' "$SDLC_CONFIG"; }
sdlc_default_priority()  { jq -r '.default_priority' "$SDLC_CONFIG"; }

# Status label names (single source of truth — flip these if the taxonomy moves).
sdlc_status_ready()      { jq -r '.status.ready'       "$SDLC_CONFIG"; }
sdlc_status_in_progress(){ jq -r '.status.in_progress' "$SDLC_CONFIG"; }
sdlc_status_review()     { jq -r '.status.review'      "$SDLC_CONFIG"; }
sdlc_status_blocked()    { jq -r '.status.blocked'     "$SDLC_CONFIG"; }

# --- timestamps ---
iso_now()                { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
epoch_now()              { date -u +%s; }
iso_to_epoch()           {
  # Cross-platform ISO8601 → epoch (macOS BSD date + GNU date both supported).
  local iso="$1"
  if date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s 2>/dev/null; then return; fi
  date -u -d "$iso" +%s
}

# --- fingerprint ---
sdlc_fingerprint() {
  # sha1 of: source-tag + sorted unique evidence lines + title (trimmed).
  # Stable enough to dedupe re-files, sensitive enough to differentiate findings.
  local source="$1" title="$2" shift_count=2
  shift $shift_count
  local evidence
  evidence="$(printf '%s\n' "$@" | sort -u)"
  printf '%s|%s|%s' "$source" "$title" "$evidence" \
    | shasum -a 1 \
    | awk '{print substr($1,1,12)}'
}

# --- gh wrappers ---
gh_repo_flag() { echo "--repo" "$(sdlc_repo)"; }

require_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "FATAL: gh CLI not installed" >&2
    exit 2
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "FATAL: gh CLI not authenticated. Run: gh auth login" >&2
    exit 2
  fi
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "FATAL: jq not installed" >&2
    exit 2
  fi
}

# Find a comment by HTML marker prefix. Returns REST id of the LATEST match
# (or empty string if none). Comments are listed oldest→newest; we want the
# last claim comment so the active worker's claim is what we patch.
find_comment_by_marker() {
  local issue_num="$1" marker="$2"
  gh api "repos/$(sdlc_repo)/issues/${issue_num}/comments" --paginate \
    | jq -r --arg m "$marker" '[.[] | select(.body | startswith($m))] | last | .id // empty'
}

# Delete any existing claim-v1 comments on the issue. Used by release-issue.sh
# and reap-stale.sh so the next claimant doesn't see stale claim residue.
delete_all_claim_comments() {
  local issue_num="$1"
  local ids
  ids="$(gh api "repos/$(sdlc_repo)/issues/${issue_num}/comments" --paginate \
        | jq -r '.[] | select(.body | startswith("<!-- claim-v1 worker:")) | .id')"
  for id in $ids; do
    gh api -X DELETE "repos/$(sdlc_repo)/issues/comments/${id}" >/dev/null 2>&1 || true
  done
}

# Patch a comment body in place (heartbeat edit).
patch_comment() {
  local comment_id="$1" body="$2"
  gh api -X PATCH "repos/$(sdlc_repo)/issues/comments/${comment_id}" -f body="$body" >/dev/null
}

post_comment() {
  local issue_num="$1" body="$2"
  gh api "repos/$(sdlc_repo)/issues/${issue_num}/comments" -f body="$body" --jq '.id'
}

# Add/remove labels (idempotent — gh tolerates already-applied / already-absent).
add_labels() {
  local issue_num="$1"; shift
  gh issue edit "$issue_num" $(gh_repo_flag) --add-label "$(IFS=,; echo "$*")" >/dev/null
}

remove_labels() {
  local issue_num="$1"; shift
  for l in "$@"; do
    gh issue edit "$issue_num" $(gh_repo_flag) --remove-label "$l" >/dev/null 2>&1 || true
  done
}

issue_labels() {
  local issue_num="$1"
  gh issue view "$issue_num" $(gh_repo_flag) --json labels --jq '.labels[].name'
}

issue_has_label() {
  local issue_num="$1" label="$2"
  issue_labels "$issue_num" | grep -Fxq "$label"
}

# Slugify a string into a kebab-case branch slug, max 30 chars.
kebab_slug() {
  local s="$1"
  echo "$s" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' \
    | cut -c1-30 \
    | sed -E 's/-+$//'
}

# Worker ID — combines slug + short random tag so two workers picking with the
# same task slug never collide.
worker_id() {
  local slug="$1"
  echo "${slug}-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c4)"
}
