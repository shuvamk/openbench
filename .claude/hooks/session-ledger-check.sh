#!/usr/bin/env bash
# Stop hook: when a turn modified code (commits, merges, pushes, deploys,
# active worktrees), block the stop and inject a system reminder asking
# the agent to produce a session ledger before ending the turn.
#
# Idempotent per session: once the hook has injected for a given
# session_id, it never injects again for that session — the marker file
# at .claude/session-ledger-state/<session-id>.injected guards the loop.
# That means the agent gets exactly one nudge per session even across
# many Stop attempts.
#
# Fail-open: any error in the heuristics exits 0 silently, letting the
# agent stop. Better to miss a ledger than to wedge the session.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STATE_DIR="$REPO_ROOT/.claude/session-ledger-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

EVENT="$(cat 2>/dev/null || echo '{}')"
SESSION_ID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
[ -z "$SESSION_ID" ] && exit 0

MARKER="$STATE_DIR/$SESSION_ID.injected"
[ -f "$MARKER" ] && exit 0

# Heuristics — only nudge if the turn actually touched code.
TOUCHED=0
cd "$REPO_ROOT" || exit 0

# Recent commits (last 4 hours captures even long sessions).
if [ -n "$(git log --since='4 hours ago' --oneline 2>/dev/null)" ]; then
  TOUCHED=1
fi

# Active worktrees beyond the main checkout signal in-flight work.
# `git worktree list` always lists the main checkout as line 1, so
# anything past that means there's a feature worktree alive.
if [ "$(git worktree list 2>/dev/null | wc -l | tr -d ' ')" -gt 1 ]; then
  TOUCHED=1
fi

# Uncommitted tracked changes (rare in this repo since work flows
# through worktrees, but catches the case where someone edited main).
if [ -n "$(git diff --name-only 2>/dev/null)" ] || \
   [ -n "$(git diff --cached --name-only 2>/dev/null)" ]; then
  TOUCHED=1
fi

[ "$TOUCHED" -eq 0 ] && exit 0

# Mark injected BEFORE writing the decision so even a write race
# (multiple Stop attempts firing in parallel) can't re-inject.
touch "$MARKER" 2>/dev/null || exit 0

# Block the stop and inject the ledger reminder. Single-line JSON
# so any shell quoting issues are obvious if this ever breaks.
cat <<'JSON'
{"decision":"block","reason":"Session ledger check: this turn modified code, merged, pushed, deployed, or left a worktree open (per recent git activity). Before ending the turn, produce a concise session ledger covering: (a) what's committed and to which branches, (b) what's pushed to origin, (c) what PRs are open and their CI/reviewer-gate status, (d) what's deployed and to which environment + commit sha (Vercel prod), (e) which worktrees and branches still exist locally, (f) manual follow-ups that remain (issue label transitions, .context/ updates, deploy-sanity re-run, env-var changes), (g) anything explicitly NOT done that the user might assume was done. Keep it to a short table or bullet list. If the turn was investigation-only with no merges, deploys, or open worktrees, one sentence saying so is enough. After producing the ledger you may stop."}
JSON
exit 0
