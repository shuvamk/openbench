import { describe, expect, it } from "vitest";
import { validateDocument } from "../src/index";

/**
 * Spec-sync guard: the six fixtures below mirror the six JSONC examples in
 * .context/interchange-format.md §"Core schemas" VERBATIM, with only the
 * placeholder substitutions the spec allows:
 *   <uuid>    -> 00000000000000000000000000000000
 *   <iso8601> -> "2026-07-02T00:00:00Z"
 *   s3://...  -> kept as-is (literally "s3://.../<file>")
 * If a schema change makes any of these fail, either the code or the doc has
 * drifted — fix whichever is wrong and update BOTH together (ir-schema-guard).
 */

// .context/interchange-format.md §Core schemas — "=== Component (registry unit) ==="
const componentExample = {
  irVersion: "0.1.0",
  kind: "component",
  id: "cmp_resistor_generic",
  name: "Resistor",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "resistance", unit: "ohm", default: 1000, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {resistance}",
  },
  footprint: { kicadRef: "Resistor_SMD:R_0603_1608Metric" },
  provenance: { source: "registry", addedBy: "registry-curator", at: "2026-07-02T00:00:00Z" },
};

// .context/interchange-format.md §Core schemas — "=== Schematic (a design instance) ==="
const schematicExample = {
  irVersion: "0.1.0",
  kind: "schematic",
  id: "sch_00000000000000000000000000000000",
  projectId: "proj_00000000000000000000000000000000",
  instances: [
    {
      instanceId: "R1",
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: 4700 },
    },
    { instanceId: "U1", componentId: "cmp_esp32_devkit" },
  ],
  nets: [
    {
      netId: "net_vcc",
      name: "VCC",
      connections: [
        { instanceId: "R1", pinId: "p1" },
        { instanceId: "U1", pinId: "3V3" },
      ],
    },
  ],
  layout: {
    instances: {
      R1: { x: 120, y: 80, rotation: 0 },
      U1: { x: 320, y: 160 },
    },
    probes: [{ probeId: "prb_1", netId: "net_vcc", x: 200, y: 120 }],
  },
  provenance: { source: "kicad-adapter", at: "2026-07-02T00:00:00Z" },
};

// .context/interchange-format.md §Core schemas — "=== Netlist (derived, engine-agnostic, feeds simulators) ==="
const netlistExample = {
  irVersion: "0.1.0",
  kind: "netlist",
  id: "net_00000000000000000000000000000000",
  schematicId: "sch_00000000000000000000000000000000",
  nodes: [{ netId: "net_vcc", spiceNode: "1" }],
  elements: [{ instanceId: "R1", spiceCard: "R1 1 0 4700" }],
  derivedBy: "netlist-compiler@0.1.0",
  provenance: { source: "ir-core", at: "2026-07-02T00:00:00Z" },
};

// .context/interchange-format.md §Core schemas — "=== Simulation Run (config + result, one document per run) ==="
const simulationRunExample = {
  irVersion: "0.1.0",
  kind: "simulationRun",
  id: "sim_00000000000000000000000000000000",
  netlistId: "net_00000000000000000000000000000000",
  engine: "ngspice",
  mode: "transient",
  config: { duration: "10ms", step: "1us" },
  status: "completed",
  results: {
    format: "waveform-v1",
    signals: [{ netId: "net_vcc", unit: "V", samples: "s3://.../vcc.bin" }],
  },
  logs: "s3://.../sim.log",
  provenance: { source: "mcp-sim-ngspice", at: "2026-07-02T00:00:00Z" },
};

// .context/interchange-format.md §Core schemas — "=== Firmware Target (build + flash-to-virtual-MCU) ==="
const firmwareTargetExample = {
  irVersion: "0.1.0",
  kind: "firmwareTarget",
  id: "fw_00000000000000000000000000000000",
  projectId: "proj_00000000000000000000000000000000",
  mcu: "esp32dev",
  framework: "arduino",
  sourceRef: "git+<repo>#<path>",
  buildStatus: "success",
  artifact: { binary: "s3://.../firmware.bin", elf: "s3://.../firmware.elf" },
  flashTarget: {
    kind: "virtual",
    engine: "renode",
    machineConfig: "s3://.../machine.repl",
  },
  provenance: { source: "mcp-firmware-platformio", at: "2026-07-02T00:00:00Z" },
};

