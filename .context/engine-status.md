# Engine Adapter Status

> One section per engine. States: **wired** (production-ready, contract tests green),
> **partial** (works for the documented subset), **stubbed** (interface + tests exist,
> engine not attached), **planned**. Lossy round-trip fields MUST be listed here.

| Engine | Package | Status | Backend |
| --- | --- | --- | --- |
| IR core | `packages/ir-schema` | partial — `component` kind wired | pure TS (zod) |
| Netlist compiler | `packages/netlist-compiler` | planned | pure TS |
| KiCad | `packages/mcp-kicad` | planned | `.kicad_sch` S-expression parser (pure TS), no kicad-cli dependency for Phase 1 |
| ngspice | `packages/mcp-sim-ngspice` | planned | WASM (`eecircuit-engine`) in-browser; native `ngspice` CLI optional |
| PlatformIO | `packages/mcp-firmware-platformio` | planned | local `pio` CLI; never runs on Vercel |
| Renode/QEMU | (inside mcp-firmware flash target) | planned | local CLI; Phase 1 targets virtual flash only |

## IR core (`packages/ir-schema`)

- Scope: all six IR kinds, validate(), version compat check, JSON Schema export.
- Wired: `component` kind (validateComponent — duplicate-pin + sim-template-reference checks), version compatibility (`isSupportedIrVersion`).
- Known gaps: `schematic`/`netlist`/`simulationRun`/`firmwareTarget`/`project` kinds pending (Phase 1); JSON Schema export pending.

## KiCad (`packages/mcp-kicad`)

- Scope (Phase 1): import/export of flat single-sheet schematics — symbols, pins, nets,
  values. No hierarchical sheets, no PCB.
- Documented lossy fields (export → import round-trip): symbol graphics/positions are
  preserved via `x-openbench` metadata; KiCad-side annotations not in the IR (e.g.
  custom fields we don't model) are dropped — list to be refined as the adapter lands.

## ngspice (`packages/mcp-sim-ngspice`)

- Scope (Phase 1): transient + operating-point analysis of netlist IR; waveform-v1
  results with inline samples (ADR-0007).
- Limits: in-browser WASM runs capped at ~1M samples/signal; longer runs need the
  native backend.

## PlatformIO (`packages/mcp-firmware-platformio`)

- Scope (Phase 1): esp32dev + arduino framework build; flash to virtual target
  (Renode machine config generation).
- Requires local `pio`; CI uses the PlatformIO GitHub action.

## Production-readiness checklist per adapter

- [ ] import/export/validate implemented
- [ ] round-trip contract test green (lossy fields documented above)
- [ ] failure modes return structured errors (never throw raw engine output)
- [ ] provenance stamped on every produced document
- [ ] entry in this file updated (status + gaps)
