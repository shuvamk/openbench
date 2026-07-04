# Engine Adapter Status

> One section per engine. States: **wired** (production-ready, contract tests green),
> **partial** (works for the documented subset), **stubbed** (interface + tests exist,
> engine not attached), **planned**. Lossy round-trip fields MUST be listed here.

| Engine | Package | Status | Backend |
| --- | --- | --- | --- |
| IR core | `packages/ir-schema` | **wired** — all six kinds | pure TS (zod) |
| Netlist compiler | `packages/netlist-compiler` | **wired** | pure TS |
| Registry | `packages/registry` | **wired** — 25 curated parts | pure TS data |
| KiCad | `packages/mcp-kicad` | **partial** — flat single-sheet subset | `.kicad_sch` S-expression parser (pure TS), no kicad-cli |
| ngspice | `packages/mcp-sim-ngspice` | **partial** — transient, WASM+mock backends | WASM (`eecircuit-engine`) in-browser; native CLI pending |
| PlatformIO | `packages/mcp-firmware-platformio` | **partial** — ini gen, backend seam, mock builds | local `pio` CLI (feature-detected); never runs on Vercel |
| QEMU (virtual flash) | (inside mcp-firmware) | **stubbed** — machine-config generation | qemu-system-xtensa launch stub (ADR-0011) |

## IR core (`packages/ir-schema`)

- Wired: all six kinds (`component`, `schematic`, `netlist`, `simulationRun`,
  `firmwareTarget`, `project`), `validateDocument` discriminated-union dispatcher,
  version compatibility, structured `{ path, message }` errors. 63 package tests.
- Additive fields (2026-07-02, patch-level): `component.simModel.modelCard` (SPICE
  `.model` line), `schematic.layout` (per-instance editor geometry, keys validated
  against declared instanceIds).
- Known gaps: JSON Schema export pending; no `migrate()` yet (nothing to migrate pre-0.2).

## Registry (`packages/registry`)

