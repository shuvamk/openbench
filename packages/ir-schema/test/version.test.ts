import { describe, expect, it } from "vitest";
import { IR_VERSION, isSupportedIrVersion, validateComponent } from "../src/index";

/**
 * Issue #78 — the optional `education` block is additive/read-only metadata, so
 * per the pre-1.0 versioning rule (spec §principles; version.ts) it is a
 * PATCH-level bump: 0.1.0 → 0.1.1. Patch differences are compatible, so prior
 * 0.1.0 documents keep validating unchanged; a minor bump would have been breaking.
 */
describe("IR version compatibility (issue #78 patch bump)", () => {
  it("is at patch level 0.1.1", () => {
    expect(IR_VERSION).toBe("0.1.1");
  });

  it("accepts prior 0.1.0 documents (pre-1.0 patch differences are compatible)", () => {
    expect(isSupportedIrVersion("0.1.0")).toBe(true);
    expect(isSupportedIrVersion("0.1.1")).toBe(true);
  });

  it("still rejects a different minor version as breaking", () => {
    expect(isSupportedIrVersion("0.2.0")).toBe(false);
    expect(isSupportedIrVersion("1.1.1")).toBe(false);
  });

  it("validates a legacy 0.1.0 component carrying the new education block", () => {
    const legacyWithEducation = {
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
      provenance: { source: "registry", addedBy: "registry-curator", at: "2026-07-02T00:00:00Z" },
      education: { summary: "Limits how much current flows." },
    };
    const result = validateComponent(legacyWithEducation);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
