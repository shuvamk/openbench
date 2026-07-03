import { describe, expect, it } from "vitest";
import { validateProject, validateSchematic } from "@openbench/ir-schema";
import { compileNetlist } from "@openbench/netlist-compiler";
import { getComponent } from "@openbench/registry";
import {
  createFromTemplate,
  duplicateBundle,
  TEMPLATE_OPTIONS,
  type TemplateKind,
} from "../lib/templates";

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
      expect(byId.get("V1")?.componentId).toBe("cmp_vsource_pulse");
      expect(byId.get("V1")?.parameterOverrides).toBeUndefined();
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
      expect(cards.some((c) => c.startsWith("VV1 ") && c.includes("PULSE("))).toBe(true);
      // the ground net maps to SPICE node 0
      expect(result.netlist.nodes.some((n) => n.spiceNode === "0")).toBe(true);
    });
  });

  describe("playground", () => {
    const bundle = createFromTemplate("playground", "Playground");
    const nets = bundle.schematic.nets;
    const find = (instanceId: string, pinId: string) =>
      nets.find((n) =>
        n.connections.some(
          (c) => c.instanceId === instanceId && c.pinId === pinId,
        ),
      );

    it("is a valid schematic with the interactive demo parts", () => {
      expect(validateProject(bundle.project)).toEqual({ valid: true, errors: [] });
      expect(validateSchematic(bundle.schematic)).toEqual({ valid: true, errors: [] });

      const byId = new Map(
        bundle.schematic.instances.map((i) => [i.instanceId, i]),
      );
      expect(byId.get("V1")?.componentId).toBe("cmp_vsource_dc");
      expect(byId.get("BTN1")?.componentId).toBe("cmp_pushbutton");
      expect(byId.get("R1")?.componentId).toBe("cmp_resistor_generic");
      expect(byId.get("R1")?.parameterOverrides?.resistance).toBe(220);
      expect(byId.get("D1")?.componentId).toBe("cmp_led_generic");
      expect(byId.get("POT1")?.componentId).toBe("cmp_potentiometer");
      expect(byId.get("LA1")?.componentId).toBe("cmp_lamp");
      expect(byId.get("SW1")?.componentId).toBe("cmp_switch_spst");
      expect(byId.get("M1")?.componentId).toBe("cmp_dc_motor");
      expect(
        bundle.schematic.instances.some((i) => i.componentId === "cmp_ground"),
      ).toBe(true);
    });

    it("wires branch A: 5V -> BTN1 -> R1 -> D1 -> GND", () => {
      expect(find("V1", "pos")).toBe(find("BTN1", "p1"));
      expect(find("BTN1", "p2")).toBe(find("R1", "p1"));
      expect(find("R1", "p2")).toBe(find("D1", "anode"));
      expect(find("D1", "cathode")).toBe(find("V1", "neg"));
    });

    it("wires branch B: POT1 across V1 with the wiper driving LA1 -> GND", () => {
      expect(find("POT1", "p1")).toBe(find("V1", "pos"));
      expect(find("POT1", "p2")).toBe(find("V1", "neg"));
      expect(find("POT1", "wiper")).toBe(find("LA1", "p1"));
      expect(find("LA1", "p2")).toBe(find("V1", "neg"));
    });

    it("wires branch C: 5V -> SW1 -> M1 -> GND", () => {
      expect(find("SW1", "p1")).toBe(find("V1", "pos"));
      expect(find("SW1", "p2")).toBe(find("M1", "p1"));
      expect(find("M1", "p2")).toBe(find("V1", "neg"));
    });

    it("puts the ground symbol on the ground net", () => {
      const gndInstance = bundle.schematic.instances.find(
        (i) => i.componentId === "cmp_ground",
      );
      expect(gndInstance).toBeDefined();
      expect(find(gndInstance!.instanceId, "gnd")).toBe(find("V1", "neg"));
    });

    it("lays out three separated branch rows on a grid, source left, ground at bottom", () => {
      const layout = bundle.schematic.layout;
      expect(layout).toBeDefined();
      const pos = (instanceId: string) => {
        const p = layout?.instances[instanceId];
        expect(p, `layout for ${instanceId}`).toBeDefined();
        return p!;
      };

      for (const instance of bundle.schematic.instances) {
        const p = pos(instance.instanceId);
        // tidy grid: every coordinate snaps to the 20px editor grid
        expect(p.x % 20, `${instance.instanceId}.x on grid`).toBe(0);
        expect(p.y % 20, `${instance.instanceId}.y on grid`).toBe(0);
      }

      // the source sits alone on the left edge
      const others = bundle.schematic.instances.filter(
        (i) => i.instanceId !== "V1",
      );
      for (const other of others) {
        expect(pos("V1").x).toBeLessThan(pos(other.instanceId).x);
      }

      // each branch is a horizontal row...
      expect(pos("BTN1").y).toBe(pos("R1").y);
      expect(pos("R1").y).toBe(pos("D1").y);
      expect(pos("POT1").y).toBe(pos("LA1").y);
      expect(pos("SW1").y).toBe(pos("M1").y);
      // ...and the three rows are visually separated
      const rows = [pos("BTN1").y, pos("POT1").y, pos("SW1").y];
      expect(new Set(rows).size).toBe(3);

      // the ground symbol anchors a rail below everything else
      const gndInstance = bundle.schematic.instances.find(
        (i) => i.componentId === "cmp_ground",
      )!;
      for (const instance of bundle.schematic.instances) {
        if (instance.instanceId === gndInstance.instanceId) continue;
        expect(pos(gndInstance.instanceId).y).toBeGreaterThan(
          pos(instance.instanceId).y,
        );
      }
    });

    it("compiles via the netlist compiler with the registry resolver", () => {
      const result = compileNetlist(bundle.schematic, getComponent);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const cards = result.netlist.elements.map((e) => e.spiceCard);
      expect(cards.some((c) => c.startsWith("VV1 ") && c.includes("DC 5"))).toBe(true);
      expect(cards.some((c) => c.startsWith("RBTN1 "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RR1 ") && c.includes("220"))).toBe(true);
      expect(cards.some((c) => c.startsWith("DD1 "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RPOT1A "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RPOT1B "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RLA1 "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RSW1 "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RM1 "))).toBe(true);
      // the LED brings its model card along
      expect(cards.some((c) => c.startsWith(".model DLED "))).toBe(true);
      // the ground net maps to SPICE node 0
      expect(result.netlist.nodes.some((n) => n.spiceNode === "0")).toBe(true);
      // only the ground symbol is skipped — everything else simulates
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("no simulation model");
    });
  });

  describe("half-wave-rectifier", () => {
    const bundle = createFromTemplate("half-wave-rectifier", "Rectifier");
    const nets = bundle.schematic.nets;
    const find = (instanceId: string, pinId: string) =>
      nets.find((n) =>
        n.connections.some(
          (c) => c.instanceId === instanceId && c.pinId === pinId,
        ),
      );

    it("is a valid schematic built from the AC source, Schottky, smoothing cap and load", () => {
      expect(validateProject(bundle.project)).toEqual({ valid: true, errors: [] });
      expect(validateSchematic(bundle.schematic)).toEqual({ valid: true, errors: [] });

      const byId = new Map(
        bundle.schematic.instances.map((i) => [i.instanceId, i]),
      );
      expect(byId.get("V1")?.componentId).toBe("cmp_vsource_sin");
      expect(byId.get("D1")?.componentId).toBe("cmp_schottky_diode");
      expect(byId.get("C1")?.componentId).toBe("cmp_capacitor_generic");
      expect(byId.get("C1")?.parameterOverrides?.capacitance).toBeCloseTo(10e-6, 12);
      expect(byId.get("RL")?.componentId).toBe("cmp_resistor_generic");
      expect(byId.get("RL")?.parameterOverrides?.resistance).toBe(1000);
      expect(
        bundle.schematic.instances.some((i) => i.componentId === "cmp_ground"),
      ).toBe(true);
    });

    it("wires AC -> D1 -> VOUT(cap||load) -> GND", () => {
      // V1+ drives the diode anode
      expect(find("V1", "pos")).toBe(find("D1", "a"));
      // rectified output shared by the cathode, the smoothing cap and the load
      expect(find("D1", "k")).toBe(find("C1", "p1"));
      expect(find("D1", "k")).toBe(find("RL", "p1"));
      // return rail: cap, load, source- and the ground symbol
      expect(find("C1", "p2")).toBe(find("V1", "neg"));
      expect(find("RL", "p2")).toBe(find("V1", "neg"));
    });

    it("puts the ground symbol on the return net", () => {
      const gndInstance = bundle.schematic.instances.find(
        (i) => i.componentId === "cmp_ground",
      );
      expect(gndInstance).toBeDefined();
      expect(find(gndInstance!.instanceId, "gnd")).toBe(find("V1", "neg"));
    });

    it("has grid-snapped layout positions for every instance", () => {
      const layout = bundle.schematic.layout;
      expect(layout).toBeDefined();
      for (const instance of bundle.schematic.instances) {
        const pos = layout?.instances[instance.instanceId];
        expect(pos, `layout for ${instance.instanceId}`).toBeDefined();
        expect(pos!.x % 20, `${instance.instanceId}.x on grid`).toBe(0);
        expect(pos!.y % 20, `${instance.instanceId}.y on grid`).toBe(0);
      }
    });

    it("compiles to a SIN source, a Schottky diode with its model card, cap and load", () => {
      const result = compileNetlist(bundle.schematic, getComponent);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cards = result.netlist.elements.map((e) => e.spiceCard);
      expect(cards.some((c) => c.startsWith("VV1 ") && c.includes("SIN("))).toBe(true);
      expect(cards.some((c) => c.startsWith("DD1 ") && c.includes("DSCHOTTKY"))).toBe(true);
      expect(cards.some((c) => c.startsWith(".model DSCHOTTKY "))).toBe(true);
      expect(cards.some((c) => c.startsWith("CC1 "))).toBe(true);
      expect(cards.some((c) => c.startsWith("RRL ") && c.includes("1000"))).toBe(true);
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

describe("TEMPLATE_OPTIONS", () => {
  it("offers a labelled, described option for every buildable template kind", () => {
    // Guards against the drift that hid the playground from the picker:
    // every option must build a valid bundle, and there are no options that
    // reference a kind createFromTemplate can't produce.
    for (const option of TEMPLATE_OPTIONS) {
      expect(option.label.length, `label for ${option.value}`).toBeGreaterThan(0);
      expect(option.description.length, `description for ${option.value}`).toBeGreaterThan(0);
      const bundle = createFromTemplate(option.value, `${option.label} test`);
      expect(
        validateSchematic(bundle.schematic),
        `${option.value} builds a valid schematic`,
      ).toEqual({ valid: true, errors: [] });
    }
  });

  it("surfaces every template kind exactly once (no hidden templates, no duplicates)", () => {
    const kinds: TemplateKind[] = [
      "blank",
      "rc-lowpass",
      "esp32-blink",
      "playground",
      "half-wave-rectifier",
    ];
    const optionValues = TEMPLATE_OPTIONS.map((o) => o.value).sort();
    expect(optionValues).toEqual([...kinds].sort());
    expect(new Set(optionValues).size).toBe(optionValues.length);
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
