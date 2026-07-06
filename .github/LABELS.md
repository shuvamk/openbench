# Issue Label Taxonomy

Every issue carries **exactly one** label from each of Type, Area, and Status (plus a
Priority and optional Agent labels). Status transitions are the coordination mechanism
for the autonomous pipeline — see `.context/agent-roles.md`.

## Type

| Label | Meaning |
| --- | --- |
| `type:feature` | New user-facing or engine capability |
| `type:bug` | Something broken vs. documented behavior |
| `type:test` | Test-only work (coverage, harnesses, contract tests) |
| `type:refactor` | Behavior-preserving restructure |
| `type:spike` | Time-boxed research; output is a written finding, not code |
| `type:infra` | CI/CD, hooks, repo tooling, deploy |
| `type:docs` | Documentation |

## Area

| Label | Meaning |
| --- | --- |
| `area:ir-schema` | `packages/ir-schema` — the canonical IR |
| `area:mcp-kicad` | KiCad adapter |
| `area:mcp-sim` | Simulation adapters (ngspice/renode/qemu) |
| `area:mcp-firmware` | Firmware adapter (PlatformIO) |
| `area:registry` | Component/board registry |
| `area:frontend` | `apps/web` UI |
| `area:ai` | AI product surface — `packages/mcp-openbench` agent tools + the in-app copilot |
| `area:collab-engine` | Multiplayer/CRDT (Phase 2 — should stay empty for now) |
| `area:agent-ops` | Agent pipeline, skills, hooks, CI |
| `area:desktop` | Electron shell + `apps/desktop-backend` (ADR-0024 desktop pivot) |

## Status (the state machine)

| Label | Meaning | Who sets it |
| --- | --- | --- |
| `status:needs-design` | Blocked on a genuinely irreversible decision — rare by design | any agent |
| `status:blocked` | Blocked on another issue (link it in the body) | planner |
| `status:ready` | Fully specified, acceptance criteria as tests, claimable | planner |
| `status:in-progress` | Claimed; exactly one agent working it | tdd-implementer |
| `status:needs-tdd-red` | Implementation exists without a failing-test-first history — must be fixed before review | reviewer |
| `status:needs-review` | PR open, awaiting reviewer gate | tdd-implementer |

Transitions: `blocked → ready → in-progress → needs-review → (closed by merge)`.
`needs-tdd-red` and `needs-design` are exception states.

**Rules**
- An agent never works an issue that isn't `status:ready`.
- Always flip to `status:needs-review` before opening the PR.
- Stale `status:in-progress` (>36h without activity) is reaped back to `status:ready`
  by `issue-hygiene.yml`.

## Priority

| Label | Meaning |
| --- | --- |
| `p0` | Production broken / pipeline blocked — drop everything |
| `p1` | Current milestone |
| `p2` | Nice to have / later |

## Agent

| Label | Meaning |
| --- | --- |
| `agent:planned` | Created by the planner agent |
| `agent:claimed` | An agent is actively working it |
| `agent:done` | Agent work complete (set on close) |
