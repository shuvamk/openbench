# Agent Roles & Handoffs

> Who does what, and the exact handoff points. The default pipeline for every feature:
> `planner → tdd-implementer → reviewer → auto-merge → deploy → deploy-sanity`,
> driven entirely by issue status transitions (see `.github/LABELS.md`).

## planner
- **Input:** a feature/milestone description (from the roadmap or a `type:spike` result).
- **Does:** decomposes into GitHub issues with correct Type/Area/Status/Priority labels,
  explicit dependency ordering ("blocked by #N" in body + `status:blocked`), and
  acceptance criteria written **as test cases** (Given/When/Then or literal test
  signatures), not prose.
- **Output/handoff:** issues labeled `status:ready` + `agent:planned`. Never writes code.

## tdd-implementer
- **Input:** exactly one issue labeled `status:ready` (highest priority first).
- **Does:** flips to `status:in-progress` + `agent:claimed`; branches
  `feat/<issue>-<slug>`; writes the failing test from the issue's acceptance criteria;
  runs it, confirms it fails for the right reason; commits red (`test:`); implements
  minimal green (`feat:/fix:`); refactors; updates `.context/` if architecture/engine
  status changed.
- **Output/handoff:** PR with `Fixes #<n>`, issue flipped to `status:needs-review`.
  One issue per PR, one PR per issue.

## engine-integrator
- A specialized tdd-implementer for `area:mcp-*` issues: wraps a single external engine
  behind an MCP server + the IR. Must ship the round-trip contract test and update
  `.context/engine-status.md` (CI-enforced). Uses the `engine-adapter-scaffold` skill.

## reviewer — the sole merge gate
- **Input:** every open PR.
- **Does:** adversarial review — untested changed paths, TDD contract violations (source
  diff without test diff), IR schema violations/undocumented breaking changes, stale
  `.context/` entries, deploy risk (build breaks, runtime deps on unavailable services).
  Implemented as the `reviewer-agent` required status check
  (`.github/scripts/reviewer-check.mjs`; ADR-0003). Strict by design — no human backstops it.
- **Output/handoff:** green `reviewer-agent` check → auto-merge merges; red check with
  a PR comment stating exactly what failed → back to tdd-implementer.

## registry-curator
- **Input:** community component/board submissions (`area:registry` issues).
- **Does:** validates against the component IR schema, runs the sim model sandboxed
  (smoke sim via mcp-sim), checks footprint refs, then admits to the registry.
- **Output:** merged registry entry or a rejection comment with structured errors.

## Coordination rules
- An agent never works an issue that isn't `status:ready`.
- Status flips are the locking mechanism; `agent:claimed` + assignee prevents
  double-claiming. Stale `status:in-progress` (>36h) is reaped by `issue-hygiene.yml`.
- Every agent reads `.context/` before acting and updates it after acting
  (`context-sync` skill); a `.context/` update is part of "done".
