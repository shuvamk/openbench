#!/usr/bin/env bash
# Release a claimed issue back to status:ready (or status:blocked).
# Use this if you can't finish — agent terminated, blocked on info, etc.
#
# Usage: release-issue.sh <issue-number> [--blocked] [--reason "<text>"]
#
# Default: returns to status:ready so another worker can pick it up.
# --blocked: marks status:blocked instead (needs human/other-issue input).

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

ISSUE_NUM="${1:-}"; shift || true
BLOCKED=0
REASON=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --blocked) BLOCKED=1; shift;;
    --reason)  REASON="$2"; shift 2;;
    *) shift;;
  esac
done

[[ -n "$ISSUE_NUM" ]] || { echo "Usage: release-issue.sh <issue-number> [--blocked] [--reason \"<text>\"]" >&2; exit 2; }

READY="$(sdlc_status_ready)"
IN_PROGRESS="$(sdlc_status_in_progress)"
BLOCKED_LBL="$(sdlc_status_blocked)"

STATE_FILE="$SDLC_STATE_DIR/claim-${ISSUE_NUM}.json"
WORKER_ID="$(jq -r '.worker_id // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")"

delete_all_claim_comments "$ISSUE_NUM"
remove_labels "$ISSUE_NUM" "$IN_PROGRESS" "agent:claimed"
if [[ $BLOCKED -eq 1 ]]; then
  add_labels "$ISSUE_NUM" "$BLOCKED_LBL"
  TAG="🚫 Released as **blocked**"
else
  add_labels "$ISSUE_NUM" "$READY"
  TAG="🔓 Released back to **ready**"
fi

post_comment "$ISSUE_NUM" "$TAG by \`$WORKER_ID\` at $(iso_now).${REASON:+

**Reason:** $REASON}" >/dev/null

rm -f "$STATE_FILE"

echo "released #$ISSUE_NUM"
