# OpenBench Interchange Format (IR)

> This is the single most important file in the repo. Every engine
> adapter (KiCad, ngspice, Renode/QEMU, PlatformIO) reads and writes
> these shapes, and nothing else. If two engines need to talk, they talk
> through this format — never directly to each other's native format.
> Treat any change here as a breaking-change candidate; run
> `ir-schema-guard` before merging.

Implemented in `packages/ir-schema` (zod schemas + JSON Schema export). This document
and the code must never drift: the `ir-schema-guard` skill and the package's
`spec-sync` test enforce it.

## Design principles

1. **JSON-serializable, versioned.** Every top-level object carries
   `"irVersion"` (current: `"0.1.1"`). Breaking changes bump minor until 1.0,
   then major; additive optional fields are patch-level and remain compatible
   (a `0.1.0` document still validates against `0.1.1`).
2. **Engine-native formats are translation targets, not the source of
   truth.** KiCad `.kicad_sch`, SPICE netlists, Renode `.repl`/`.resc`,
   and PlatformIO `platformio.ini` are all *generated from* or *imported
   into* the IR — the IR is canonical.
3. **Traceable provenance.** Every object records which engine produced
   it and when, so a bug can be traced to a specific adapter.
4. **Composable, not monolithic.** A "project" references a schematic, a
   simulation config, and a firmware target as separate documents linked
   by ID — not one giant nested blob — so engines only need to read the
   slice they care about.

## Core schemas

```jsonc
// === Component (registry unit) ===
{
  "irVersion": "0.1.0",
  "kind": "component",
  "id": "cmp_resistor_generic",
  "name": "Resistor",
  "category": "passive",
  "pins": [
    { "id": "p1", "name": "1", "electricalType": "passive" },
    { "id": "p2", "name": "2", "electricalType": "passive" }
  ],
  "parameters": [
    { "name": "resistance", "unit": "ohm", "default": 1000, "type": "number" }
  ],
  "simModel": {
    "engine": "ngspice",
    "template": "R{ref} {p1} {p2} {resistance}",
    // optional: "modelCard": ".model DLED D(IS=1e-14)" — SPICE .model line for
    // components whose template references a named model (additive, Phase 1)
    // optional: "derivedParams": { "ronoff": "0.001 + (1 - pressed) * 1e12" } —
    // arithmetic expressions over declared parameter names (numeric literals
    // incl. 1e12 style, + - * / and parentheses; nothing else — no function
    // calls, no ternaries). Keys must not collide with parameter names.
    // Template tokens may reference {ref}, pin ids, parameter names, and
    // derivedParams keys. Templates MAY contain newlines: the netlist compiler
    // emits one SPICE card per non-empty trimmed line; use {ref}-suffixed
    // device names (e.g. "D{ref}R") to keep multi-device instances unique.
  },
  "footprint": { "kicadRef": "Resistor_SMD:R_0603_1608Metric" },
  // optional: "education": { ... } — read-only teaching metadata (additive, issue
  // #78). Every sub-field optional: "summary" (one line), "gotchas": string[],
  // "keyFormula": { "display", "variables": Record<string,string> } (display-only
  // TEXT, never parsed), "paramNotes": Record<string,string>, and "interactiveHint":
  // { "targetParam", "targetComponentId"?, "observe", "prompt" } — the live "try it"
  // knob. Ignored by every adapter (KiCad/ngspice/firmware). See the changelog entry.
  "provenance": { "source": "registry", "addedBy": "registry-curator", "at": "<iso8601>" }
}

// === Schematic (a design instance) ===
{
  "irVersion": "0.1.0",
  "kind": "schematic",
  "id": "sch_<uuid>",
  "projectId": "proj_<uuid>",
  "instances": [
    { "instanceId": "R1", "componentId": "cmp_resistor_generic",
      "parameterOverrides": { "resistance": 4700 } },
    { "instanceId": "U1", "componentId": "cmp_esp32_devkit" }
  ],
  "nets": [
    { "netId": "net_vcc", "name": "VCC",
      "connections": [ { "instanceId": "R1", "pinId": "p1" },
                        { "instanceId": "U1", "pinId": "3V3" } ] }
  ],
  // optional editor geometry (additive, Phase 1); keys must be declared instanceIds
  "layout": {
    "instances": {
      "R1": { "x": 120, "y": 80, "rotation": 0 },   // rotation: 0 | 90 | 180 | 270
      "U1": { "x": 320, "y": 160 }
    },
    // scope probes (issue #37): netId must be a declared net; x/y place the
    // on-canvas marker; color is optional (viewer derives one by index otherwise)
    "probes": [
      { "probeId": "prb_1", "netId": "net_vcc", "x": 200, "y": 120 }
    ]
  },
  "provenance": { "source": "kicad-adapter", "at": "<iso8601>" }
}

// === Netlist (derived, engine-agnostic, feeds simulators) ===
{
  "irVersion": "0.1.0",
  "kind": "netlist",
  "id": "net_<uuid>",
  "schematicId": "sch_<uuid>",
  "nodes": [ { "netId": "net_vcc", "spiceNode": "1" } ],
  "elements": [ { "instanceId": "R1", "spiceCard": "R1 1 0 4700" } ],
  "derivedBy": "netlist-compiler@0.1.0",
  "provenance": { "source": "ir-core", "at": "<iso8601>" }
}

// === Simulation Run (config + result, one document per run) ===
{
  "irVersion": "0.1.0",
  "kind": "simulationRun",
  "id": "sim_<uuid>",
  "netlistId": "net_<uuid>",
  "engine": "ngspice",           // or "renode", "qemu"
  "mode": "transient",           // engine-specific enum, documented per adapter
  "config": { "duration": "10ms", "step": "1us" },
  "status": "completed",         // queued | running | completed | failed
  "results": {
    "format": "waveform-v1",
    "signals": [
      { "netId": "net_vcc", "unit": "V", "samples": "s3://.../vcc.bin" }
    ]
  },
  "logs": "s3://.../sim.log",
  "provenance": { "source": "mcp-sim-ngspice", "at": "<iso8601>" }
}

// === Firmware Target (build + flash-to-virtual-MCU) ===
{
  "irVersion": "0.1.0",
  "kind": "firmwareTarget",
  "id": "fw_<uuid>",
  "projectId": "proj_<uuid>",
  "mcu": "esp32dev",
  "framework": "arduino",        // or "esp-idf", "zephyr"
  "sourceRef": "git+<repo>#<path>",
  "buildStatus": "success",
  "artifact": { "binary": "s3://.../firmware.bin", "elf": "s3://.../firmware.elf" },
  "flashTarget": {
    "kind": "virtual",           // "virtual" | "physical"
    "engine": "renode",
    "machineConfig": "s3://.../machine.repl"
  },
  "provenance": { "source": "mcp-firmware-platformio", "at": "<iso8601>" }
}

// === Project (root object linking everything) ===
{
  "irVersion": "0.1.0",
  "kind": "project",
  "id": "proj_<uuid>",
  "name": "Blink with adjustable brightness",
  "schematicId": "sch_<uuid>",
  "firmwareTargetId": "fw_<uuid>",
  "latestSimulationRunId": "sim_<uuid>",
  "collaborators": [],           // reserved for Phase 2 (multiplayer)
  "provenance": { "source": "frontend", "at": "<iso8601>" }
}
```

