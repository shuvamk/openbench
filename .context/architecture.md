# OpenBench Architecture

> Canonical, current-state architecture. Update this file in the same PR as any
> architecture-relevant change — CI (`context-freshness.yml`) enforces it.
> Decisions and their rationale live in [decisions.md](decisions.md); this file
> describes *what is*, not *why it became so*.

## System overview

OpenBench is a single repository containing a browser app, the canonical interchange
format (IR), and one adapter package per external engine. Engines never talk to each
other directly — every hand-off is an IR document.

```
                        ┌───────────────────────────────────────────────┐
                        │ apps/web — Next.js App Router + Astryx DS     │
                        │  • Landing, dashboard, editor                 │
                        │  • Schematic canvas (SVG, direct-manipulation)│
                        │  • Simulation panel (waveform viewer)         │
                        │  • Firmware panel                             │
                        │  • API route handlers (/api/*)                │
                        └──────────────────────┬────────────────────────┘
                                               │ IR documents (JSON)
                 ┌───────────────┬─────────────┼───────────────┬─────────────────┐
                 ▼               ▼             ▼               ▼                 ▼
        packages/ir-schema  packages/     packages/      packages/        packages/
        (canonical IR:      netlist-      mcp-kicad      mcp-sim-         mcp-firmware-
         zod schemas,       compiler      (KiCad         ngspice          platformio
         validation,        (schematic→   .kicad_sch     (netlist →       (PlatformIO
         versioning)        netlist IR)   import/export) sim run)         build/flash)
```

## Layers

### 1. IR layer — `packages/ir-schema`
- Zod schemas for the six document kinds (`component`, `schematic`, `netlist`,
  `simulationRun`, `firmwareTarget`, `project`) exactly as specified in
  [interchange-format.md](interchange-format.md).
- `validate(doc)` returning `{ valid, errors }`; discriminated-union parsing by `kind`.
- `irVersion` compatibility checking (semver; pre-1.0 minor = breaking).
- This package has **zero runtime dependencies besides zod** and is imported by every
  other package. It is the only place IR shapes are defined.

### 2. Derivation layer — `packages/netlist-compiler`
- Pure function: `schematic IR (+ component registry) → netlist IR`.
- Assigns SPICE node numbers (ground nets → `0`), expands component `simModel.template`
  strings into SPICE cards, records `derivedBy: "netlist-compiler@<version>"`.

### 3. Engine adapters — `packages/mcp-*`
Each adapter is an MCP server exposing the standard tool contract
(`import`, `export`, `validate`) plus engine-specific tools (e.g. `runSimulation`).
Status of each: [engine-status.md](engine-status.md).

- `mcp-kicad` — KiCad schematic import/export (`.kicad_sch` S-expressions ↔ schematic IR).
- `mcp-sim-ngspice` — netlist IR → ngspice run → `simulationRun` IR with waveform results.
  Two execution backends behind one interface: WASM ngspice in-browser (Phase 1 default)
  and native ngspice CLI (server/local).
- `mcp-firmware-platformio` — firmware source + `firmwareTarget` IR → PlatformIO build →
  artifact + flash-to-virtual-MCU (Renode machine config). Runs locally/CI, not on Vercel.

### 3.5 Live view — `apps/web/lib/live`
- `derive.ts`: pure physics derivation — net-voltage waveforms → per-instance visual
  state (Shockley LED brightness, motor rpm fraction, lamp/buzzer intensity, switch
  state). `store.ts`: playback (scrub/play/speed/loop) + interactions that mutate IR
  parameter overrides and re-run the simulation debounced. Overlays render inside the
  canvas world transform; interactive parts (button/switch/pot/LDR) are actuated
  directly on the canvas in Live mode.

### 4. UI — `apps/web`
- Next.js (App Router) deployed on Vercel; API route handlers under `app/api/` serve
  IR documents (project CRUD, registry lookup, sim orchestration).
- Design system: Astryx (`@astryxdesign/core`, `@astryxdesign/theme-neutral`). All UI
  built from Astryx components + tokens; editor canvas is bespoke SVG but themed with
  Astryx CSS custom properties.
- Editor architecture: document store (zustand) holds IR documents; canvas renders
  schematic IR; every edit is a pure IR mutation (`apps/web/lib/editor/mutations.ts` —
  no separate canvas model), autosaved (debounced) through the `ProjectStore` interface
  (`apps/web/lib/project-store/`, IndexedDB with memory fallback, ADR-0008). The
  simulation panel compiles via netlist-compiler + registry resolver and consumes
  `simulationRun` IR (waveform-v1, inline samples).

## Persistence

- Phase 1 (current): projects persist client-side (IndexedDB via a thin storage
  interface) + import/export as `.openbench.json` bundles. No accounts, no server DB.
- Waveform samples: inline `Float64Array` (base64) in the `simulationRun` document for
  runs < 1M samples; the `samples` field accepts either inline data or a URL, so object
  storage can slot in later without an IR break (see ADR-0007).

## CI/CD & agent pipeline

- GitHub Actions: `test` (unit+integration), `reviewer-agent` (sole merge gate),
  `context-freshness`, nightly `issue-hygiene`, `deploy-sanity` after production deploys.
- Vercel: production deploy on every merge to `main`; preview deploy per PR.
- Work flows through GitHub issues per `.github/LABELS.md`; agent roles in
  [agent-roles.md](agent-roles.md).

## Phase status

- **Phase 0 (agentic infrastructure): complete** — pipeline proven end to end
  (issue → red → green → PR → gates), with the caveat that hosted CI is blocked by a
  GitHub account billing lock (ADR-0010).
- **Phase 1 (vertical slice): in progress, core landed.** All six IR kinds wired;
  registry (6 parts), netlist compiler, KiCad adapter (flat sheets), ngspice adapter
  (transient, WASM+mock), PlatformIO adapter (ini/backends/QEMU stub, ADR-0011);
  frontend: projects dashboard (IndexedDB ProjectStore, templates, import/export),
  schematic editor (SVG canvas, palette, inspector, wires→IR nets, autosave), and
  simulation panel (run → waveforms → console). Remaining: browser verification of the
  WASM ngspice backend, MCP server wrappers, real pio/QEMU execution paths per
  [engine-status.md](engine-status.md).
- **Phase 2 (deferred):** multiplayer/CRDT collaboration, community registry service,
  more MCU families, PCB layout.
