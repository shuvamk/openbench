# Open Questions

> Unresolved questions with an owner (agent role) and issue link. When resolved,
> move the resolution to `decisions.md` (ADR) and delete the row here.

| # | Question | Owner | Issue | Raised |
| --- | --- | --- | --- | --- |
| Q1 | KiCad symbol-library mapping: which KiCad lib symbols map to registry component IDs for import of arbitrary user schematics (beyond the Phase-1 curated set)? | engine-integrator | TBD | 2026-07-02 |
| Q2 | Renode ESP32 (Xtensa) support is limited upstream — Phase 1 virtual-flash may need QEMU (qemu-xtensa-esp32) as the emulation engine instead of Renode. Spike required before mcp-firmware flash lands. | engine-integrator | TBD | 2026-07-02 |
| Q3 | Digital/mixed-signal co-simulation (firmware GPIO ↔ analog nets): event-bridge design between the MCU emulator and ngspice. Out of Phase-1 scope but shapes the simulationRun IR (`engine` enum). | planner | TBD | 2026-07-02 |

Resolved → ADR: storage of binary waveforms (ADR-0007), Phase-1 persistence (ADR-0008).
