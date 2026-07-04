---
name: file-issue
description: File a finding or task into the SDLC queue (shuvamk/openbench) as a GitHub issue labeled status:ready, with fingerprint-based dedupe so re-filing the same finding just bumps the existing issue. Trigger when the user says "file an issue", "open a ticket for this", "/file-issue", when a worker discovers out-of-scope work mid-fix and must file a follow-up instead of expanding scope, or when any audit/review surfaces something worth queuing. Not for planner-authored milestone breakdowns (that's the planner agent) — this is for ad-hoc, single findings.
trigger: /file-issue
---

# /file-issue — Queue a single finding

Wraps `.claude/scripts/sdlc/file-issue.sh`. Turns one finding into a
well-formed `status:ready` issue that `/pick-issue` can later claim.

Run from the **main checkout** (absolute path or `cd` to repo root).

## When to use it

- A worker (in `/pick-issue`) finds scope creep — file a follow-up, keep the
  current fix tight.
- A review/audit surfaces a concrete, actionable defect with file:line evidence.
- The user points at something and says "make a ticket."

Don't use it for vague "improve X" wishes — a filable issue needs evidence and
acceptance criteria a worker can turn into a failing test.

## Invocation

```bash
.claude/scripts/sdlc/file-issue.sh \
  --title       "ERC misses floating output pins" \
  --priority    p1 \
  --area        agent-ops \
  --type        bug \
  --evidence    "packages/erc/src/rules.ts:42 — no driver-count check" \
  --evidence    "test/erc.test.ts — case not covered" \
  --impact      "Floating outputs pass ERC silently; user ships a broken schematic" \
  --suggestion  "Add a driver-count rule; 0 drivers on an OUTPUT net is a violation" \
  --verification "New failing test in erc.test.ts goes green" \
  --source      "manual"
```

### Required flags
- `--title` — imperative, specific.
- `--priority` — `p0` | `p1` | `p2` (bare labels, per `.github/LABELS.md`).
- `--area` — one of: ir-schema, mcp-kicad, mcp-sim, mcp-firmware, registry,
  frontend, ai, collab-engine, agent-ops.
- `--type` — one of: feature, bug, test, refactor, spike, infra, docs.
- `--evidence` — repeatable; each is a `path/file:line — what's wrong` citation.

### Recommended flags
- `--impact` — why it matters (helps the worker sanity-check scope).
- `--suggestion` — a direction, not gospel.
- `--verification` — the acceptance criteria, phrased so a worker can write it
  as a failing test first. This is the most valuable field for the TDD contract.
- `--source` — free-text provenance tag (default `manual`); part of the dedupe
  fingerprint.

## Output

- On success: the new issue URL. Labels applied:
  `status:ready`, `<priority>`, `area:<area>`, `type:<type>`, `agent:planned`.
- `DUPLICATE: <url>` — an open issue with the same fingerprint already exists;
  the script posted a "re-detected" comment instead of filing a dupe. Not an error.

## Notes

- **Dedupe** is by a sha1 fingerprint of source + title + sorted evidence,
  embedded as `<!-- fingerprint:... -->` in the body and matched via GitHub
  search. Re-running the exact same call is safe.
- The issue lands as `status:ready` and is immediately claimable by `/pick-issue`.
- To file a follow-up from inside a worker run, still call this from the main
  checkout, capture the URL, and mention it in your PR / hand-off.

Sibling skills: `/pick-issue` (claim & work), `/reap-stale` (reaper).
Pipeline docs: `.claude/sdlc/README.md`.
