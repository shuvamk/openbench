import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { IR_VERSION, JSON_SCHEMA_DIALECT, toJsonSchema } from "../src/index";

/**
 * Acceptance tests for issue #171 — a language-neutral JSON Schema export of
 * the IR (draft-2020-12) so non-TypeScript consumers (agents, CI, third-party
 * tools) validate documents against the same canonical contract.
 *
 * These fixtures are the canonical minimal example per kind, mirroring the
 * per-kind validator tests; the spec-sync test guards them against drift.
 */
const fixtures = {
  component: {
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
    simModel: { engine: "ngspice", template: "R{ref} {p1} {p2} {resistance}" },
    footprint: { kicadRef: "Resistor_SMD:R_0603_1608Metric" },
    provenance: { source: "registry", addedBy: "registry-curator", at: "2026-07-02T00:00:00Z" },
  },
  schematic: {
    irVersion: "0.1.0",
    kind: "schematic",
    id: "sch_00000000000000000000000000000000",
    projectId: "proj_00000000000000000000000000000000",
    instances: [
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
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
    provenance: { source: "kicad-adapter", at: "2026-07-02T00:00:00Z" },
  },
  netlist: {
    irVersion: "0.1.0",
    kind: "netlist",
    id: "net_00000000000000000000000000000000",
    schematicId: "sch_00000000000000000000000000000000",
    nodes: [{ netId: "net_vcc", spiceNode: "1" }],
    elements: [{ instanceId: "R1", spiceCard: "R1 1 0 4700" }],
    derivedBy: "netlist-compiler@0.1.0",
    provenance: { source: "ir-core", at: "2026-07-02T00:00:00Z" },
  },
  simulationRun: {
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
      signals: [{ netId: "net_vcc", unit: "V", samples: "s3://openbench-results/vcc.bin" }],
    },
    logs: "s3://openbench-results/sim.log",
    provenance: { source: "mcp-sim-ngspice", at: "2026-07-02T00:00:00Z" },
  },
  firmwareTarget: {
    irVersion: "0.1.0",
    kind: "firmwareTarget",
    id: "fw_00000000000000000000000000000000",
    projectId: "proj_00000000000000000000000000000000",
    mcu: "esp32dev",
    framework: "arduino",
    sourceRef: "git+https://github.com/openbench/blink#src",
    buildStatus: "success",
    artifact: {
      binary: "s3://openbench-artifacts/firmware.bin",
      elf: "s3://openbench-artifacts/firmware.elf",
    },
    flashTarget: {
      kind: "virtual",
      engine: "renode",
      machineConfig: "s3://openbench-artifacts/machine.repl",
    },
    provenance: { source: "mcp-firmware-platformio", at: "2026-07-02T00:00:00Z" },
  },
  project: {
    irVersion: "0.1.0",
    kind: "project",
    id: "proj_00000000000000000000000000000000",
    name: "Blink with adjustable brightness",
    schematicId: "sch_00000000000000000000000000000000",
    firmwareTargetId: "fw_00000000000000000000000000000000",
    latestSimulationRunId: "sim_00000000000000000000000000000000",
    collaborators: [],
    provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
  },
} as const;

/** Compile the emitted schema once with a standard draft-2020-12 validator. */
function compileValidator() {
  // `date-time` is an annotation-only format we don't assert on; `logger: false`
  // silences ajv's "unknown format" warnings without affecting validate.errors.
  const ajv = new Ajv2020({ strict: false, logger: false });
  return ajv.compile(toJsonSchema());
}

describe("toJsonSchema", () => {
  it("declares the draft-2020-12 dialect", () => {
    const schema = toJsonSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON_SCHEMA_DIALECT).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("carries the current IR_VERSION machine-readably", () => {
    const schema = toJsonSchema();
    expect(schema.irVersion).toBe(IR_VERSION);
  });

  it("compiles under a standard JSON-Schema validator (ajv)", () => {
    expect(() => compileValidator()).not.toThrow();
  });

  it.each(Object.entries(fixtures))("accepts the canonical %s fixture", (_kind, doc) => {
    const validate = compileValidator();
    const ok = validate(doc);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("rejects a document with a missing required field", () => {
    const validate = compileValidator();
    const doc = structuredClone(fixtures.component) as Record<string, unknown>;
    delete doc.pins;
    expect(validate(doc)).toBe(false);
  });

  it("rejects a document with a bad id prefix", () => {
    const validate = compileValidator();
    const doc = structuredClone(fixtures.component) as Record<string, unknown>;
    doc.id = "resistor_generic";
    expect(validate(doc)).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const validate = compileValidator();
    const doc = structuredClone(fixtures.component) as Record<string, unknown>;
    doc.kind = "gremlin";
    expect(validate(doc)).toBe(false);
  });
});
