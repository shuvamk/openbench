# Open Questions

> Unresolved questions with an owner (agent role) and issue link. When resolved,
> move the resolution to `decisions.md` (ADR) and delete the row here.

| # | Question | Owner | Issue | Raised |
| --- | --- | --- | --- | --- |
| Q1 | KiCad symbol-library mapping: which KiCad lib symbols map to registry component IDs for import of arbitrary user schematics (beyond the Phase-1 curated set)? Also bounds the agent-control surface — `add_instance`/`list_registry` are registry-scoped, so KiCad-sourced parts enter via `mcp-kicad import`, not the agent server, until this is resolved (ADR-0019, `agent-control-surface.md`). | engine-integrator | TBD | 2026-07-02 |

Resolved → ADR: storage of binary waveforms (ADR-0007), Phase-1 persistence (ADR-0008), ESP32 emulation engine QEMU-not-Renode (ADR-0011, was Q2), firmware↔circuit GPIO bridge design (ADR-0018, was Q3 — see `firmware-in-the-loop.md`; the agent surface's `run_simulation` gains this co-sim by widening its `mode`/`engine` enum, ADR-0019).
