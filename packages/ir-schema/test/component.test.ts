import { describe, expect, it } from "vitest";
import { validateComponent } from "../src/index";

/**
 * Acceptance tests for issue #1 — the `component` IR kind.
 * `minimalResistor` is the canonical cmp_resistor_generic example from
 * .context/interchange-format.md; if the doc and this fixture drift, the
 * spec-sync test (spec-sync.test.ts) catches it.
 */
const minimalResistor = {
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

const clone = () => structuredClone(minimalResistor) as Record<string, unknown>;

describe("validateComponent", () => {
  it("accepts the canonical minimal resistor", () => {
    const result = validateComponent(minimalResistor);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an unsupported irVersion", () => {
    const doc = clone();
    doc.irVersion = "9.9.9";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "irVersion")).toBe(true);
  });

  it("rejects a component without pins", () => {
    const doc = clone();
    delete doc.pins;
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("pins"))).toBe(true);
  });

  it("rejects duplicate pin ids", () => {
    const doc = clone();
    (doc.pins as Array<{ id: string }>)[1]!.id = "p1";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("duplicate pin id"))).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const doc = clone();
    doc.kind = "componentX";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "kind")).toBe(true);
  });

  it("rejects a simModel template referencing an undeclared parameter", () => {
    const doc = clone();
    (doc.simModel as { template: string }).template = "R{ref} {p1} {p2} {capacitance}";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("capacitance"))).toBe(true);
  });

  it("accepts an optional simModel.modelCard SPICE .model line (issue #5 additive field)", () => {
    const doc = clone();
    (doc.simModel as Record<string, unknown>).modelCard = ".model DLED D(IS=1e-14)";
    const result = validateComponent(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string simModel.modelCard", () => {
    const doc = clone();
    (doc.simModel as Record<string, unknown>).modelCard = 42;
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "simModel.modelCard")).toBe(true);
  });

  it("rejects a component id not matching cmp_*", () => {
    const doc = clone();
    doc.id = "resistor_generic";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });
});
