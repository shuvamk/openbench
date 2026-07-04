#!/usr/bin/env bash
# Claim a specific issue: swap labels, post sticky claim comment, save state.
#
# Usage: claim-issue.sh <issue-number> <worker-slug> <branch-name> [worktree-path]
#
# Output (stdout): JSON with {issue_number, comment_id, worker_id, branch, worktree, claimed_at}
# Exit codes: 0 claimed, 1 race lost (another worker won), 2 misuse, 3 gh failure.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

ISSUE_NUM="${1:-}"
SLUG="${2:-}"
BRANCH="${3:-}"
WORKTREE="${4:-.claude/worktrees/$SLUG}"

[[ -n "$ISSUE_NUM" && -n "$SLUG" && -n "$BRANCH" ]] \
  || { echo "Usage: claim-issue.sh <issue-number> <worker-slug> <branch> [worktree]" >&2; exit 2; }

READY="$(sdlc_status_ready)"
IN_PROGRESS="$(sdlc_status_in_progress)"

WORKER_ID="$(worker_id "$SLUG")"
NOW="$(iso_now)"

# Sanity: not already in-progress.
if issue_has_label "$ISSUE_NUM" "$IN_PROGRESS"; then
  echo "REFUSED: issue #$ISSUE_NUM is already $IN_PROGRESS" >&2
  exit 1
fi

# Swap labels first, then post claim comment with the comment id we know.
add_labels    "$ISSUE_NUM" "$IN_PROGRESS" "agent:claimed"
remove_labels "$ISSUE_NUM" "$READY"

STALE_S="$(sdlc_heartbeat_stale)"
IFS= read -r -d '' CLAIM_BODY <<EOF || true
<!-- claim-v1 worker:$WORKER_ID -->
🤖 **Claimed by** \`$WORKER_ID\`

| Field | Value |
|---|---|
| Claimed at | \`$NOW\` |
| Last heartbeat | \`$NOW\` |
| Branch | \`$BRANCH\` |
| Worktree | \`$WORKTREE\` |
| PR | _pending_ |

_Heartbeat extends the lease. If this comment isn't updated within ${STALE_S}s, the reaper will release the issue back to \`$READY\`._
EOF

COMMENT_ID="$(post_comment "$ISSUE_NUM" "$CLAIM_BODY")" || { echo "FATAL: could not post claim comment" >&2; exit 3; }

# Race check: a concurrent claim is one whose comment was created within the
# last RACE_WINDOW seconds and is older than ours. Old claim residue from
# previous release/reap cycles is ignored.
RACE_WINDOW=120
NOW_EPOCH="$(epoch_now)"
RACE_LOSER="$(gh api "repos/$(sdlc_repo)/issues/${ISSUE_NUM}/comments" --paginate \
  | jq -r --arg mine "$COMMENT_ID" --arg now "$NOW_EPOCH" --arg window "$RACE_WINDOW" '
      [.[] | select(.body | startswith("<!-- claim-v1 worker:")) | {id, created_at}]
      | map(. + {epoch: (.created_at | fromdate)})
      | map(select(($now|tonumber) - .epoch < ($window|tonumber)))
      | sort_by(.epoch)
      | (.[0].id // empty) as $earliest
      | if ($earliest|tostring) != "" and ($earliest|tostring) != $mine then "true" else "false" end
    ')"

if [[ "$RACE_LOSER" == "true" ]]; then
  gh api -X DELETE "repos/$(sdlc_repo)/issues/comments/${COMMENT_ID}" >/dev/null 2>&1 || true
  # Hand the issue back so the winner's label state is authoritative.
  add_labels    "$ISSUE_NUM" "$READY" 2>/dev/null || true
  remove_labels "$ISSUE_NUM" "$IN_PROGRESS" "agent:claimed" 2>/dev/null || true
  echo "RACE-LOST: another worker claimed first within ${RACE_WINDOW}s" >&2
  exit 1
fi

# Persist local state.
STATE_FILE="$SDLC_STATE_DIR/claim-${ISSUE_NUM}.json"
jq -n \
  --arg n   "$ISSUE_NUM" \
  --arg w   "$WORKER_ID" \
  --arg s   "$SLUG" \
  --arg b   "$BRANCH" \
  --arg wt  "$WORKTREE" \
  --arg cid "$COMMENT_ID" \
  --arg ts  "$NOW" \
  '{issue_number: ($n|tonumber), worker_id: $w, slug: $s, branch: $b, worktree: $wt, claim_comment_id: ($cid|tonumber), claimed_at: $ts, last_heartbeat: $ts}' \
  > "$STATE_FILE"

cat "$STATE_FILE"
