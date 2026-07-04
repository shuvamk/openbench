#!/usr/bin/env bash
# Sweep status:in-progress issues and reclaim any whose heartbeat is stale.
#
# Usage: reap-stale.sh [--dry-run]
#
# An issue is stale when:
#   - its labels include status:in-progress
#   - its latest claim-v1 comment's "Last heartbeat: <ISO>" is older than
#     heartbeat_stale_after_seconds (config.json, default 1800).
#
# On reap: swap status:in-progress → status:ready, drop agent:claimed,
# post a reclaim comment. Exit code 0 always. One line per reaped/skipped issue.
#
# This is the in-session complement to .github/workflows/issue-hygiene.yml,
# which reaps on a slower (36h) cron. This one enforces the 30-min heartbeat
# lease so concurrent workers free each other's dropped claims fast.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

READY="$(sdlc_status_ready)"
IN_PROGRESS="$(sdlc_status_in_progress)"
THRESHOLD="$(sdlc_heartbeat_stale)"
NOW_EPOCH="$(epoch_now)"

IN_PROGRESS_LIST="$(gh issue list $(gh_repo_flag) \
  --state open \
  --label "$IN_PROGRESS" \
  --limit 100 \
  --json number,title)"

COUNT="$(echo "$IN_PROGRESS_LIST" | jq 'length')"
echo "reap: $COUNT in-progress issue(s); threshold=${THRESHOLD}s"
[[ "$COUNT" -eq 0 ]] && exit 0

echo "$IN_PROGRESS_LIST" | jq -r '.[] | [.number,.title] | @tsv' | while IFS=$'\t' read -r NUM TITLE; do
  CLAIM_BODY="$(gh api "repos/$(sdlc_repo)/issues/${NUM}/comments" --paginate \
    | jq -r '[.[] | select(.body | startswith("<!-- claim-v1 worker:"))] | last | .body // empty')"

  if [[ -z "$CLAIM_BODY" ]]; then
    echo "  #$NUM: no claim comment found — releasing as orphaned"
    if [[ $DRY -eq 0 ]]; then
      remove_labels "$NUM" "$IN_PROGRESS" "agent:claimed"
      add_labels    "$NUM" "$READY"
      post_comment  "$NUM" "♻️ Reclaimed: \`$IN_PROGRESS\` was applied without a tracked claim comment. Returned to \`$READY\` at $(iso_now)." >/dev/null
    fi
    continue
  fi

  HB_ISO="$(echo "$CLAIM_BODY" | sed -nE 's/.*Last heartbeat \| `([^`]+)`.*/\1/p' | head -1)"
  if [[ -z "$HB_ISO" ]]; then
    echo "  #$NUM: claim comment missing heartbeat — skipping"
    continue
  fi

  HB_EPOCH="$(iso_to_epoch "$HB_ISO" 2>/dev/null || echo 0)"
  AGE=$(( NOW_EPOCH - HB_EPOCH ))

  if [[ $AGE -ge $THRESHOLD ]]; then
    echo "  #$NUM: STALE (heartbeat ${AGE}s old, threshold ${THRESHOLD}s) — reaping"
    if [[ $DRY -eq 0 ]]; then
      delete_all_claim_comments "$NUM"
      remove_labels "$NUM" "$IN_PROGRESS" "agent:claimed"
      add_labels    "$NUM" "$READY"
      post_comment  "$NUM" "♻️ **Reclaimed** by reaper at $(iso_now). Heartbeat was ${AGE}s old (threshold ${THRESHOLD}s). Returned to \`$READY\`." >/dev/null
      rm -f "$SDLC_STATE_DIR/claim-${NUM}.json"
    fi
  else
    echo "  #$NUM: alive (heartbeat ${AGE}s old)"
  fi
done

exit 0
