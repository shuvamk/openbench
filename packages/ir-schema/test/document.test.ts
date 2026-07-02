import { describe, expect, it } from "vitest";
import { irDocumentSchema, validateDocument } from "../src/index";

/**
 * Acceptance tests for issue #5 — `irDocumentSchema` (discriminated union on
 * `kind` over all six kinds) and the `validateDocument` dispatcher.
 */
const componentDoc = {
  irVersion: "0.1.0",
  kind: "component",
  id: "cmp_resistor_generic",
  name: "Resistor",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  provenance: { source: "registry", at: "2026-07-02T00:00:00Z" },
};

const schematicDoc = {
  irVersion: "0.1.0",
  kind: "schematic",
  id: "sch_00000000000000000000000000000000",
  projectId: "proj_00000000000000000000000000000000",
  instances: [{ instanceId: "R1", componentId: "cmp_resistor_generic" }],
  nets: [{ netId: "net_vcc", connections: [{ instanceId: "R1", pinId: "p1" }] }],
  provenance: { source: "kicad-adapter", at: "2026-07-02T00:00:00Z" },
};

describe("validateDocument", () => {
  it("dispatches on kind and accepts a valid component", () => {
    const result = validateDocument(componentDoc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("dispatches on kind and accepts a valid schematic", () => {
    const result = validateDocument(schematicDoc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("runs kind-specific refinements through the union (duplicate instanceIds)", () => {
    const doc = structuredClone(schematicDoc) as Record<string, any>;
    doc.instances.push({ instanceId: "R1", componentId: "cmp_resistor_generic" });
    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "instances.1.instanceId")).toBe(true);
  });

  it("rejects an unknown kind with a kind-path error", () => {
    const result = validateDocument({ ...componentDoc, kind: "pcbLayout" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "kind")).toBe(true);
  });

  it("rejects a non-object document", () => {
    const result = validateDocument("not a document");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("exposes irDocumentSchema for direct zod use", () => {
    expect(irDocumentSchema.safeParse(componentDoc).success).toBe(true);
    expect(irDocumentSchema.safeParse({ ...componentDoc, kind: "nope" }).success).toBe(false);
  });
});
