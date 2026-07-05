import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import {
  buildBom,
  bomToCsv,
  parseBomCsv,
  type BomLine,
} from "../lib/bom";

/**
 * R1/R2 = 4.7k, R3 = 10k (grouped by value), plus a virtual source + ground and
 * one instance of a part that isn't in the registry (unknown, must not be dropped).
 */
function mixedSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_bom",
    projectId: "proj_bom",
    instances: [
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
      { instanceId: "R2", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
      { instanceId: "R3", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 10000 } },
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "GND1", componentId: "cmp_ground" },
      { instanceId: "X1", componentId: "cmp_mystery_widget" },
    ],
    nets: [],
    layout: { instances: {} },
    provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
  };
}

function resistorLines(bom: { lines: BomLine[] }): BomLine[] {
  return bom.lines.filter((l) => l.componentId === "cmp_resistor_generic");
}

describe("buildBom", () => {
  it("groups resistors by resolved value: two 4.7k + one 10k → 2 lines (qty 2 and 1)", () => {
    const bom = buildBom(mixedSchematic());
    const rLines = resistorLines(bom);
    expect(rLines).toHaveLength(2);

    const line47k = rLines.find((l) => l.value === "4.7k")!;
    const line10k = rLines.find((l) => l.value === "10k")!;
    expect(line47k).toBeDefined();
    expect(line10k).toBeDefined();
    expect(line47k.qty).toBe(2);
    expect(line47k.refs).toEqual(["R1", "R2"]);
    expect(line10k.qty).toBe(1);
    expect(line10k.refs).toEqual(["R3"]);
    // Purchasable parts carry a footprint.
    expect(line47k.footprint).toBe("Resistor_SMD:R_0603_1608Metric");
  });

  it("lists registry-unknown instances with an unknown flag instead of dropping them", () => {
    const bom = buildBom(mixedSchematic());
    const mystery = bom.lines.find((l) => l.componentId === "cmp_mystery_widget");
    expect(mystery).toBeDefined();
    expect(mystery!.unknown).toBe(true);
    expect(mystery!.refs).toEqual(["X1"]);
    expect(mystery!.footprint).toBeUndefined();
  });

  it("routes footprint-less parts (ground, source) to the virtual section, not the purchasable BOM", () => {
    const bom = buildBom(mixedSchematic());
    const virtualIds = bom.virtual.map((l) => l.componentId).sort();
    expect(virtualIds).toEqual(["cmp_ground", "cmp_vsource_dc"]);

    // They are excluded from the purchasable lines...
    expect(bom.lines.some((l) => l.componentId === "cmp_ground")).toBe(false);
    expect(bom.lines.some((l) => l.componentId === "cmp_vsource_dc")).toBe(false);
    // ...but still counted (qty 1 each).
    for (const line of bom.virtual) expect(line.qty).toBe(1);
  });

  it("resolves the value from the parameter override, falling back to the component default", () => {
    const schematic = mixedSchematic();
    schematic.instances.push({
      instanceId: "R4",
      componentId: "cmp_resistor_generic",
      // no override → default 1000 → "1k"
    });
    const bom = buildBom(schematic);
    const line1k = resistorLines(bom).find((l) => l.value === "1k");
    expect(line1k).toBeDefined();
    expect(line1k!.refs).toEqual(["R4"]);
  });
});

describe("BOM CSV", () => {
  it("round-trips: parsing the emitted CSV yields the same rows", () => {
    const bom = buildBom(mixedSchematic());
    const csv = bomToCsv(bom.lines);
    const parsed = parseBomCsv(csv);

    const expected = bom.lines.map((l) => ({
      refs: l.refs,
      componentId: l.componentId,
      value: l.value,
      qty: l.qty,
      footprint: l.footprint,
    }));
    expect(parsed).toEqual(expected);
  });

  it("quotes fields containing the delimiter and preserves multi-ref cells", () => {
    const bom = buildBom(mixedSchematic());
    const csv = bomToCsv(bom.lines);
    // The 4.7k line joins R1;R2 into one CSV cell.
    expect(csv).toContain("R1;R2");
    // Header row present.
    expect(csv.split(/\r?\n/)[0]).toBe("ref,componentId,value,qty,footprint");
  });
});
