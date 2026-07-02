import { describe, expect, it } from "vitest";
import { validateNetlist } from "../src/index";

/**
 * Acceptance tests for issue #5 — the `netlist` IR kind.
 * Mirrors the netlist example in .context/interchange-format.md.
 */
const minimalNetlist = {
  irVersion: "0.1.0",
  kind: "netlist",
  id: "net_00000000000000000000000000000000",
  schematicId: "sch_00000000000000000000000000000000",
  nodes: [{ netId: "net_vcc", spiceNode: "1" }],
  elements: [{ instanceId: "R1", spiceCard: "R1 1 0 4700" }],
  derivedBy: "netlist-compiler@0.1.0",
  provenance: { source: "ir-core", at: "2026-07-02T00:00:00Z" },
};

const clone = () => structuredClone(minimalNetlist) as Record<string, any>;

describe("validateNetlist", () => {
  it("accepts the canonical minimal netlist", () => {
    const result = validateNetlist(minimalNetlist);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an id not matching net_*", () => {
    const doc = clone();
    doc.id = "netlist_1";
    const result = validateNetlist(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("rejects nodes missing a spiceNode", () => {
    const doc = clone();
    delete doc.nodes[0].spiceNode;
    const result = validateNetlist(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "nodes.0.spiceNode")).toBe(true);
  });

  it("rejects elements missing a spiceCard", () => {
    const doc = clone();
    delete doc.elements[0].spiceCard;
    const result = validateNetlist(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "elements.0.spiceCard")).toBe(true);
  });

  it("requires derivedBy", () => {
    const doc = clone();
    delete doc.derivedBy;
    const result = validateNetlist(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "derivedBy")).toBe(true);
  });

  it("rejects a schematicId not matching sch_*", () => {
    const doc = clone();
    doc.schematicId = "bogus";
    const result = validateNetlist(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "schematicId")).toBe(true);
  });
});