## Adapter contract (every MCP engine server must implement)

- `import(nativeFormat) -> IR document(s)`
- `export(IR document) -> nativeFormat`
- `validate(IR document) -> { valid: bool, errors: [...] }`
- Round-trip test requirement: for every adapter, a contract test must
  assert `import(export(doc)) == doc` (modulo documented lossy fields,
  which must be listed in `.context/engine-status.md`).

## Open items to resolve autonomously as Phase 1 proceeds

(Log the resolution in `.context/decisions.md`, don't wait to be told.)

- Binary waveform/result storage: local filesystem vs. object storage
  abstraction from day one — decide based on what Vercel's runtime
  supports cheaply.
- PCB layout representation (deferred until Phase 1 needs it — schematic
  + netlist + sim + firmware is the full Phase 1 loop, no PCB yet).
- Multiplayer/CRDT representation of the schematic (explicitly deferred
  to Phase 2 — do not build early).

## Implementation changelog

- **2026-07-02** — `component` kind implemented in `packages/ir-schema`
  (issue #1, Phase 0 exit criteria). No shape changes vs this spec. Notes:
  component ids validated against `^cmp_[a-z0-9_]+$`; `simModel.template`
  tokens checked against `ref` + declared pin ids + parameter names.
- **2026-07-02** — remaining five kinds (`schematic`, `netlist`,
  `simulationRun`, `firmwareTarget`, `project`) implemented in
  `packages/ir-schema` (issue #5), plus `irDocumentSchema` (discriminated
  union on `kind`) and `validateDocument`. Two ADDITIVE, patch-level fields
  (no `irVersion` bump; ir-schema-guard: optional additions are
  non-breaking): `component.simModel.modelCard?: string` — a SPICE `.model`
  line; `schematic.layout?: { instances: Record<instanceId, { x, y,
  rotation?: 0|90|180|270 }> }` — editor geometry, keys must be declared
  instanceIds. Validation notes: sch_/net_/sim_/fw_/proj_ ids match
  `^<prefix>_[a-z0-9_-]+$`; schematic rejects duplicate instanceIds,
  duplicate netIds, and connections/layout keys referencing undeclared
  instanceIds; `simulationRun.results.signals[].samples` must be a URL or
  `data:` URI; `netlist.derivedBy` is required.
- **2026-07-02** — issue #21, two ADDITIVE, patch-level capabilities (no
  `irVersion` bump; ir-schema-guard: optional additions are non-breaking):
  1. `component.simModel.derivedParams?: Record<string,string>` — arithmetic
  expressions over declared parameter names. Validation tokenizes each
  expression: identifiers must be declared parameter names; only numeric
  literals (incl. `1e12` style), `+ - * /`, parentheses, and whitespace are
  allowed (error path `simModel.derivedParams.<key>`); keys colliding with a
  parameter name are rejected. Template tokens may now reference pins,
  parameters, `ref`, OR derivedParams keys. The netlist compiler evaluates
  the expressions with a safe recursive-descent evaluator
  (`packages/netlist-compiler/src/expr.ts` — never `eval`), resolving
  overrides over defaults first; derived values shadow nothing.
  2. Multi-line `simModel.template` strings are explicitly legal: the netlist
  compiler splits the expanded template on newlines, trims each line, drops
  empties, and emits one `elements[]` entry per line (one SPICE card per
  line). `{ref}`-suffixed device names (e.g. `D{ref}R`) keep multi-device
  instances unique. `modelCard` dedup by content is unchanged.
- **2026-07-04** — issue #34, one ADDITIVE, patch-level field (no `irVersion`
  bump; ir-schema-guard: optional additions are non-breaking):
  `component.simModel.subckt?: string` — a SPICE `.subckt … .ends` definition
  block. It pairs with an `X{ref} <nodes> <name>` call template; the netlist
  compiler emits one `X` device card per instance and appends the definition
  block **once**, deduplicated by content exactly like `modelCard`. The block is
  opaque: a subcircuit's internal nodes are local to the definition — only the
  template's `{pin}` tokens map to outer SPICE nodes (ground on a pin net still
  resolves to `0`). This unblocks multi-terminal ICs (op-amps, 555, logic).

  ```jsonc
  // === Additive fields — subcircuit component (issue #34) ===
  {
    "irVersion": "0.1.0",
    "kind": "component",
    "id": "cmp_opamp_ideal",
    "name": "Ideal Op-Amp",
    "category": "active",
    "pins": [
      { "id": "inp", "name": "IN+", "electricalType": "input" },
      { "id": "inn", "name": "IN-", "electricalType": "input" },
      { "id": "out", "name": "OUT", "electricalType": "output" }
    ],
    "parameters": [],
    "simModel": {
      "engine": "ngspice",
      "template": "X{ref} {inp} {inn} {out} OPAMP",
      "subckt": ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP"
    },
    "provenance": { "source": "registry", "addedBy": "registry-curator", "at": "<iso8601>" }
  }
  ```
