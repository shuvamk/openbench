#!/usr/bin/env bash
# UserPromptSubmit hook: inject the mandatory worktree workflow into Claude's context.
# Stdin: JSON {session_id, user_prompt, ...} — we don't need to read it.
# Stdout: JSON with hookSpecificOutput.additionalContext appended to the model's prompt.
#
# This is the parallelism enabler: every code-modifying task runs in its own
# git worktree branched from origin/main, so multiple concurrent agents never
# collide in one working tree. openbench merges through PRs + the reviewer gate
# + auto-merge — NOT local merges to main — so this flow ends at "push + open PR".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WORKTREE_DIR="${REPO_ROOT}/.claude/worktrees"

# Detect current branch / worktree state at the moment the prompt is submitted.
CURRENT_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
EXISTING_WORKTREES="$(git -C "${REPO_ROOT}" worktree list 2>/dev/null | grep -F "${WORKTREE_DIR}/" | awk '{print $1}' | sed "s|${REPO_ROOT}/||" || true)"

read -r -d '' INSTRUCTIONS <<EOF || true
=== MANDATORY WORKTREE WORKFLOW (openbench repo policy) ===

Every code-modifying task in this repo MUST run inside a git worktree branched
from origin/main, NOT in the main checkout. Pure-question / read-only prompts skip this.

Repo state at prompt time:
- repo root:           ${REPO_ROOT}
- main checkout HEAD:  ${CURRENT_BRANCH}
- existing worktrees:  ${EXISTING_WORKTREES:-(none)}

This composes with the two hard rules in CLAUDE.md:
- TDD contract: the failing test is committed FIRST (a \`test:\` commit), then the
  implementation (\`feat:\`/\`fix:\`). tdd-guard blocks source edits otherwise.
- main must always be deployable; every merge to main deploys to prod. You never
  push to main directly — the reviewer gate + auto-merge are the only merge path.

Workflow (follow in order):

1. CONTINUITY CHECK
   - If a previous turn in this session already created a worktree under
     .claude/worktrees/<slug>/ and the current request is a follow-up on the
     SAME task, keep using that worktree. Do NOT create a new one per message.
   - If this is a NEW task, go to step 2.

2. CREATE WORKTREE FROM origin/main
   - Pick a short kebab-case slug describing the task, e.g. "erc-floating-pin".
     If you claimed an SDLC issue, pick-issue.sh already gave you the slug/branch.
   - Refresh origin so the worktree starts from the deployable tip:
       git -C ${REPO_ROOT} fetch origin main
   - Create the worktree on a fresh branch off origin/main (NOT local main —
     local main may carry unpushed WIP you'd publish by accident):
       git -C ${REPO_ROOT} worktree add .claude/worktrees/<slug> -b <slug> origin/main
   - From this point, ALL Read/Edit/Write tool calls must use absolute paths
     under ${WORKTREE_DIR}/<slug>/, never under ${REPO_ROOT}/<file> directly.
   - All Bash commands that touch the working tree must be prefixed with
     "cd ${WORKTREE_DIR}/<slug> && ..." or use git -C explicitly.
   - NOTE: .claude/ (hooks, scripts, sdlc state) is NOT tracked on feature
     branches — it lives only in the main checkout. Run SDLC scripts
     (pick-issue.sh / heartbeat.sh / complete-issue.sh) from ${REPO_ROOT}
     via absolute paths, never from inside the worktree.

3. IMPLEMENT IN THE WORKTREE (red -> green -> refactor)
   - Write the failing test first, run it, confirm it fails for the right reason,
     commit it as \`test: ...\`. THEN implement and commit as \`feat:\`/\`fix:\`.
   - Make all requested changes inside the worktree only.
   - Update the relevant .context/ brain file if you changed architecture, an
     engine capability, or the IR (context-freshness.yml gates this in CI).

4. TEST THOROUGHLY (in the worktree, before opening a PR)
   Run the suites relevant to what you touched, from inside the worktree:
   - all workspaces:        cd ${WORKTREE_DIR}/<slug> && npm test
   - single package:        cd ${WORKTREE_DIR}/<slug> && npm run test -w packages/<name>
   - lint:                  cd ${WORKTREE_DIR}/<slug> && npm run lint
   - production build:      cd ${WORKTREE_DIR}/<slug> && npm run build
   Do NOT open a PR if any suite fails — fix it inside the worktree.
   (If node_modules is missing in a fresh worktree, run \`npm install\` at its root first.)

5. COMMIT + PUSH + OPEN PR (this is how work reaches main)
   - Use conventional-commit prefixes (feat:/fix:/test:/chore:/docs:/refactor:).
   - PR body MUST contain "Fixes #<issue-number>" so the issue auto-closes on merge.
   - Before opening the PR, if you claimed an SDLC issue, flip it to needs-review:
       (from ${REPO_ROOT}) .claude/scripts/sdlc/complete-issue.sh <num> <pr-url>
   - Steps:
       git -C ${WORKTREE_DIR}/<slug> add <explicit paths>   # never git add -A
       git -C ${WORKTREE_DIR}/<slug> commit -m "feat: <summary>"
       git -C ${WORKTREE_DIR}/<slug> push -u origin <slug>
       gh pr create --repo shuvamk/openbench --title "..." --body "...Fixes #<num>..."
   - Then STOP. The reviewer gate (reviewer-agent) + test CI + auto-merge land it
     on main automatically. Do NOT run \`git merge\` into main yourself.

6. CLEAN UP (only after the PR has merged)
   - git -C ${REPO_ROOT} worktree remove .claude/worktrees/<slug>
   - git -C ${REPO_ROOT} branch -D <slug>        # branch is squash-merged & gone on remote
   - If worktree remove complains about carried-forward dirty files that also
     show in ${REPO_ROOT}'s status (not your diff), --force is safe.

7. EXCEPTIONS — skip the worktree dance for:
   - Pure-question prompts ("how does X work", "what does this do").
   - Read-only investigation with no edits.
   - Updates to .claude/ config itself, .context/ docs, or other files where
     branching adds no value (use judgment; default is to use a worktree).
     For doc/.context edits via the exception, still branch off origin/main,
     not local main, so you don't publish the user's unpushed WIP.

DO NOT push to origin/main directly. DO NOT force-merge past failing required checks.
DO NOT skip tests because they're slow — that's the entire point of this flow.
EOF

# Emit JSON with additionalContext set to the instructions.
jq -n --arg ctx "$INSTRUCTIONS" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
