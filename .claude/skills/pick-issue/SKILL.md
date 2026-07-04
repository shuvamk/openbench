---
name: pick-issue
description: Claim the highest-priority status:ready GitHub issue from the SDLC queue (shuvamk/openbench), create a worktree off origin/main, fix it end-to-end TDD-first (failing test committed before implementation), open a PR, and hand it to the reviewer gate. Workers run this when the user says "pick a ticket", "grab an issue", "work on something from the queue", "/pick-issue", or "start the next item". Optionally filter by --area or --type. Honors the mandatory worktree workflow and the heartbeat-leased lock so multiple agents can pull from the queue in parallel without collisions.
trigger: /pick-issue
---

# /pick-issue — Worker side of the SDLC pipeline

Pull the top-priority open `status:ready` issue, claim it (heartbeat-leased
lock), fix it inside a worktree following the TDD contract, open a PR, and
hand it to the reviewer gate + auto-merge. **One issue per invocation.** For a
continuous worker, chain with `/loop`.

Run all SDLC scripts from the **main checkout** (absolute path or `cd` to repo
root first) — `.claude/` isn't tracked on feature branches.

## Hard rules

1. **Always claim through `pick-issue.sh`.** Never set `status:in-progress` by
   hand — that bypasses the race-window check and the sticky-comment heartbeat.
2. **Always work inside a worktree** branched from `origin/main` (see
   `.claude/hooks/worktree-workflow.sh`). The script hands you slug/branch/worktree.
3. **TDD is non-negotiable.** The failing test is committed FIRST (`test:`),
   then the implementation (`feat:`/`fix:`). tdd-guard enforces this locally;
   the reviewer gate re-checks the diff. An issue's acceptance criteria ARE the
   test.
4. **Heartbeat at every checkpoint** — after investigation, after the red test,
   after green, before the PR. If you don't, the reaper releases your issue
   after `heartbeat_stale_after_seconds` (default 1800s) and another agent can
   claim it mid-fix. For long phases, use the `ScheduleWakeup` tool to fire
   `heartbeat.sh <num>` every ~4 min — never spawn a detached `while true` loop.
5. **PR body must contain `Fixes #<num>`** so GitHub closes the issue on merge.
6. **Never push to `main` directly, never force-merge.** The reviewer gate +
   `test` CI + auto-merge are the only merge path.
7. **If you can't finish (blocked / ambiguous / scope creep), release.**
   `release-issue.sh <num>` returns it to the queue. Don't sit on a claim.

## Steps

Track each step with the task tools.

### 1 — Claim the top issue
```bash
.claude/scripts/sdlc/pick-issue.sh                 # top ready issue
.claude/scripts/sdlc/pick-issue.sh --area ir-schema
.claude/scripts/sdlc/pick-issue.sh --issue 42      # a specific number
```
Prints `PICKED: #<num> "<title>"` then the claim JSON (issue, slug, branch,
worktree). `EMPTY:` → nothing to do, stop. `RACE-LOST:` → re-run for the next one.

### 2 — Read the issue for scope
```bash
gh issue view <num> --repo shuvamk/openbench --json title,body,labels
```
Extract the **Evidence**, **Why this matters**, **Suggested approach**, and
**Acceptance criteria**. If too vague to act on:
```bash
.claude/scripts/sdlc/release-issue.sh <num> --blocked --reason "Need clarification on X"
```

### 3 — Create the worktree (repo policy)
```bash
git -C <repo-root> fetch origin main
git -C <repo-root> worktree add .claude/worktrees/<slug> -b <branch> origin/main
```
From here, all Read/Edit/Write use absolute paths under the worktree. If a fresh
worktree has no `node_modules`, run `npm install` at its root once.

### 4 — Heartbeat after investigation
```bash
cd <repo-root> && .claude/scripts/sdlc/heartbeat.sh <num>
```

### 5 — Red: write the failing test first
Translate the acceptance criteria into a `*.test.ts` next to the source (or
under `test/`). Run it, confirm it fails **for the right reason**, commit:
`git -C .claude/worktrees/<slug> commit -m "test: <criteria> (red)"`.

### 6 — Green: implement, then heartbeat + run suites
```bash
cd .claude/worktrees/<slug> && npm run test -w packages/<name>   # or: npm test
cd .claude/worktrees/<slug> && npm run lint && npm run build
cd <repo-root> && .claude/scripts/sdlc/heartbeat.sh <num>
```
No drive-by refactors. If the fix reveals broader scope, **file a follow-up**
via `/file-issue` rather than expanding silently. Update the relevant
`.context/` brain file if you touched architecture / the IR / an engine
capability (context-freshness.yml gates this).

Before re-diagnosing a red test, check `.claude/sdlc/known-failing-tests.json`
— if it's listed, it's pre-existing on `main`; note it in the PR and move on.

### 7 — Commit + push + open PR
```bash
git -C .claude/worktrees/<slug> add <explicit paths>     # never git add -A
git -C .claude/worktrees/<slug> commit -m "feat: <summary>"
git -C .claude/worktrees/<slug> push -u origin <branch>
gh pr create --repo shuvamk/openbench \
  --title "feat: <summary>" \
  --body "$(cat <<'EOF'
## Summary
- ...

Fixes #<num>.

## Test plan
- [ ] npm test green
- [ ] <acceptance criterion from the issue>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 8 — Mark in-review
```bash
.claude/scripts/sdlc/complete-issue.sh <num> <pr-url> --summary "<one line>"
```
Swaps `status:in-progress` → `status:needs-review`, links the PR, drops local
claim state. Then STOP — the reviewer gate + `test` CI + auto-merge land it on
main and the `Fixes #<num>` line auto-closes the issue. Do NOT `git merge` yourself.

### 9 — Clean up (only after the PR merges)
```bash
git -C <repo-root> worktree remove .claude/worktrees/<slug>
git -C <repo-root> branch -D <slug>
```

### 10 — Hand off (≤7 lines)
Issue #+title · PR URL · one-line fix summary · suites that passed · follow-ups
you filed · anything left for the reviewer/human.

## When you fail

| Situation | Action |
|---|---|
| Ambiguous / needs human input | `release-issue.sh <num> --blocked --reason "..."` |
| Tests fail and you can't fix them | `release-issue.sh <num> --reason "tests fail; need help with X"` |
| PR merge blocked (conflicts / failing checks) | `release-issue.sh <num> --reason "merge blocked; needs rebase"` |
| It's not actually a bug | comment, then `release-issue.sh <num> --reason "false positive"` + `gh issue close` |
| Crash / out of context mid-fix | do nothing; the reaper reclaims after 30 min of no heartbeat |
| Race-lost on claim | re-run `pick-issue.sh` |

## Orphan-merge recovery
If the PR merged but local claim state is gone:
```bash
.claude/scripts/sdlc/recover-claim.sh <num>
.claude/scripts/sdlc/complete-issue.sh <num> <pr-url> --summary "..."
```

## What NOT to do
- Don't manually edit issue labels — use the scripts.
- Don't claim multiple issues at once — one worker = one in-flight claim.
  Parallel work = parallel agents each calling `pick-issue.sh`.
- Don't push directly to `main`; don't force-merge past failing required checks.
- Don't `git add -A` in the worktree — add explicit paths only.
- Don't branch off local `main` — it may carry unpushed WIP. Use `origin/main`.

## Cross-reference
Sibling skills: `/file-issue` (file into the queue), `/reap-stale` (manual
reaper). Pipeline docs: `.claude/sdlc/README.md`. Labels: `.github/LABELS.md`.
