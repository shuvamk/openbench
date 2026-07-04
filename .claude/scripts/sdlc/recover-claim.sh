#!/usr/bin/env bash
# Rebuild local claim state from the sticky claim-v1 comment on a GitHub
# issue. Use after an orphan-merge — when the PR landed but the local
# claim-<num>.json file is gone (machine restart, manual cleanup, race).
#
# Usage: recover-claim.sh <issue-number>
#
# Reads the latest <!-- claim-v1 worker:... --> comment on the issue,
# parses Branch / Worktree / Claimed-at out of the comment body, and
# writes a fresh state file at .claude/sdlc/state/claim-<num>.json so
# heartbeat.sh / complete-issue.sh can run normally.
#
# Exits 0 on success, 1 if no claim sticky exists.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

ISSUE_NUM="${1:-}"
[[ -n "$ISSUE_NUM" ]] || { echo "Usage: recover-claim.sh <issue-number>" >&2; exit 2; }

COMMENT_ID="$(find_comment_by_marker "$ISSUE_NUM" "<!-- claim-v1 worker:")"
if [[ -z "$COMMENT_ID" ]]; then
  echo "ERROR: no claim-v1 sticky comment on issue #$ISSUE_NUM — nothing to recover" >&2
  exit 1
fi

BODY="$(gh api "repos/$(sdlc_repo)/issues/comments/${COMMENT_ID}" --jq '.body')"

WORKER_ID="$(echo "$BODY" | grep -oE 'worker:[^ >]+' | head -1 | sed 's/worker://')"
BRANCH="$(echo    "$BODY" | grep -E '\| Branch \|'        | sed -E 's/.*\`([^`]+)\`.*/\1/')"
WORKTREE="$(echo  "$BODY" | grep -E '\| Worktree \|'      | sed -E 's/.*\`([^`]+)\`.*/\1/')"
CLAIMED_AT="$(echo "$BODY" | grep -E '\| Claimed at \|'   | sed -E 's/.*\`([^`]+)\`.*/\1/')"

[[ -n "$WORKER_ID" ]] || WORKER_ID="recovered"
[[ -n "$BRANCH"    ]] || BRANCH="unknown"
[[ -n "$WORKTREE"  ]] || WORKTREE="unknown"
[[ -n "$CLAIMED_AT" ]] || CLAIMED_AT="$(iso_now)"

STATE_FILE="$SDLC_STATE_DIR/claim-${ISSUE_NUM}.json"
jq -n \
  --arg num   "$ISSUE_NUM" \
  --arg w     "$WORKER_ID" \
  --arg b     "$BRANCH" \
  --arg wt    "$WORKTREE" \
  --arg c     "$CLAIMED_AT" \
  --arg cid   "$COMMENT_ID" \
  --arg now   "$(iso_now)" \
  '{
     issue_number: ($num|tonumber),
     worker_id: $w,
     branch: $b,
     worktree: $wt,
     claimed_at: $c,
     last_heartbeat: $now,
     claim_comment_id: ($cid|tonumber),
     recovered: true
   }' > "$STATE_FILE"

echo "recovered claim state for #$ISSUE_NUM → $STATE_FILE"
