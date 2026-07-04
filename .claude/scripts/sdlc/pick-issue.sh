#!/usr/bin/env bash
# Pick the highest-priority ready issue, claim it, print the claim JSON.
#
# Usage: pick-issue.sh [--area <area>] [--type <type>] [--issue <num>]
#
# Behavior:
#  1. Run reap-stale.sh first (idempotent, fast).
#  2. If --issue <num> given, target that specific issue (must be status:ready).
#  3. Otherwise list open status:ready issues, sort by priority (p0..p2) then
#     createdAt ascending (older first), optionally filtered by --area / --type.
#  4. Generate slug from issue title, branch name, worker id.
#  5. Call claim-issue.sh.
#
# Output (stdout): the claim JSON from claim-issue.sh, plus a leading line:
#   PICKED: #<num> "<title>"
#
# Exit codes: 0 picked & claimed, 1 nothing ready, 2 misuse, 3 gh failure.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

AREA=""; TYPE=""; ISSUE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --area)  AREA="$2"; shift 2;;
    --type)  TYPE="$2"; shift 2;;
    --issue) ISSUE="$2"; shift 2;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done

READY="$(sdlc_status_ready)"

# Step 1 — reap first so a stale claim doesn't block this pick.
"$(dirname "$0")/reap-stale.sh" >/dev/null 2>&1 || true

# Step 2 — locate target issue.
TARGET_NUM=""; TARGET_TITLE=""

if [[ -n "$ISSUE" ]]; then
  if ! issue_has_label "$ISSUE" "$READY"; then
    echo "REFUSED: issue #$ISSUE is not $READY" >&2
    exit 1
  fi
  TARGET_NUM="$ISSUE"
  TARGET_TITLE="$(gh issue view "$ISSUE" $(gh_repo_flag) --json title --jq '.title')"
else
  LABEL_FILTER="$READY"
  [[ -n "$AREA"  ]] && LABEL_FILTER="$LABEL_FILTER,area:$AREA"
  [[ -n "$TYPE"  ]] && LABEL_FILTER="$LABEL_FILTER,type:$TYPE"

  CANDIDATES="$(gh issue list $(gh_repo_flag) \
    --state open \
    --label "$LABEL_FILTER" \
    --limit 100 \
    --json number,title,labels,createdAt)"

  # Priority labels are bare (p0/p1/p2); default missing → p2. Sort by
  # priority first (p0 wins), then oldest-first as a tiebreaker.
  SORT_EXPR='
    map({
      number,
      title,
      createdAt,
      prio: ([.labels[].name | select(. == "p0" or . == "p1" or . == "p2")][0] // "p2")
    })
    | sort_by(.prio, .createdAt)'

  TARGET_NUM="$(echo "$CANDIDATES"   | jq -r "$SORT_EXPR"' | .[0].number // empty')"
  TARGET_TITLE="$(echo "$CANDIDATES" | jq -r "$SORT_EXPR"' | .[0].title  // empty')"
fi

if [[ -z "$TARGET_NUM" ]]; then
  echo "EMPTY: no ready issues match filter (area=${AREA:-any} type=${TYPE:-any})" >&2
  exit 1
fi

# Step 3 — slug + branch.
TITLE_SLUG="$(kebab_slug "$TARGET_TITLE")"
[[ -z "$TITLE_SLUG" ]] && TITLE_SLUG="task"
SLUG="issue-${TARGET_NUM}-${TITLE_SLUG}"
SLUG="$(echo "$SLUG" | cut -c1-40 | sed -E 's/-+$//')"
BRANCH="$SLUG"
WORKTREE=".claude/worktrees/$SLUG"

echo "PICKED: #$TARGET_NUM \"$TARGET_TITLE\""

# Persist last pick (debug only).
jq -n --arg n "$TARGET_NUM" --arg t "$TARGET_TITLE" --arg s "$SLUG" --arg ts "$(iso_now)" \
   '{issue_number: ($n|tonumber), title: $t, slug: $s, picked_at: $ts}' \
   > "$SDLC_STATE_DIR/last-pick.json"

# Step 4 — claim.
"$(dirname "$0")/claim-issue.sh" "$TARGET_NUM" "$SLUG" "$BRANCH" "$WORKTREE"
