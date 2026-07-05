# Engine Adapter Status

> One section per engine. States: **wired** (production-ready, contract tests green),
> **partial** (works for the documented subset), **stubbed** (interface + tests exist,
> engine not attached), **planned**. Lossy round-trip fields MUST be listed here.

| Engine | Package | Status | Backend |
| --- | --- | --- | --- |
| IR core | `packages/ir-schema` | **wired** — all six kinds | pure TS (zod) |
| Netlist compiler | `packages/netlist-compiler` | **wired** | pure TS |
| Registry | `packages/registry` | **wired** — 31 curated parts | pure TS data |
| KiCad | `packages/mcp-kicad` | **partial** — flat single-sheet subset | `.kicad_sch` S-expression parser (pure TS), no kicad-cli |
| ngspice | `packages/mcp-sim-ngspice` | **partial** — transient/ac/dcSweep/op, WASM+mock+native backends | WASM (`eecircuit-engine`) in-browser; native CLI feature-detected (rawfile parser, real-binary run pending) |
| PlatformIO | `packages/mcp-firmware-platformio` | **partial** — ini gen, backend seam, mock builds | local `pio` CLI (feature-detected); never runs on Vercel |
| QEMU (virtual flash) | (inside mcp-firmware) | **stubbed** — machine-config gen + GDB-RSP GPIO poller (codec/reader, no live emulator yet) | qemu-system-xtensa launch stub (ADR-0011); firmware-in-the-loop steps 1 (#64) & 2 (#65 GPIO->PWL) |

## IR core (`packages/ir-schema`)

- Wired: all six kinds (`component`, `schematic`, `netlist`, `simulationRun`,
  `firmwareTarget`, `project`), `validateDocument` discriminated-union dispatcher,
  version compatibility, structured `{ path, message }` errors.
- Additive fields (2026-07-02, patch-level): `component.simModel.modelCard` (SPICE
  `.model` line), `schematic.layout` (per-instance editor geometry, keys validated
  against declared instanceIds).
- **IR version `0.1.1`** (2026-07-05, issue #78): first explicit patch bump
  (`0.1.0 → 0.1.1`). Added `component.education?` — optional read-only teaching
  metadata (`summary`, `gotchas[]`, `keyFormula{display,variables}`, `paramNotes`,
  `interactiveHint{targetParam,targetComponentId?,observe,prompt}`). Additive/
  non-breaking: `0.1.0` docs still validate (pre-1.0 patch diffs compatible),
  `education` is exported as the `Education` type, and adapters ignore it (no
  round-trip impact). `keyFormula.display` is display-only text, never evaluated.
- Known gaps: JSON Schema export pending; no `migrate()` yet (nothing to migrate pre-0.2).

## Registry (`packages/registry`)

- Wired (issues #6, #17, #22; batch 3; ICs #44; current sources): 31 parts — passives, LED/RGB/diode/NPN,
  DC/pulse/sine voltage sources, DC/sine current sources (`I{ref}` cards, symbol kind `isource`),
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
  Batch 6 (#44) lands the digital & visual ICs: `cmp_logic_7400`/`_7404`/`_7408` (single-gate
  NAND/NOT/AND behavioral `.subckt` models — an ngspice `B` source drives the output to 0/5V via
  nested ternaries over a 2.5V threshold, output referenced to global node 0 like the op-amp) and
  `cmp_7segment_display` (eight common-cathode segment LEDs on the shared DSEG model, `ic` symbol).
  The logic-gate models are correct by inspection; exact SPICE logic timing is browser-WASM-verified,
  not asserted against the synthetic MockBackend (ADR-0021 supersedes the earlier blanket deferral).
  `cmp_timer_ne555` is intentionally NOT shipped here — a correct astable 555 needs an internal
  comparator+latch and a discharge-switch that require live in-browser ngspice verification; tracked
  as a follow-up issue rather than faked behind MockBackend.
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
- Modes (issue #36): `runSimulation`/`buildSpiceDeck` take a discriminated
  `mode` union — `transient` (`.tran`), `ac` (`.ac <sweep> <points> <fStart>
  <fStop>`), `dcSweep` (`.dc <source> <start> <stop> <step>`). The backend
  `SimBackend.run` result generalized from `{ time, signals }` to `{ x, signals,
  phase? }`: `x` is the independent axis (time s / frequency Hz / swept-source
  value). AC runs emit per-net magnitude (`unit: "dB"`) + phase (`unit: "deg"`)
  signals plus a `frequency`/Hz axis; dcSweep emits per-net V signals plus the
  swept source (e.g. `V1`, unit V) as the x-axis — **not** `time`. Bad config
  (fStop ≤ fStart, non-integer/≤0 points, bad sweep type, step 0, empty source)
  → structured `NgspiceAdapterError` → `status:"failed"`, never a throw.
  MockBackend AC is a synthetic single-pole low-pass whose corner is the deck's
  first R·C (1k·1u ⇒ −3 dB ≈ 159 Hz); MockBackend dcSweep is a synthetic linear
  transfer (first probe slope 0.5). The MCP server tool surface is still
  transient-only — exposing ac/dcSweep as MCP tools is a follow-up.
- Operating point + native CLI backend (issue #30): a fourth mode `op` emits a bare
  `.op` card (no `.tran`) and shapes results as one V sample per net with **no
  independent axis** (no `time`/`frequency` signal). `NativeNgspiceBackend` sits behind
  the same `SimBackend` seam: it feature-detects an `ngspice` binary and parses its ASCII
  rawfile (`SPICE_ASCIIRAWFILE=1`) into a `BackendResult` (axis chosen by the deck card —
  op/tran/dc; AC/complex rawfiles not yet decoded). Absence is structured, never a throw:
  `detect()` returns `{ available, binaryPath?, reason? }`; `run()` on an unavailable
  engine throws a structured `NgspiceAdapterError` that `runSimulation` maps to
  `status:"failed"` (`engine-unavailable`). `locate`/`execute` hooks are injectable, so the
  backend and the `parseRawfile`/`serializeRawfile` round-trip are unit-tested with **zero
  ngspice binary** on the runner (fixture `test/fixtures/rc-op.raw`). MockBackend gained an
  `op` branch (one synthetic DC-bias sample per probe). The MCP server tool surface is still
  transient-only — exposing ac/dcSweep/op and wiring the native backend as MCP tools is a follow-up.
- Verified 2026-07-02: EECircuitBackend ran a real transient in a browser session (RC low-pass demo, deck `.tran 10us 10ms`, physically-correct DC steady-state waveforms, zero console errors). Gaps: the native ngspice CLI
  backend's real spawn+run path (default `locate`/`execute`) is exercised only with
  injected hooks in tests — a run against a real installed `ngspice` binary is still
  pending; remote sample URLs are
  pass-through (`decodeSamples` throws for http/s3). EECircuitBackend `ac`/`dcSweep`
  paths (complex→dB/deg mapping via `img`/`real`, frequency/swept-source axis
  detection) are implemented but **pending a browser verification session** — only
  the MockBackend ac/dcSweep paths are node-verified so far.
- Limits: MockBackend 256 samples/signal (transient); WASM ~1M samples/signal (ADR-0007 guard).
- User-visible fallback (issue #130): the editor's WASM→mock fallback is no longer
  silent. `runProjectSimulation` returns `backendUsed` + `usedMockFallback`; the sim
  store exposes `phase` (idle→compiling→simulating→done|failed) plus those two fields.
  The Run button shows the live phase and SimPanel renders a warning badge whenever
  results came from the mock backend — so synthetic waveforms are never mistaken for a
  real ngspice run.

## PlatformIO (`packages/mcp-firmware-platformio`)

- Partial (issue #10): platformio.ini generation (esp32 family only), FirmwareBackend
  seam (MockBackend + feature-detecting PioCliBackend — absent `pio` →
  `engine-unavailable` structured failure, never throws), `buildFirmware` produces
  validateFirmwareTarget-clean IR. 24 tests.
- Q2 resolved → ADR-0011: **QEMU (qemu-xtensa-esp32) over Renode** for ESP32 virtual
  flash; `generateVirtualMachineConfig` emits a qemu-system-xtensa launch stub.
- Firmware-in-the-loop step 1 (issue #64): `gdb-rsp.ts` — a thin GDB Remote Serial
  Protocol codec (checksum/frame, `m addr,len` reads, little-endian word decode) plus a
  transport-injected `RspMemoryReader`; `gpio-poller.ts` — a `GpioPoller` that samples
  the ESP32 GPIO_OUT/GPIO_OUT1/GPIO_ENABLE/GPIO_ENABLE1 registers and emits
  edge-triggered `(t, gpio, level)` events for *driven* pins only, plus a `pollGpio` run
  loop (injectable clock/sleep). 13 tests. The transport and QEMU-launch (`-s` GDB
  server) are the injectable seams — no real emulator runs in CI yet.
- Firmware-in-the-loop step 2 (issue #65): `gpio-pwl.ts` — `gpioEventsToPwl`, a pure fn
  turning the poller's `(t, gpio, level)` timeline plus an `esp32PinNetMap` (gpio ->
  SPICE node) into PWL 'V' source cards so ngspice sees firmware-driven pins. Each driven
  pin becomes a Thevenin driver: `Vgpio<N> n_gpio<N> 0 PWL(...)` (HIGH -> VOH 3.3V, LOW ->
  0V, each edge held-then-ramped over ~1us so dv/dt is finite) behind `Rgpio<N> n_gpio<N>
  <net> 30` (~30 ohm output impedance), mirroring the netlist-compiler SIN/DC source-card
  path. Event `t` is ms, PWL time is seconds. 12 tests.
  - **Hi-Z is lossy**: a plain V+R Thevenin source cannot open-circuit, so `"Z"` samples
    emit no breakpoint; a pin that is only ever Hi-Z (or absent from the stream) emits no
    card (net floats — correct "no drive"). Interior Hi-Z windows are approximated as a
    hold of the surrounding driven levels; true tri-state would need a switched source
    (deferred).
- Gaps: the concrete socket transport + QEMU process launch/observe are still unwired (the
  poller runs off an injected `MemoryReader`); `gpioEventsToPwl` output is not yet spliced
  into a compiled netlist deck (wiring the source cards into the ngspice run is a
  follow-up); no real `pio run` exercised in CI; no end-to-end flash-to-emulator execution
  yet. MCP `server.ts` wrappers landed for all three adapters (issue #20); bin
  distribution needs a TS build step (packaging follow-up).

## Production-readiness checklist per adapter

- [x] import/export/validate implemented (kicad); library API equivalents (sim/firmware)
- [x] round-trip contract test green with lossy fields documented (kicad)
- [x] failure modes return structured errors (all adapters)
- [x] provenance stamped on every produced document (all adapters)
- [x] EECircuitBackend verified in a real browser session (2026-07-02)
- [x] MCP server wrappers implemented (buildServer + handlers per adapter, issue #20) — stdio bin distribution pending a TS build step (follow-up)
