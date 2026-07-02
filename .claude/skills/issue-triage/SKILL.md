---
name: issue-triage
description: Reads open GitHub issues, applies/corrects the label taxonomy, flags stale or blocked ones, proposes status transitions. Use when the queue looks unhealthy or before planning a new milestone.
---

# issue-triage

The queue IS the coordination mechanism — a mislabeled issue is an agent deadlock.

## Procedure

1. `gh issue list --state open --json number,title,labels,updatedAt,assignees --limit 200`
2. For each issue verify exactly one `type:*`, one `area:*`, one `status:*`, one `p0|p1|p2`
   (taxonomy: `.github/LABELS.md`). Fix wrong/missing labels directly (`gh issue edit
   --add-label/--remove-label`) and comment one line explaining the correction.
3. Staleness:
   - `status:in-progress` idle >36h → reap to `status:ready`, remove `agent:claimed`,
     un-assign, comment. (Nightly CI does this too — you're the manual pass.)
   - `status:blocked` → check the blocking issue; if closed, flip to `status:ready`.
   - `status:needs-review` with no open PR → back to `status:in-progress` or `ready`.
4. `status:needs-design` audit: this label is ONLY for genuinely irreversible forks.
   If the question is answerable by a reasonable autonomous call, answer it: make the
   call, log an ADR in `.context/decisions.md`, flip to `status:ready` with a comment.
5. Duplicates → close the newer with a link. Vague issues (no test-shaped acceptance
   criteria) → label `agent:planned` removed, comment what the planner must add.
6. Report: one summary comment or output listing every transition made.