- **2026-07-05** — issue #36, ADDITIVE, patch-level (no `irVersion` bump;
  `simulationRun.mode` is a documented per-adapter free string, so new modes need
  no schema change): the ngspice adapter grows two analysis modes beyond
  `transient`. `mode: "ac"` (small-signal frequency sweep) pairs with
  `config: { sweep: "dec"|"oct"|"lin", points, fStart, fStop }` and produces
  results that carry, per probed net, a magnitude signal (`unit: "dB"`) and a
  phase signal (`unit: "deg"`) over a `frequency` axis (`unit: "Hz"`).
  `mode: "dcSweep"` (DC transfer curve) pairs with
  `config: { source, start, stop, step }` and puts the swept independent source
  (e.g. `V1`, `unit: "V"`) on the x-axis in place of `time`. `waveform-v1` is
  unchanged — these are just new `unit`/`netId` conventions within it. Bad config
  (`fStop ≤ fStart`, non-positive/non-integer `points`, `step: 0`, empty
  `source`) yields a `status: "failed"` run with an inline log, never a throw.

  ```jsonc
  // === Additive — ngspice AC analysis run (issue #36) ===
  {
    "irVersion": "0.1.0",
    "kind": "simulationRun",
    "id": "sim_<uuid>",
    "netlistId": "net_<uuid>",
    "engine": "ngspice",
    "mode": "ac",
    "config": { "sweep": "dec", "points": 10, "fStart": "1", "fStop": "1meg" },
    "status": "completed",
    "results": {
      "format": "waveform-v1",
      "signals": [
        { "netId": "net_vout", "unit": "dB",  "samples": "s3://.../vout.mag.bin" },
        { "netId": "net_vout", "unit": "deg", "samples": "s3://.../vout.phase.bin" },
        { "netId": "frequency", "unit": "Hz", "samples": "s3://.../freq.bin" }
      ]
    },
    "provenance": { "source": "mcp-sim-ngspice", "at": "<iso8601>" }
  }

  // === Additive — ngspice DC-sweep run (issue #36) ===
  {
    "irVersion": "0.1.0",
    "kind": "simulationRun",
    "id": "sim_<uuid>",
    "netlistId": "net_<uuid>",
    "engine": "ngspice",
    "mode": "dcSweep",
    "config": { "source": "V1", "start": 0, "stop": 5, "step": 0.1 },
    "status": "completed",
    "results": {
      "format": "waveform-v1",
      "signals": [
        { "netId": "net_vout", "unit": "V", "samples": "s3://.../vout.bin" },
        { "netId": "V1", "unit": "V", "samples": "s3://.../sweep.bin" }
      ]
    },
    "provenance": { "source": "mcp-sim-ngspice", "at": "<iso8601>" }
  }
  ```
