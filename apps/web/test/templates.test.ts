import { describe, expect, it } from "vitest";
import { validateProject, validateSchematic } from "@openbench/ir-schema";
import { compileNetlist } from "@openbench/netlist-compiler";
import { getComponent } from "@openbench/registry";
import { createFromTemplate, duplicateBundle } from "../lib/templates";

describe("createFromTemplate", () => {
  it("creates a valid blank project bundle", () => {
    const bundle = createFromTemplate("blank", "My blank board");

    expect(validateProject(bundle.project)).toEqual({ valid: true, errors: [] });
    expect(validateSchematic(bundle.schematic)).toEqual({ valid: true, errors: [] });
    expect(bundle.project.name).toBe("My blank board");
    expect(bundle.project.id).toMatch(/^proj_[a-z0-9_-]+$/);
    expect(bundle.schematic.id).toMatch(/^sch_[a-z0-9_-]+$/);
    expect(bundle.project.schematicId).toBe(bundle.schematic.id);
    expect(bundle.schematic.projectId).toBe(bundle.project.id);
    expect(bundle.schematic.instances).toEqual([]);
    expect(bundle.schematic.nets).toEqual([]);
  });

  it("generates unique ids on every call", () => {
    const a = createFromTemplate("blank", "A");
    const b = createFromTemplate("blank", "B");
    expect(a.project.id).not.toBe(b.project.id);
    expect(a.schematic.id).not.toBe(b.schematic.id);
  });

  describe("rc-lowpass", () => {
    const bundle = createFromTemplate("rc-lowpass", "RC filter");

    it("is a valid schematic with the expected parts and values", () => {
      expect(validateProject(bundle.project)).toEqual({ valid: true, errors: [] });
      expect(validateSchematic(bundle.schematic)).toEqual({ valid: true, errors: [] });

      const byId = new Map(
        bundle.schematic.instances.map((i) => [i.instanceId, i]),
      );
      expect(byId.get("V1")?.componentId).toBe("cmp_vsource_dc");
      expect(byId.get("R1")?.componentId).toBe("cmp_resistor_generic");
      expect(byId.get("R1")?.parameterOverrides?.resistance).toBe(4700);
      expect(byId.get("C1")?.componentId).toBe("cmp_capacitor_generic");
      expect(byId.get("C1")?.parameterOverrides?.capacitance).toBeCloseTo(100e-9, 12);
      expect(byId.get("GND1")?.componentId).toBe("cmp_ground");
    });

    it("wires vin -> R1 -> vout -> C1 -> gnd", () => {
      const nets = bundle.schematic.nets;
      const find = (instanceId: string, pinId: string) =>
        nets.find((n) =>
          n.connections.some(
            (c) => c.instanceId === instanceId && c.pinId === pinId,
          ),
        );
      // V1+ and R1.p1 share vin
      expect(find("V1", "pos")).toBe(find("R1", "p1"));
      // R1.p2 and C1.p1 share vout
      expect(find("R1", "p2")).toBe(find("C1", "p1"));
      // C1.p2, V1- and the ground symbol share gnd
      expect(find("C1", "p2")).toBe(find("V1", "neg"));
      expect(find("C1", "p2")).toBe(find("GND1", "gnd"));
    });

    it("has layout positions for every instance", () => {
      const layout = bundle.schematic.layout;
      expect(layout).toBeDefined();
      for (const instance of bundle.schematic.instances) {
        const pos = layout?.instances[instance.instanceId];
        expect(pos, `layout for ${instance.instanceId}`).toBeDefined();
        expect(typeof pos?.x).toBe("number");
        expect(typeof pos?.y).toBe("number");
      }
    });

    it("compiles via the netlist compiler with the registry resolver", () => {
      const result = compileNetlist(bundle.schematic, getComponent);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cards = result.netlist.elements.map((e) => e.spiceCard);
      expect(cards.some((c) => c.startsWith("RR1 ") && c.includes("4700"))).toBe(true);
      expect(cards.some((c) => c.startsWith("CC1 "))).toBe(true);
      expect(cards.some((c) => c.startsWith("VV1 ") && c.includes("DC"))).toBe(true);
      // the ground net maps to SPICE node 0
      expect(result.netlist.nodes.some((n) => n.spiceNode === "0")).toBe(true);
    });
  });

  describe("esp32-blink", () => {
    const bundle = createFromTemplate("esp32-blink", "Blink");

    it("is a valid schematic with MCU, resistor, LED and ground", () => {
      expect(validateProject(bundle.project)).toEqual({ valid: true, errors: [] });
      expect(validateSchematic(bundle.schematic)).toEqual({ valid: true, errors: [] });

      const byId = new Map(
        bundle.schematic.instances.map((i) => [i.instanceId, i]),
      );
      expect(byId.get("U1")?.componentId).toBe("cmp_esp32_devkit");
      expect(byId.get("R1")?.componentId).toBe("cmp_resistor_generic");
      expect(byId.get("R1")?.parameterOverrides?.resistance).toBe(220);
      expect(byId.get("D1")?.componentId).toBe("cmp_led_generic");
      expect(
        bundle.schematic.instances.some((i) => i.componentId === "cmp_ground"),
      ).toBe(true);
    });

    it("wires GPIO2 -> R1 -> LED -> GND", () => {
      const nets = bundle.schematic.nets;
      const find = (instanceId: string, pinId: string) =>
        nets.find((n) =>
          n.connections.some(
            (c) => c.instanceId === instanceId && c.pinId === pinId,
          ),
        );
      expect(find("U1", "GPIO2")).toBe(find("R1", "p1"));
      expect(find("R1", "p2")).toBe(find("D1", "anode"));
      const gndNet = find("D1", "cathode");
      expect(gndNet).toBeDefined();
      expect(gndNet).toBe(find("U1", "GND"));
      expect(
        gndNet?.connections.some(
          (c) =>
            bundle.schematic.instances.find((i) => i.instanceId === c.instanceId)
              ?.componentId === "cmp_ground",
        ),
      ).toBe(true);
    });

    it("has layout positions for every instance", () => {
      const layout = bundle.schematic.layout;
      expect(layout).toBeDefined();
      for (const instance of bundle.schematic.instances) {
        expect(
          layout?.instances[instance.instanceId],
          `layout for ${instance.instanceId}`,
        ).toBeDefined();
      }
    });
  });
});

describe("duplicateBundle", () => {
  it("clones a bundle with fresh ids and the given name", () => {
    const original = createFromTemplate("rc-lowpass", "Original");
    const copy = duplicateBundle(original, "Original copy");

    expect(copy.project.name).toBe("Original copy");
    expect(copy.project.id).not.toBe(original.project.id);
    expect(copy.schematic.id).not.toBe(original.schematic.id);
    expect(copy.schematic.projectId).toBe(copy.project.id);
    expect(copy.project.schematicId).toBe(copy.schematic.id);
    expect(validateProject(copy.project)).toEqual({ valid: true, errors: [] });
    expect(validateSchematic(copy.schematic)).toEqual({ valid: true, errors: [] });
    // same circuit content
    expect(copy.schematic.instances).toEqual(original.schematic.instances);
    expect(copy.schematic.nets).toEqual(original.schematic.nets);
    // no mutation of the original
    expect(original.project.name).toBe("Original");
  });
});
