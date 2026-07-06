import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { placeInstance } from "@openbench/schematic-ops";
import { applyToolCall, schematicDiff } from "../lib/copilot/tools";

/**
 * Issue #43 acceptance — the copilot's tool layer routes every AI action through
 * the SAME shared mutation implementation (`@openbench/schematic-ops`) as the
 * palette path. We assert on the IR, never the DOM.
 */

const AT = "2026-07-06T00:00:00Z";

function emptySchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_copilot",
    projectId: "proj_copilot",
    instances: [],
    nets: [],
    provenance: { source: "test", at: AT },
  };
}

describe("copilot tool router → shared schematic-ops mutations", () => {
  it("add_instance produces the identical IR mutation as the palette place path", () => {
    const schematic = emptySchematic();
    const resistor = getComponent("cmp_resistor_generic")!;
    const position = { x: 40, y: 40 };

    // Palette path: store.place() → placeInstance(schematic, component, pos).
    const palette = placeInstance(schematic, resistor, position);

    // Copilot path: a mock tool-call routed through the shared tool layer.
    const copilot = applyToolCall(schematic, {
      name: "add_instance",
      args: { componentId: "cmp_resistor_generic", position },
    });

    expect(copilot.schematic).toEqual(palette.schematic);
    expect(copilot.instanceId).toBe(palette.instanceId);
  });

  it("add_instance defaults to the origin when no position is supplied", () => {
    const schematic = emptySchematic();
    const capacitor = getComponent("cmp_capacitor_generic")!;
    const palette = placeInstance(schematic, capacitor, { x: 0, y: 0 });

    const copilot = applyToolCall(schematic, {
      name: "add_instance",
      args: { componentId: "cmp_capacitor_generic" },
    });

    expect(copilot.schematic).toEqual(palette.schematic);
  });

  it("rejects an unknown componentId rather than mutating the document", () => {
    const schematic = emptySchematic();
    expect(() =>
      applyToolCall(schematic, {
        name: "add_instance",
        args: { componentId: "cmp_not_a_real_part" },
      }),
    ).toThrow(/cmp_not_a_real_part/);
  });

  it("schematicDiff reports the instances a proposal adds", () => {
    const before = emptySchematic();
    const { schematic: after } = applyToolCall(before, {
      name: "add_instance",
      args: { componentId: "cmp_resistor_generic" },
    });

    const diff = schematicDiff(before, after);
    expect(diff.added).toEqual(["R1"]);
    expect(diff.removed).toEqual([]);
  });
});