- **2026-07-05** — issue #37, one ADDITIVE, patch-level field (no `irVersion`
  bump; ir-schema-guard: optional additions are non-breaking):
  `schematic.layout.probes?: Array<{ probeId, netId, x, y, color? }>` — scope
  probes dropped on nets. Editor geometry only; `netId` must be a declared net
  (error path `layout.probes.<i>.netId`), `x`/`y` place the on-canvas marker,
  `color` optionally pins a trace color. Adapters ignore `layout` on
  import/export, so this is round-trip-neutral for every engine.
- **2026-07-05** — issue #78 (epic #76, gated by spike #77), one ADDITIVE field
  with the first explicit **patch-level `irVersion` bump `0.1.0 → 0.1.1`**
  (ir-schema-guard: optional additions are non-breaking; prior `0.1.0` documents
  still validate because pre-1.0 patch differences are compatible):
  `component.education?` — read-only teaching metadata driving the editor "Learn"
  panel (#80) and the live "try it" knob (#81). Every sub-field is optional so
  partial authoring is valid and existing components stay valid untouched:
  - `summary?: string` — one-line plain-language description.
  - `gotchas?: string[]` — beginner traps, each a standalone sentence.
  - `keyFormula?: { display: string; variables: Record<string,string> }` —
    display-only formula + variable glossary. `display` is teaching TEXT, **never
    parsed or evaluated** (contrast `simModel.derivedParams`, which is); do not
    wire it into the compiler.
  - `paramNotes?: Record<string,string>` — per-parameter notes keyed by the
    component's own parameter names. Unknown keys are permitted (validator stays
    permissive; registry typo-checking lives in #79's content tests).
  - `interactiveHint?: { targetParam: string; targetComponentId?: string;
    observe: string; prompt: string }` — the single live knob. `targetParam`
    (required) is the parameter to expose as a slider; `observe` (required) the
    derived series to highlight; `targetComponentId?` optionally addresses a
    **series part** (the LED case, whose knob lives on the resistor) — omit it to
    wiggle the subject's own param; `prompt` frames the experiment.
  Adapters (KiCad/ngspice/firmware) ignore `education` entirely — it is human
  metadata, so this is round-trip-neutral for every engine. Full rationale and
  hand-authored LED + resistor content: `.context/findings/spike-77-education-ir.md`
  and ADR-0023.

  ```jsonc
  // === Additive — component with an education block (issue #78) ===
  {
    "irVersion": "0.1.1",
    "kind": "component",
    "id": "cmp_led_generic",
    "name": "LED",
    "category": "active",
    "pins": [
      { "id": "a", "name": "A", "electricalType": "passive" },
      { "id": "k", "name": "K", "electricalType": "passive" }
    ],
    "parameters": [],
    "simModel": { "engine": "ngspice", "template": "D{ref} {a} {k} DLED", "modelCard": ".model DLED D(IS=1e-14 N=2)" },
    "education": {
      "summary": "A one-way valve for current that glows when current flows the right way.",
      "gotchas": [
        "Polarity matters: current only flows anode (long leg, +) → cathode (short leg, −).",
        "An LED barely resists current on its own — always add a series resistor or it burns out."
      ],
      "keyFormula": {
        "display": "I = (V_supply − V_f) / R",
        "variables": {
          "I": "current through the LED; ~10–15 mA is a bright, safe indicator",
          "V_f": "forward voltage, set by the LED (~1.4–2 V), not by you",
          "R": "the series resistor — this is your brightness knob"
        }
      },
      "paramNotes": {},
      "interactiveHint": {
        "targetParam": "resistance",
        "targetComponentId": "cmp_resistor_generic",
        "observe": "brightness",
        "prompt": "Drag the series resistor down and watch the LED brighten — too low and the current gets dangerous."
      }
    },
    "provenance": { "source": "registry", "addedBy": "registry-curator", "at": "<iso8601>" }
  }
  ```
