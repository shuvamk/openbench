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
   `"irVersion": "0.1.0"`. Breaking changes bump minor until 1.0, then major.
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
    }
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
