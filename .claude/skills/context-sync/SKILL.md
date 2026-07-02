---
name: context-sync
description: End-of-session brain sync — diffs what changed against .context/ and applies the necessary updates. Run at the end of any session that touched product code, and after merges.
---

# context-sync

`.context/` is the living brain: read before acting, **updated after acting**. This
skill makes "updated" true.

## Procedure

1. Diff the session's work: `git diff --name-only main...HEAD` (plus uncommitted).
   Also run `node .claude/hooks/context-sync-check.mjs` for the mechanical hints.
2. Map changes → brain files:
   - New/changed package, dependency, API route, data flow → `architecture.md`
     (current-state prose + diagram; keep it *what is*, not history).
   - Engine adapter capability/gap/lossy field → `engine-status.md` (status table +
     per-engine section + checklist).
   - Any autonomous judgment call made this session → `decisions.md` as a new ADR
     (append-only, date, rationale, consequences).
   - IR shape changes → `interchange-format.md` (already required by ir-schema-guard).
   - New domain term used in code/issues → `glossary.md`.
   - Question raised but not answered → `open-questions.md` row (owner + issue).
     Question answered → move to `decisions.md`, delete the row.
   - Production deploy happened → `deploy-log.md` line (the deploy-sanity skill owns
     the format).
3. Apply the edits. Precision beats completeness — wrong brain is worse than sparse brain.
4. Commit as part of the feature branch (same PR), message `docs(context): sync <scope>`.
   Never a separate PR — CI's context-freshness check requires same-PR updates.
