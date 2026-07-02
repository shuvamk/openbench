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
    "template": "R{ref} {p1} {p2} {resistance}"
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
