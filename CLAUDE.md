# OpenBench — Agent Operating Manual

> Read this file completely before touching anything. Then read `.context/architecture.md`,
> `.context/interchange-format.md`, and `.context/engine-status.md` for the slice you are
> working on. `.context/` is the living brain of this repo: **read before acting, update
> after acting.**

## Mission

Open-source platform for embedded/electronics projects, distributed as a single
installable desktop app (macOS DMG, Windows installer): schematic → simulation →
firmware, orchestrating existing open engines (KiCad, ngspice, Renode/QEMU,
PlatformIO/Zephyr) behind one canonical interchange format (the IR), driven by AI agents
via MCP. The target user installs one file and every engine runs natively, offline, with
no setup step — see **ADR-0024** for the pivot from the earlier browser/Vercel-hosted
model.

**Non-goals:** re-implementing engines; treating any engine-native format as source of
truth; PCB layout/fab (deferred); multiplayer/CRDT collaboration (deferred to Phase 2 —
do not build early); maintaining the Vercel-hosted browser deploy as a first-class target
once the desktop pivot (ADR-0024, Phase 1.5) lands.

## Full-autonomy operating rule

This repo is built autonomously. **No human reviews PRs, approves merges, or answers
questions mid-build.** Therefore:

- **Never block waiting on a human.** For ambiguous decisions: make the most reasonable
  call, append the rationale to `.context/decisions.md` (ADR format), and keep moving.
- **The reviewer agent is the only merge gate** — a required status check, not a person.
- **Every merge to `main` deploys to production.** `main` must always be deployable.
  Never merge red. If production breaks, revert first, investigate second.
- Only genuinely irreversible forks (license change, deleting the IR, destructive data
  migration) justify stopping — file a `status:needs-design` issue explaining the fork.
  This should be rare, not a default.

## The TDD contract (hard rule)

**No source file under `apps/` or `packages/` is created or modified without a failing
test committed first, in the same or a preceding commit.**

- Red → green → refactor. Write the test, run it, confirm it fails *for the right
  reason*, then implement.
- The `tdd-cycle` skill (`.claude/skills/tdd-cycle/`) enforces this; the pre-tool-use
  hook (`.claude/hooks/tdd-guard.sh`) mechanically blocks source edits when no test
  file was touched more recently in the session.
- Pure config/docs/styles (`*.md`, `*.json`, `*.css`, config files) are exempt.
- CI re-checks: the reviewer gate fails PRs whose diffs add source without tests.

## How work is picked up

**GitHub issues only — never ad hoc.** The label taxonomy is documented in
`.github/LABELS.md`. Coordination is done through status transitions:

1. An agent only claims an issue labeled `status:ready` (flip to `status:in-progress`
   + `agent:claimed`).
2. Before opening a PR, flip to `status:needs-review`.
3. A PR merges when CI (`test`) and the reviewer gate (`reviewer-agent`) are green —
   automatically, via auto-merge. No human approval exists.
4. Merged → issue closes via `Fixes #<n>` → deploy → `deploy-sanity` verifies prod and
   appends `.context/deploy-log.md`.

Default pipeline for every feature:
`planner → tdd-implementer → reviewer → auto-merge → deploy → deploy-sanity`.
Agent roles and handoffs: `.context/agent-roles.md`.

## Parallel work: worktrees, the issue lease & the session ledger

Multiple agents run against this repo at once. Three mechanisms keep them from
colliding — all live under `.claude/` and are wired via `.claude/settings.json`:

1. **Mandatory worktree workflow** (`.claude/hooks/worktree-workflow.sh`,
   a `UserPromptSubmit` hook). Every code-modifying task runs in its own
   `.claude/worktrees/<slug>` branch off `origin/main` — never in the main
   checkout, never off local `main` (which may carry unpushed WIP). Work reaches
   `main` only through a PR + the reviewer gate + auto-merge; you never `git merge`
   or push to `main` directly. Read-only / pure-question / `.claude`- or
   `.context`-only prompts skip the dance.

2. **Heartbeat-leased issue queue** (`.claude/sdlc/` + `.claude/scripts/sdlc/`,
   surfaced by the `/pick-issue`, `/file-issue`, `/reap-stale` skills). Claiming a
   `status:ready` issue swaps it to `status:in-progress` and posts a sticky
   heartbeat comment; a stale claim (>30 min without a heartbeat) is reaped back to
   `status:ready` so a dropped worker never locks an issue. This is the fast lane
   over `.github/workflows/issue-hygiene.yml`'s 36h backstop. It uses the existing
   label taxonomy (`.github/LABELS.md`) — no new labels. Bootstrap once with
   `.claude/scripts/sdlc/bootstrap-labels.sh`. Run SDLC scripts from the main
   checkout (absolute path) — `.claude/` isn't tracked on feature branches.

3. **Session ledger** (`.claude/hooks/session-ledger-check.sh`, a `Stop` hook).
   When a turn touched code, it blocks the stop once per session and asks for a
   short ledger: what's committed / pushed / in review / deployed, which worktrees
   and branches remain, and what manual follow-ups are outstanding.

## Where things live

| Concern | Location |
| --- | --- |
| Architecture (current, canonical) | `.context/architecture.md` |
| Decision log (append-only ADRs) | `.context/decisions.md` |
| **Interchange format (the IR — most important file in the repo)** | `.context/interchange-format.md` |
| Engine adapter status + known gaps | `.context/engine-status.md` |
| Domain glossary | `.context/glossary.md` |
| Open questions | `.context/open-questions.md` |
| Deploy log (what the human reads) | `.context/deploy-log.md` |
| Agent roles | `.context/agent-roles.md` |
| Skills | `.claude/skills/` |
| Label taxonomy | `.github/LABELS.md` |
| Worktree / lease / ledger tooling | `.claude/hooks/`, `.claude/scripts/sdlc/`, `.claude/sdlc/README.md` |

A `.context/` update is part of "done" for any task that changes architecture, adds an
engine capability, or resolves an open question. CI (`context-freshness.yml`) fails if
product code changed without a matching `.context/` update.

## IR discipline

- The IR (`.context/interchange-format.md`, implemented in `packages/ir-schema`) is
  canonical. Engines talk to each other **only** through IR documents.
- Any IR change is a breaking-change candidate: run the `ir-schema-guard` skill, bump
  `irVersion` appropriately, update every adapter's contract tests.
- Every adapter implements `import`/`export`/`validate` and a round-trip contract test
  (`import(export(doc)) == doc` modulo documented lossy fields listed in
  `.context/engine-status.md`).

## Build/test commands

```bash
npm install                    # root, npm workspaces
npm test                       # all workspace tests (vitest)
npm run test -w packages/ir-schema   # single package
npm run dev                    # apps/web dev server
npm run build                  # production build (what Vercel runs)
npm run lint                   # eslint across workspaces
```

## Conventions

- TypeScript everywhere, strict mode. Vitest for tests (`*.test.ts` next to source or
  under `test/`).
- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`).
  The red commit is `test: ...`, the green commit `feat:/fix: ...`.
- UI is built **UX-first** on the Astryx design system (`@astryxdesign/core` +
  `@astryxdesign/theme-neutral`). No raw hex colors, no one-off components when an
  Astryx component exists. Direct-manipulation feel (Canva/Figma), keyboard-first,
  60fps canvas interactions.
- IDs: `cmp_`/`sch_`/`net_`/`sim_`/`fw_`/`proj_` prefixes per IR spec.