- Wired (issues #6, #17, #22; batch 3; ICs #44): 25 parts — passives, LED/RGB/diode/NPN, PULSE & DC sources,
  interactive parts (pushbutton, switch, potentiometer, LDR) via `derivedParams`, and
  electromechanical visuals (DC motor, buzzer, lamp). Batch 3 adds the fundamentals that
  were missing: `cmp_inductor_generic` (completes R/C/L → enables RL/RLC), `cmp_vsource_sin`
  (AC/audio transient stimulus, drives the live view; live kind `source`), `cmp_zener_diode`
  (BV=5.1 reverse clamp), `cmp_schottky_diode` (low-drop rectifier), `cmp_pnp_2n3906`
  (complements the 2N2222 NPN), and `cmp_nmos_2n7000` (N-channel MOSFET, bulk tied to source
  via `M{ref} d g s s MOSN`). All expand through the standard template path — no special
  compiler handling. First ICs (#44): `cmp_opamp_ideal` (VCVS `.subckt`, exercises the new
  subcircuit path — enables active filters/integrators; symbol kind `opamp`) and `cmp_tmp36`
  (temperature sensor, `Vout = 0.5 + 0.01·tempC` via `derivedParams`; labeled-box `ic` symbol).
  Op-amp SPICE physics is browser-WASM-verified (node MockBackend returns synthetic waveforms).
  Remaining #44 scope (NE555, 74xx logic, 7-seg) needs behavioral models verified in a browser
  session before shipping — deliberately not faked behind the synthetic MockBackend.
  Original core: `cmp_resistor_generic`, `cmp_capacitor_generic`, `cmp_led_generic`
  (DLED modelCard), `cmp_vsource_dc`, `cmp_ground` (no simModel — names the ground net;
  netlist compiler maps it to SPICE node 0), `cmp_esp32_devkit` (no simModel — emulated,
  not SPICE'd). API: `registryComponents`, `getComponent(id)`. All pass validateComponent.
- Gaps: static curated list (community submissions = Phase 2 registry-curator flow);
  no parameter min/max ranges; vsource/ground intentionally footprint-less.

## Netlist compiler (`packages/netlist-compiler`)

- Wired (issue #7): ground detection (GND/AGND/0 names case-insensitive, or
  `cmp_ground` connection) → node `"0"`; stable node numbering; template expansion with
  overrides-over-defaults; `.model` card dedup by content; instances without simModel
  skipped with warning. Collects ALL errors (no fail-fast). 17 tests.
- Subcircuits (issue #34): a component's `simModel.subckt` (`.subckt … .ends` block)
  emits one `X` device card per instance (from the `X{ref} <nodes> <name>` template)
  plus the definition block once, deduped by content like `modelCard`. Internal nodes
  stay local; only `{pin}` tokens map to outer nodes. Unblocks multi-terminal ICs (#44).
- Gaps: no digital co-sim bridging (open question Q3).

## KiCad (`packages/mcp-kicad`)

- Partial (issue #8): import/export/validate of flat single-sheet schematics, pure-TS
  S-expression parser/serializer. Lossless round-trip via `x_openbench_*` metadata
  (`x_openbench_schematic` header JSON, per-symbol `x_openbench_component`/`_params`/
  `_layout`, `x_openbench_nets` escape hatch). Heuristic import of foreign KiCad files
  (symbols→instances, global_label→nets, `(at …)`→layout) with warnings. Malformed
  input → structured errors, never throws. Round-trip contract test green.
- Documented lossy fields: (1) provenance regenerated on import; (2) foreign-file
  graphics (wires-as-drawn, junctions, frames) not modeled; (3) sheet hierarchy
  unsupported (Phase 1 scope); (4) symbol library definitions not embedded on export
  (symbols are reference-only).

## ngspice (`packages/mcp-sim-ngspice`)

- Partial (issue #9): `buildSpiceDeck` (transient, SPICE time-value validation),
  waveform-v1 inline base64 Float64 samples (ADR-0007), `SimBackend` seam with
  deterministic MockBackend (node-safe) and EECircuitBackend (WASM, dynamic import).
  `runSimulation` docs pass validateSimulationRun; failures → status `failed` with
  inline logs, never throws.
- Verified 2026-07-02: EECircuitBackend ran a real transient in a browser session (RC low-pass demo, deck `.tran 10us 10ms`, physically-correct DC steady-state waveforms, zero console errors). Gaps: native ngspice CLI backend not
  implemented; operating-point mode pending (transient only); remote sample URLs are
  pass-through (`decodeSamples` throws for http/s3).
- Limits: MockBackend 256 samples/signal; WASM ~1M samples/signal (ADR-0007 guard).

## PlatformIO (`packages/mcp-firmware-platformio`)

- Partial (issue #10): platformio.ini generation (esp32 family only), FirmwareBackend
  seam (MockBackend + feature-detecting PioCliBackend — absent `pio` →
  `engine-unavailable` structured failure, never throws), `buildFirmware` produces
  validateFirmwareTarget-clean IR. 24 tests.
- Q2 resolved → ADR-0011: **QEMU (qemu-xtensa-esp32) over Renode** for ESP32 virtual
  flash; `generateVirtualMachineConfig` emits a qemu-system-xtensa launch stub.
- Gaps: no real `pio run` exercised in CI; no end-to-end flash-to-emulator execution
  yet. MCP `server.ts` wrappers landed for all three adapters (issue #20); bin
  distribution needs a TS build step (packaging follow-up).

## Production-readiness checklist per adapter

- [x] import/export/validate implemented (kicad); library API equivalents (sim/firmware)
- [x] round-trip contract test green with lossy fields documented (kicad)
- [x] failure modes return structured errors (all adapters)
- [x] provenance stamped on every produced document (all adapters)
- [x] EECircuitBackend verified in a real browser session (2026-07-02)
- [x] MCP server wrappers implemented (buildServer + handlers per adapter, issue #20) — stdio bin distribution pending a TS build step (follow-up)
