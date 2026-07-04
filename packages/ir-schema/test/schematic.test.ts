import { describe, expect, it } from "vitest";
import { validateSchematic } from "../src/index";

/**
 * Acceptance tests for issue #5 — the `schematic` IR kind.
 * Mirrors the schematic example in .context/interchange-format.md
 * (spec-sync.test.ts keeps the two from drifting).
 */
const minimalSchematic = {
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
  provenance: { source: "kicad-adapter", at: "2026-07-02T00:00:00Z" },
};

const clone = () => structuredClone(minimalSchematic) as Record<string, any>;

describe("validateSchematic", () => {
  it("accepts the canonical minimal schematic", () => {
    const result = validateSchematic(minimalSchematic);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an id not matching sch_*", () => {
    const doc = clone();
    doc.id = "schematic_1";
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("rejects a projectId not matching proj_*", () => {
    const doc = clone();
    doc.projectId = "project_1";
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "projectId")).toBe(true);
  });

  it("rejects duplicate instanceIds", () => {
    const doc = clone();
    doc.instances[1].instanceId = "R1";
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === "instances.1.instanceId" && e.message.includes("duplicate"),
      ),
    ).toBe(true);
  });

  it("rejects net connections referencing undeclared instanceIds", () => {
    const doc = clone();
    doc.nets[0].connections[1].instanceId = "U9";
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === "nets.0.connections.1.instanceId" && e.message.includes("U9"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate netIds", () => {
    const doc = clone();
    doc.nets.push(structuredClone(doc.nets[0]));
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path === "nets.1.netId" && e.message.includes("duplicate")),
    ).toBe(true);
  });

  it("rejects parameterOverrides values that are not number|string|boolean", () => {
    const doc = clone();
    doc.instances[0].parameterOverrides = { resistance: { nested: true } };
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path.startsWith("instances.0.parameterOverrides")),
    ).toBe(true);
  });

  it("accepts number, string, and boolean parameterOverrides", () => {
    const doc = clone();
    doc.instances[0].parameterOverrides = { resistance: 4700, tolerance: "1%", pullup: true };
    const result = validateSchematic(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts an optional layout block with geometry for declared instances", () => {
    const doc = clone();
    doc.layout = {
      instances: {
        R1: { x: 120, y: 80, rotation: 90 },
        U1: { x: 320, y: 160 },
      },
    };
    const result = validateSchematic(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects layout entries for unknown instanceIds", () => {
    const doc = clone();
    doc.layout = { instances: { R99: { x: 0, y: 0 } } };
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === "layout.instances.R99" && e.message.includes("R99"),
      ),
    ).toBe(true);
  });

  it("rejects a layout rotation outside 0|90|180|270", () => {
    const doc = clone();
    doc.layout = { instances: { R1: { x: 0, y: 0, rotation: 45 } } };
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("layout.instances.R1.rotation"))).toBe(
      true,
    );
  });

  it("accepts scope probes in the layout referencing declared nets (issue #37)", () => {
    const doc = clone();
    doc.layout = {
      instances: { R1: { x: 120, y: 80, rotation: 0 } },
      probes: [
        { probeId: "prb_1", netId: "net_vcc", x: 200, y: 120 },
        { probeId: "prb_2", netId: "net_vcc", x: 240, y: 90, color: "var(--ob-net-highlight)" },
      ],
    };
    const result = validateSchematic(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a probe referencing an undeclared netId (issue #37)", () => {
    const doc = clone();
    doc.layout = {
      instances: {},
      probes: [{ probeId: "prb_1", netId: "net_ghost", x: 0, y: 0 }],
    };
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === "layout.probes.0.netId" && e.message.includes("net_ghost"),
      ),
    ).toBe(true);
  });

  it("rejects a probe missing its netId (issue #37)", () => {
    const doc = clone();
    doc.layout = { instances: {}, probes: [{ probeId: "prb_1", x: 0, y: 0 }] };
    const result = validateSchematic(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("layout.probes.0.netId"))).toBe(true);
  });
});
