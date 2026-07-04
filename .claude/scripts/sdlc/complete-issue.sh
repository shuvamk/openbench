#!/usr/bin/env bash
# Mark a claimed issue as done-and-in-review and link the PR.
# Use this after the PR is open (openbench merges via the reviewer gate +
# auto-merge, so "complete" here means "handed to the review gate").
#
# Usage: complete-issue.sh <issue-number> <pr-url> [--summary "<text>"]
#
# Effect:
#  - Updates the claim comment one last time with the PR url.
#  - Removes status:in-progress, adds status:needs-review.
#  - Posts a "in review" comment with the PR link.
#  - Removes local claim state.
#
# Note: the issue itself is NOT closed here — closing happens automatically
# when the PR (with a "Fixes #<num>" line) is merged into main by auto-merge.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

ISSUE_NUM="${1:-}"; PR_URL="${2:-}"
shift 2 2>/dev/null || true
SUMMARY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary) SUMMARY="$2"; shift 2;;
    *) shift;;
  esac
done

[[ -n "$ISSUE_NUM" && -n "$PR_URL" ]] \
  || { echo "Usage: complete-issue.sh <issue-number> <pr-url> [--summary \"<text>\"]" >&2; exit 2; }

IN_PROGRESS="$(sdlc_status_in_progress)"
REVIEW="$(sdlc_status_review)"

# Bump heartbeat one last time and stamp the PR url. Best-effort.
"$(dirname "$0")/heartbeat.sh" "$ISSUE_NUM" "$PR_URL" 2>/dev/null || \
  echo "note: heartbeat skipped (no claim state); proceeding with label swap" >&2

# Label swap is the source of truth for the SDLC queue. Always run it.
remove_labels "$ISSUE_NUM" "$IN_PROGRESS"
add_labels    "$ISSUE_NUM" "$REVIEW"

post_comment "$ISSUE_NUM" "🔍 **In review** — see $PR_URL${SUMMARY:+

$SUMMARY}

_Awaiting the reviewer gate + \`test\` CI. Auto-closes when the PR merges (via \`Fixes #$ISSUE_NUM\` in the PR body)._" >/dev/null

rm -f "$SDLC_STATE_DIR/claim-${ISSUE_NUM}.json"

echo "completed #$ISSUE_NUM → $PR_URL (now $REVIEW)"
