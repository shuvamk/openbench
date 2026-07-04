---
name: reap-stale
description: Sweep the SDLC queue for issues stuck in status:in-progress whose heartbeat has gone silent (default >30 min) and reclaim them back to status:ready so other workers can pick them up. Trigger when the user says "reap stale issues", "clean up the queue", "release stuck claims", "/reap-stale", or notices an issue claimed for too long. Safe to run on a cron via the schedule skill. This is the fast (30-min) complement to .github/workflows/issue-hygiene.yml's slower 36h reaper.
trigger: /reap-stale
---

# /reap-stale — Janitor for the SDLC pipeline

Sweep the GitHub issue queue and reclaim any abandoned `status:in-progress`
claim. An abandoned claim = a sticky claim comment whose `Last heartbeat` is
older than `heartbeat_stale_after_seconds` (default 1800s).

This is the safety net: if a worker agent crashes, runs out of context, or
quietly drops, its issue would otherwise be locked. The reaper releases it back
to `status:ready` so the queue keeps moving. It sits alongside
`.github/workflows/issue-hygiene.yml`, which reaps on a slower 36h cron — this
one enforces the 30-min heartbeat lease for tight parallel-agent turnaround.

`pick-issue.sh` already runs the reaper before every claim, so you rarely need
this manually. Use it when:
- You see an issue stuck `status:in-progress` for a while and want it freed now.
- You're cron'ing it via `/schedule` for proactive cleanup.
- You're debugging a stuck queue.

Run from the **main checkout** (absolute path or `cd` to repo root).

## Invocation

```bash
# Real run — actually reclaims stale issues:
.claude/scripts/sdlc/reap-stale.sh

# Dry run — reports what WOULD be reclaimed, changes nothing:
.claude/scripts/sdlc/reap-stale.sh --dry-run
```

Output, one line per in-progress issue:
```
reap: 3 in-progress issue(s); threshold=1800s
  #42: alive (heartbeat 120s old)
  #43: STALE (heartbeat 2400s old, threshold 1800s) — reaping
  #44: no claim comment found — releasing as orphaned
```

## What it does on reap

- Deletes the stale `claim-v1` sticky comment(s).
- Swaps `status:in-progress` → `status:ready`, drops `agent:claimed`.
- Posts a `♻️ Reclaimed` comment noting the heartbeat age.
- Removes local `.claude/sdlc/state/claim-<num>.json`.

## Threshold

Set in `.claude/sdlc/config.json` under `heartbeat_stale_after_seconds`
(default 1800s = 30 min). Don't lower it below ~5 min — reaper false-positives
(stealing an issue from a live-but-slow worker) hurt worse than false-negatives.

Sibling skills: `/pick-issue`, `/file-issue`. Pipeline docs: `.claude/sdlc/README.md`.
