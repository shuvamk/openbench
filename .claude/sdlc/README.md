# SDLC pipeline state

GitHub-Issues-backed job queue with a heartbeat-leased lock, so multiple
concurrent agents can pull from the same queue without grabbing the same
issue. This is the coordination layer that makes **parallel work** safe;
each worker runs inside its own git worktree (see
`.claude/hooks/worktree-workflow.sh`).

It layers on top of openbench's existing label taxonomy (`.github/LABELS.md`)
and pipeline (`planner → tdd-implementer → reviewer → auto-merge → deploy`).
The scripts only ever move issues through the documented status labels —
they don't invent new ones.

## Files

- `config.json` — repo, heartbeat thresholds, allowed enum values, status-label
  names. Checked in.
- `state/claim-<issue-number>.json` — per-claim metadata for the current
  worker (issue number, comment id, branch, worktree, slug). **gitignored.**
- `state/last-pick.json` — last picked issue (for debugging). gitignored.
- `known-failing-tests.json` — tests known-red on `origin/main`, so a worker
  doesn't burn tool calls re-diagnosing a pre-existing failure.
- `../scripts/sdlc/ensure-workspace-deps.sh <worktree>` — deps preflight. A
  fresh worktree whose `node_modules` is symlinked from the main checkout goes
  stale the moment a new `@openbench/*` workspace package lands, so its imports
  fail to resolve and a green change looks red (issue #113; the concrete case
  was #93). Run it before tests / before diagnosing any "cannot find module
  @openbench/*" failure — it `npm install`s only when a workspace package is
  missing and is a fast no-op otherwise. Covered by
  `ensure-workspace-deps.test.sh` (npm stubbed on PATH).

## How the pipeline works

```
planner / file-issue      file-issue.sh              GitHub
   finds/specs X    →    (dedupe + fingerprint)  →  opens issue:
                                                     labels: status:ready, p1, area:*, type:*, agent:planned

worker                    pick-issue
   /pick-issue      →    pick-issue.sh           →  claims top ready issue:
                          1. reap stale             labels swap: ready → in-progress (+ agent:claimed)
                          2. list status:ready      posts sticky claim comment with heartbeat
                          3. claim top by priority   worker creates worktree off origin/main, branch

worker                    heartbeat
   (during work)    →    heartbeat.sh            →  edits sticky claim comment:
                                                     bumps last_heartbeat timestamp

worker                    complete-issue
   (PR open)        →    complete-issue.sh       →  posts PR link, swap in-progress → needs-review
                                                     issue auto-closes on merge via "Fixes #N"

reaper                    reap-stale
   /reap-stale      →    reap-stale.sh           →  scans status:in-progress
                                                     if last_heartbeat > 1800s old:
                                                       swap back to status:ready, drop agent:claimed
                                                       post reclaim comment
```

Merges land on `main` through the **reviewer gate + `test` CI + auto-merge**,
never a local merge and never a direct push. `complete-issue.sh` hands the
issue to `status:needs-review`; the merge closes it.

## Lease semantics

- A claim is a label swap (`status:ready` → `status:in-progress`) plus a
  sticky comment marked `<!-- claim-v1 worker:<slug> -->`.
- The sticky comment carries `Last heartbeat: <ISO8601>`. Workers edit it in
  place, so the reaper has one source of truth.
- Lease duration is bounded by `heartbeat_stale_after_seconds` (default
  30 min). After that the reaper (or the next `pick-issue`) takes it back.
- This is the fast lane; `.github/workflows/issue-hygiene.yml` is the slow
  (36h) backstop reaper documented in `.github/LABELS.md`.

## Bootstrap

Run once per fresh repo (idempotent — safe to re-run; reconciles colors and
descriptions with `.github/LABELS.md`):

```bash
.claude/scripts/sdlc/bootstrap-labels.sh
```

## Race conditions

GitHub has no atomic compare-and-swap on labels. Two workers can race on the
same issue. Mitigation: `claim-issue.sh` re-fetches the issue's claim comments
after posting its own and bails if an *earlier* claim comment exists within a
120s race window. The earliest-comment owner wins; the loser deletes its
comment and hands the labels back to `status:ready`.

## Running the scripts

Always invoke from the **main checkout** (via absolute path or after `cd` to
the repo root). The `.claude/` directory isn't tracked on feature branches, so
running these from inside a worktree fails with "no such file or directory".
