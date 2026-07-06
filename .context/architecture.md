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

### 2.5 Validation layer — `packages/erc`
- Pure function: `checkSchematic(schematic, resolveComponent) → { violations }`.
- Reads only the schematic IR and each component's `pin.electricalType` — no engine,
  no IR change. Rules: `ERC_NO_GROUND`, `ERC_FLOATING_PIN`, `ERC_POWER_NOT_DRIVEN`,
  `ERC_OUTPUT_CONFLICT`, `ERC_SINGLE_PIN_NET`, `ERC_UNRESOLVED_COMPONENT`. Never throws —
  malformed input becomes a violation. Component resolution is injected, mirroring the
  netlist compiler's decoupling from the registry.
- **Surfaced in the editor** (issue #71): `apps/web/lib/editor/erc.ts` is a pure
  schematic → view-model adapter (`deriveErcIssues`, `instanceSeverities`) that turns the
  machine `Violation`s into plain-language issues — no `ERC_*` code ever reaches the DOM.
  The Inspector renders an always-on "Issues" panel (`components/editor/ErcPanel.tsx`),
  click-to-select the offending instance; the canvas badges flagged instances by severity.
  Also feeds the AI copilot's "why won't this work?" explanations.

### 2.6 Authoring layer — `packages/schematic-ops`
- Headless, pure `Schematic → Schematic` mutations: `placeInstance`, `moveInstance`,
  `rotateInstance`, `connectPins`, `deleteSelection`, `setParameterOverride`, plus
  `snapToGrid`/`refPrefix` helpers. Every op returns a NEW schematic that still passes
  `validateSchematic`; unknown ids are no-ops.
- Depends on `@openbench/ir-schema` only (no Next.js, no UI, no engine), so the
  agent-control MCP server (#33) and the in-app editor import the SAME implementation and
  can never drift (issue #68 / ADR-0019). `apps/web/lib/editor/mutations.ts` now re-exports
  from this package; the zustand store still wraps these with dirty-tracking + debounced
  persistence.

### 2.7 Teaching layer — `packages/lesson`
- Pure, engine-free package for teaching mode (issue #89, ADR-0022): exports the
  `Lesson`/`Step`/`SchematicPredicate` types and `evaluateStep(step, schematic,
  resolveComponent, erc?) → StepResult`. A **lesson is a product document, not an IR
  kind** — it wraps a `targetBundle: ProjectBundle` + `steps`, carries pedagogy fields no
  engine consumes, and uses a `les_` id prefix deliberately *outside* the IR discriminated
  union.
- A `SchematicPredicate` is an `all`/`any`/`not` tree of `component` (role-bound instance
  with `where` param constraints + `count`) and `connected` (pins share one net) clauses.
  `evaluateStep` is an **existential, subset, monotone** match: it backtracks over
  injective role→instance bindings (roles referenced only in `connected` clauses are free
  existentials), never throws (an unresolved component just fails to bind), and returns
  per-top-level-clause `satisfied` flags for incremental progress. Component resolution is
  injected, mirroring `packages/erc` and the netlist compiler.
- ERC (`packages/erc`) is an **advisory feed only**: violations touching a step's bound
  instances/nets surface as templated `warnings` that never gate `passed` (§3.4). Depends
  on `@openbench/ir-schema` + `@openbench/erc`; imported by the future authoring UI and
  student runner.
- **Author-by-recording** (issue #90, design §5): `deriveStepsFromRecording(batches,
  options?) → Step[]` turns an editor mutation recording — a sequence of cumulative
  schematic snapshots, one per undo-history batch (#18) — into candidate steps. Each
  batch's structural diff maps instances-added → `component` clauses (role = the
  instanceId, `where` seeded from the placed parameter overrides as exact `eq`) and
  nets-formed/extended → `connected` clauses over the net's pins; pure-move batches yield
  no step. Because the derivation emits exactly the predicate the built schematic
  satisfies, **every derived step passes against the final snapshot by construction** (no
  drift). Companion satisfiability-preserving edits: `loosenConstraints(step, pct)` (exact
  `eq` → ±pct% `approx`), `splitStep` (one step per top-level clause — sibling-bound roles
  become free existentials, still bind), `mergeSteps` (union the clauses). The
  *teaching-author editor mode* that groups undo history into batches and lets authors
  edit instruction/hint/constraints is a separately-filed UI follow-up. Follow-ups: student
  runner (#91), share + AI seam (#92).

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
- Discoverability nudge (issue #73): `derive.ts` exposes `hasLiveVisual(schematic,
  resolveComponent)` (reusing the internal `liveKind` classification, so new visual parts
  opt in automatically). After a *successful* Design-mode run on a circuit that has
  something Live can show (LED/RGB/motor/buzzer/lamp), `components/editor/LiveNudge.tsx`
  raises a dismissible Banner pointing at Live. `store.ts` holds the `nudge` flag;
  it fires once per completed run and clears on entering Live or on dismiss.
- `firmware.ts` (firmware-in-the-loop step 3, ADR-0018): joins the emulator side to the
  live view. Derives the ESP32 `GPIO→netId` map from the schematic, runs the
  `@openbench/mcp-firmware-platformio` `gpioEventsToPwl` translator on the poller's event
  stream, samples each PWL source onto the run's time grid, and returns a `qemu`-engine
  `simulationRun` that `derive.ts` consumes unchanged — so an emulated GPIO blink drives
  the on-canvas LED. Adds an `apps/web → mcp-firmware-platformio` dependency edge. See
  [firmware-in-the-loop.md](firmware-in-the-loop.md).

### 4. UI — `apps/web`
- Next.js (App Router) deployed on Vercel; API route handlers under `app/api/` serve
  IR documents (project CRUD, registry lookup, sim orchestration).
- Design system: Astryx (`@astryxdesign/core`, `@astryxdesign/theme-neutral`). All UI
  built from Astryx components + tokens; editor canvas is bespoke SVG but themed with
  Astryx CSS custom properties.
- Editor architecture: document store (zustand) holds IR documents; canvas renders
  schematic IR; every edit is a pure IR mutation (`@openbench/schematic-ops`, re-exported
  through `apps/web/lib/editor/mutations.ts` — no separate canvas model), autosaved
  (debounced) through the `ProjectStore` interface
  (`apps/web/lib/project-store/`, IndexedDB with memory fallback, ADR-0008). The
  simulation panel compiles via netlist-compiler + registry resolver and consumes
  `simulationRun` IR (waveform-v1, inline samples).
- Command palette (issue #38): `Cmd/Ctrl+K` opens an Astryx `CommandPalette`
  (`components/editor/CommandPalette.tsx`) — the keyboard-first twin of the AI copilot.
  The command list is a pure, injectable model (`apps/web/lib/editor/commands.ts`):
  fixed actions (run sim, toggle Live, ERC check, undo/redo, import/export, open project)
  plus one "Add <part>" command generated per `registryComponents` entry, so new registry
  parts become keyboard-placeable automatically. Every command routes through the same
  store actions the palette-less UI uses (e.g. add-component → `store.place`), so there is
  no second mutation path.
- Bill of Materials (issue #39): `apps/web/lib/bom.ts` is a pure projection of the
  schematic IR — `buildBom(schematic, resolveComponent?)` groups instances by
  `componentId` + resolved parameters into `{refs, componentId, value, qty, footprint?}`
  lines, splitting footprint-less parts (ground/sources) into a `virtual` section and
  keeping registry-unknown instances flagged rather than dropped. `bomToCsv`/`parseBomCsv`
  are an RFC-4180 round-trip pair. `components/editor/BomPanel.tsx` renders it with an
  Astryx `Table` + CSV export; `BomButton.tsx` opens it from the top bar in a Dialog.
  Component resolution is injected (default `getComponent`), mirroring the ERC adapter.
- Stateless sharing + embed (issue #40, ADR-0025): `apps/web/lib/share.ts` serializes a
  bundle to a gzip-compressed, URL-safe base64 payload (`CompressionStream` + base64url).
  `encodeShare` returns a structured `too_large` error past `SHARE_URL_LIMIT` (never
  throws); `decodeShare` inverts it. The editor store gains a `readOnly` flag +
  `loadShared(bundle)` — every IR commit is a no-op while read-only. `/embed/<payload>`
  (`components/embed/EmbedSimulator.tsx`) hydrates a read-only project with minimal chrome
  (name + Run + canvas) for iframes; `components/editor/ShareButton.tsx` copies the link.
  Purely client-side — no server, DB, or account (ADR-0008). NOT multiplayer/CRDT.
- Teaching chrome (issue #163): `components/lesson/LessonPanel.tsx` is the single editor
  mount for the teaching flow — a right-side panel (Design mode only) that self-gates on
  the editor store's `teachingOpen` flag (like `ErcPanel`), so the page mounts it
  unconditionally and the `EditorTopBar` "Teaching" toggle just flips the flag. It toggles
  in place between the author view (`LessonAuthorPanel`, derive→refine steps from the live
  build) and the student view (`StudentRunnerPanel` run against a preview lesson).
  `apps/web/lib/lesson/preview.ts` (`buildPreviewLesson`) is the pure seam wrapping the
  live bundle as a `les_preview` `Lesson` (current bundle → `targetBundle`, undo-history →
  derived steps) so the author can preview the student experience without a share
  round-trip. This makes the teaching author/runner (`packages/lesson`, §2.7) reachable by
  users — previously they were only exercised in tests.
- Contextual learning — Learn panel (epic #76, issues #78–#80): the component IR carries
  an optional read-only `education` block (`packages/ir-schema`, `educationSchema` — summary,
  gotchas, keyFormula, paramNotes, interactiveHint; adapters ignore it). The three hero parts
  (LED/resistor/capacitor) carry authored content (#79). `components/editor/LearnPanel.tsx`
  is a **generic, data-driven** renderer mounted in the Inspector: for the single selected
  instance it renders that block with **zero per-part branching** (new parts get a panel for
  free). It is just-in-time and optional — starts collapsed (Astryx `Collapsible`) and
  self-hides when the part has no block or the user opted out via `lib/editor/learn-prefs.ts`
  (a localStorage-backed on/off store, ADR-0008). The live "try it" knob (#81,
  `components/editor/LiveKnob.tsx` over pure `lib/live/interactive-knob.ts`) mounts beneath the
  Learn panel: it turns the selected part's `interactiveHint` into one slider that writes a
  parameter override and re-runs the sim through the **existing** debounced live path
  (`lib/live/store.ts` `interact`), then watches a derived series from `deriveInstanceStates`
  (LED brightness/current is the hero). `resolveInteractiveKnob` redirects the knob to a *wired
  neighbour* when `targetComponentId` is set (the LED's knob lives on its series resistor) —
  generic, no per-part code. It self-hides without a hint, when the circuit can't simulate (no
  completed run yields the watched series — composes with #72), or when Learn is opted out.

### 5. Desktop shell — `apps/desktop`
- Electron shell that wraps the `apps/web` UI, first slice of the desktop pivot
  (ADR-0024). Main process (`src/main.ts`): `createMainWindow()` opens one
  `BrowserWindow` and, in dev (`OPENBENCH_DESKTOP_ENV=dev`), loads `next dev` at
  `http://localhost:3000`; otherwise loads the packaged static export
  (`apps/web/out/index.html`) via `loadFile`. Renderer is hardened —
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — so the web UI
  reaches the main process only through the `window.openbench` bridge established in
  `src/preload.ts` (`contextBridge.exposeInMainWorld`).
- Scaffold only: no engine execution, no `apps/desktop-backend` wiring, no packaging.
  `apps/web` is unchanged and still a plain Next.js UI package. Native engine backends,
  static-export of `apps/web`, and `electron-builder` installers are tracked by the
  later desktop-pivot issues. The scaffold is only type-checked and unit-tested
  (electron mocked via vitest), never launched, so electron's ~150MB prebuilt binary
  is not needed: a committed root `.npmrc` sets `ignore-scripts=true`, which skips
  electron's postinstall download on every `npm ci` (CI, Vercel, fresh clone) while
  still shipping its `.d.ts` for the `tsc` build. Explicit `npm run build`/`npm test`
  are unaffected — npm suppresses only dependency lifecycle scripts, not the invoked
  script. When the desktop app must actually run, fetch the binary with
  `node node_modules/electron/install.js` (or `npm rebuild electron
  --ignore-scripts=false`). Plain `npm rebuild electron` and `--foreground-scripts`
  do NOT work here: they honor the root `.npmrc` `ignore-scripts=true`, print
  "rebuilt successfully", and download nothing.

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
- **Desktop pivot (in progress, ADR-0024):** moving from browser/Vercel-hosted to a
  downloadable Electron app backed by a native local backend. First slice landed — the
  `apps/desktop` Electron shell scaffold (above). Native engine backends, per-OS binary
  bundling, and `electron-builder` installers follow.
- **Phase 2 (deferred):** multiplayer/CRDT collaboration, community registry service,
  more MCU families, PCB layout.
