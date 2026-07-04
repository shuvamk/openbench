#!/usr/bin/env bash
# File one finding/task as a GitHub issue in the SDLC queue (status:ready).
#
# Usage:
#   file-issue.sh \
#     --title       "ERC misses floating output pins" \
#     --priority    p1 \
#     --area        agent-ops \
#     --type        bug \
#     --evidence    "packages/erc/src/rules.ts:42 — no check for driver count" \
#     --evidence    "test/erc.test.ts:88 — case not covered" \
#     --impact      "Floating outputs pass ERC silently; user ships a broken schematic" \
#     --suggestion  "Add a driver-count rule; 0 drivers on an OUTPUT net is a violation" \
#     --verification "New failing test in erc.test.ts goes green" \
#     --source      "manual"        # optional free-text provenance tag (dedupe key)
#
# Output (stdout): the issue URL on success.
#                   "DUPLICATE: <existing-url>" if a matching open issue exists.
# Exit codes: 0 created or duplicate, 2 misuse, 3 gh failure.

source "$(dirname "$0")/_lib.sh"
require_gh; require_jq

TITLE=""; PRIORITY=""; AREA=""; TYPE=""; SOURCE="manual"
IMPACT=""; SUGGESTION=""; VERIFICATION=""
EVIDENCE=()

die() { echo "ERROR: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)         TITLE="$2"; shift 2;;
    --priority)      PRIORITY="$2"; shift 2;;
    --area)          AREA="$2"; shift 2;;
    --type)          TYPE="$2"; shift 2;;
    --source)        SOURCE="$2"; shift 2;;
    --evidence)      EVIDENCE+=("$2"); shift 2;;
    --impact)        IMPACT="$2"; shift 2;;
    --suggestion)    SUGGESTION="$2"; shift 2;;
    --verification)  VERIFICATION="$2"; shift 2;;
    *) die "unknown flag: $1";;
  esac
done

[[ -n "$TITLE"    ]] || die "--title required"
[[ -n "$PRIORITY" ]] || die "--priority required (p0|p1|p2)"
[[ -n "$AREA"     ]] || die "--area required (see .claude/sdlc/config.json)"
[[ -n "$TYPE"     ]] || die "--type required (see .claude/sdlc/config.json)"
[[ ${#EVIDENCE[@]} -gt 0 ]] || die "at least one --evidence required"

# Validate against config
if ! sdlc_priorities | grep -Fxq "$PRIORITY"; then die "invalid priority: $PRIORITY (want one of: $(sdlc_priorities | tr '\n' ' '))"; fi
if ! sdlc_areas      | grep -Fxq "$AREA";     then die "invalid area: $AREA (want one of: $(sdlc_areas | tr '\n' ' '))"; fi
if ! sdlc_types      | grep -Fxq "$TYPE";     then die "invalid type: $TYPE (want one of: $(sdlc_types | tr '\n' ' '))"; fi

FP="$(sdlc_fingerprint "$SOURCE" "$TITLE" "${EVIDENCE[@]}")"

# --- dedup check ---
EXISTING="$(gh issue list $(gh_repo_flag) --state open --search "fingerprint:$FP in:body" \
              --json number,url,title --limit 5 \
              | jq -r '.[0] // empty | .url // empty')"
if [[ -n "$EXISTING" ]]; then
  EXISTING_NUM="$(gh issue list $(gh_repo_flag) --state open --search "fingerprint:$FP in:body" --json number --limit 1 --jq '.[0].number')"
  if [[ -n "$EXISTING_NUM" ]]; then
    post_comment "$EXISTING_NUM" "🔁 Re-detected via \`$SOURCE\` on $(iso_now). Still present." >/dev/null
  fi
  echo "DUPLICATE: $EXISTING"
  exit 0
fi

# --- compose body ---
EVIDENCE_BLOCK=""
for e in "${EVIDENCE[@]}"; do
  EVIDENCE_BLOCK+="- $e"$'\n'
done

FILED_AT="$(iso_now)"
IMPACT_TXT="${IMPACT:-_(impact not provided — investigate before fixing)_}"
SUGGEST_TXT="${SUGGESTION:-_(no suggestion — diagnose first)_}"
VERIFY_TXT="${VERIFICATION:-_Acceptance criteria not provided — restate them as a failing test before implementing (TDD contract)._}"
PICK_HINT="/pick-issue --area $AREA"

IFS= read -r -d '' BODY <<EOF || true
<!-- audit-issue v1 -->
<!-- fingerprint:$FP -->

**Source:** \`$SOURCE\` · **Priority:** \`$PRIORITY\` · **Area:** \`$AREA\` · **Type:** \`$TYPE\`

## Summary

$TITLE

## Evidence

$EVIDENCE_BLOCK
## Why this matters

$IMPACT_TXT

## Suggested approach

$SUGGEST_TXT

## Acceptance criteria / verification

$VERIFY_TXT

---

_Filed via \`$SOURCE\` at $FILED_AT. To work on this: \`$PICK_HINT\`. To release after claiming without finishing: \`/release-issue <number>\`._
<!-- /audit-issue v1 -->
EOF

# --- create issue ---
# Priority label is BARE in openbench (p1, not priority:P1). Status/area/type prefixed.
LABELS="$(sdlc_status_ready),${PRIORITY},area:${AREA},type:${TYPE},agent:planned"

URL="$(gh issue create $(gh_repo_flag) \
        --title "$TITLE" \
        --body "$BODY" \
        --label "$LABELS" 2>&1)" || {
  echo "$URL" >&2
  exit 3
}

echo "$URL"
