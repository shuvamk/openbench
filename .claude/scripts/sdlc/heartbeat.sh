#!/usr/bin/env bash
# Update the heartbeat on a claimed issue.
#
# Usage: heartbeat.sh <issue-number> [pr-url]
#
# Re-reads the local claim state, edits the sticky claim comment in place
# with a fresh timestamp. Call this at logical checkpoints during work
# (after investigation, after implementation, before/after tests, before PR).
#
# NOTE: run from the MAIN checkout (or via absolute path). The .claude/
# directory only exists in the main checkout, not in feature worktrees.
#
# Exit codes: 0 ok, 1 no claim state found, 3 gh failure.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

ISSUE_NUM="${1:-}"
PR_URL="${2:-}"
[[ -n "$ISSUE_NUM" ]] || { echo "Usage: heartbeat.sh <issue-number> [pr-url]" >&2; exit 2; }

READY="$(sdlc_status_ready)"
STATE_FILE="$SDLC_STATE_DIR/claim-${ISSUE_NUM}.json"

# Recovery path: if local state is gone but a sticky claim comment still
# exists on the issue, rebuild a minimal state so the heartbeat can still
# patch the comment in place.
if [[ ! -f "$STATE_FILE" ]]; then
  RECOVERED_ID="$(find_comment_by_marker "$ISSUE_NUM" "<!-- claim-v1 worker:")"
  if [[ -z "$RECOVERED_ID" ]]; then
    echo "ERROR: no local claim state and no claim-v1 sticky comment for issue #$ISSUE_NUM" >&2
    exit 1
  fi
  echo "WARN: local claim state missing for #$ISSUE_NUM — preserving sticky-comment metadata $RECOVERED_ID" >&2
  RECOVERED_BODY="$(gh api "repos/$(sdlc_repo)/issues/comments/${RECOVERED_ID}" --jq '.body')"
  WORKER_ID="$(printf '%s' "$RECOVERED_BODY" | grep -oE 'worker:[^ >]+' | head -1 | sed 's/worker://')"
  BRANCH="$(printf    '%s' "$RECOVERED_BODY" | grep -E '\| Branch \|'      | sed -E 's/.*\`([^`]+)\`.*/\1/')"
  WORKTREE="$(printf  '%s' "$RECOVERED_BODY" | grep -E '\| Worktree \|'    | sed -E 's/.*\`([^`]+)\`.*/\1/')"
  CLAIMED_AT="$(printf '%s' "$RECOVERED_BODY" | grep -E '\| Claimed at \|' | sed -E 's/.*\`([^`]+)\`.*/\1/')"
  [[ -n "$WORKER_ID"  ]] || WORKER_ID="recovered"
  [[ -n "$BRANCH"     ]] || BRANCH="unknown"
  [[ -n "$WORKTREE"   ]] || WORKTREE="unknown"
  [[ -n "$CLAIMED_AT" ]] || CLAIMED_AT="$(iso_now)"
  COMMENT_ID="$RECOVERED_ID"
else
  WORKER_ID="$(jq -r '.worker_id'        "$STATE_FILE")"
  BRANCH="$(jq    -r '.branch'           "$STATE_FILE")"
  WORKTREE="$(jq  -r '.worktree'         "$STATE_FILE")"
  CLAIMED_AT="$(jq -r '.claimed_at'      "$STATE_FILE")"
  COMMENT_ID="$(jq -r '.claim_comment_id' "$STATE_FILE")"
fi

NOW="$(iso_now)"
PR_LINE="${PR_URL:-_pending_}"

STALE_S="$(sdlc_heartbeat_stale)"
IFS= read -r -d '' NEW_BODY <<EOF || true
<!-- claim-v1 worker:$WORKER_ID -->
🤖 **Claimed by** \`$WORKER_ID\`

| Field | Value |
|---|---|
| Claimed at | \`$CLAIMED_AT\` |
| Last heartbeat | \`$NOW\` |
| Branch | \`$BRANCH\` |
| Worktree | \`$WORKTREE\` |
| PR | $PR_LINE |

_Heartbeat extends the lease. If this comment isn't updated within ${STALE_S}s, the reaper will release the issue back to \`$READY\`._
EOF

patch_comment "$COMMENT_ID" "$NEW_BODY" || { echo "FATAL: could not patch claim comment" >&2; exit 3; }

# Update local state too — only if state exists.
if [[ -f "$STATE_FILE" ]]; then
  TMP="$(mktemp)"
  jq --arg ts "$NOW" --arg pr "${PR_URL:-}" '. + {last_heartbeat: $ts, pr_url: (if $pr == "" then .pr_url else $pr end)}' "$STATE_FILE" > "$TMP" && mv "$TMP" "$STATE_FILE"
fi

echo "heartbeat ok: issue #$ISSUE_NUM at $NOW"
