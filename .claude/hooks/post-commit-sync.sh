#!/bin/bash
# PostToolUse(Bash) hook: after any `git commit`, run the context-sync drift check.
INPUT=$(cat)
if echo "$INPUT" | grep -q '"command"' && echo "$INPUT" | grep -q 'git commit'; then
  node "$CLAUDE_PROJECT_DIR/.claude/hooks/context-sync-check.mjs"
fi
exit 0