// .context/interchange-format.md §Core schemas — "=== Project (root object linking everything) ==="
const projectExample = {
  irVersion: "0.1.0",
  kind: "project",
  id: "proj_00000000000000000000000000000000",
  name: "Blink with adjustable brightness",
  schematicId: "sch_00000000000000000000000000000000",
  firmwareTargetId: "fw_00000000000000000000000000000000",
  latestSimulationRunId: "sim_00000000000000000000000000000000",
  collaborators: [],
  provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
};

const examples = [
  ["component", componentExample],
  ["schematic", schematicExample],
  ["netlist", netlistExample],
  ["simulationRun", simulationRunExample],
  ["firmwareTarget", firmwareTargetExample],
  ["project", projectExample],
] as const;

describe("spec-sync: interchange-format.md examples parse via validateDocument", () => {
  it.each(examples)("%s example from the spec doc validates", (_kind, example) => {
    const result = validateDocument(example);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

// .context/interchange-format.md §"Additive fields" — subcircuit component (issue #34).
// A subckt part pairs an `X{ref} … NAME` call template with a `.subckt … .ends`
// definition block (deduped by content when compiled).
const subcktComponentExample = {
  irVersion: "0.1.0",
  kind: "component",
  id: "cmp_opamp_ideal",
  name: "Ideal Op-Amp",
  category: "active",
  pins: [
    { id: "inp", name: "IN+", electricalType: "input" },
    { id: "inn", name: "IN-", electricalType: "input" },
    { id: "out", name: "OUT", electricalType: "output" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "X{ref} {inp} {inn} {out} OPAMP",
    subckt: ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP",
  },
  provenance: { source: "registry", addedBy: "registry-curator", at: "2026-07-02T00:00:00Z" },
};

describe("spec-sync: subcircuit component example (issue #34)", () => {
  it("the subckt component example from the spec doc validates", () => {
    const result = validateDocument(subcktComponentExample);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

// .context/interchange-format.md §"Additive fields" — ngspice ac/dcSweep modes
// (issue #36). Mode is a documented per-adapter free string; AC runs carry
// dB/deg magnitude+phase over a frequency axis, DC-sweep runs put the swept
// source on the x-axis.
const acRunExample = {
  irVersion: "0.1.0",
  kind: "simulationRun",
  id: "sim_00000000000000000000000000000000",
  netlistId: "net_00000000000000000000000000000000",
  engine: "ngspice",
  mode: "ac",
  config: { sweep: "dec", points: 10, fStart: "1", fStop: "1meg" },
  status: "completed",
  results: {
    format: "waveform-v1",
    signals: [
      { netId: "net_vout", unit: "dB", samples: "s3://.../vout.mag.bin" },
      { netId: "net_vout", unit: "deg", samples: "s3://.../vout.phase.bin" },
      { netId: "frequency", unit: "Hz", samples: "s3://.../freq.bin" },
    ],
  },
  provenance: { source: "mcp-sim-ngspice", at: "2026-07-02T00:00:00Z" },
};

const dcSweepRunExample = {
  irVersion: "0.1.0",
  kind: "simulationRun",
  id: "sim_00000000000000000000000000000000",
  netlistId: "net_00000000000000000000000000000000",
  engine: "ngspice",
  mode: "dcSweep",
  config: { source: "V1", start: 0, stop: 5, step: 0.1 },
  status: "completed",
  results: {
    format: "waveform-v1",
    signals: [
      { netId: "net_vout", unit: "V", samples: "s3://.../vout.bin" },
      { netId: "V1", unit: "V", samples: "s3://.../sweep.bin" },
    ],
  },
  provenance: { source: "mcp-sim-ngspice", at: "2026-07-02T00:00:00Z" },
};

describe("spec-sync: ngspice ac + dcSweep run examples (issue #36)", () => {
  it.each([
    ["ac", acRunExample],
    ["dcSweep", dcSweepRunExample],
  ] as const)("the %s run example from the spec doc validates", (_mode, example) => {
    const result = validateDocument(example);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
