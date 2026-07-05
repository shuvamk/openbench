import { describe, expect, it } from "vitest";
import { IR_VERSION, validateSchematic, type Schematic } from "@openbench/ir-schema";
import { getComponent, registryComponents } from "@openbench/registry";

const resistorGeneric = getComponent("cmp_resistor_generic")!;
const capacitorGeneric = getComponent("cmp_capacitor_generic")!;
const ledGeneric = getComponent("cmp_led_generic")!;
const vsourceDc = getComponent("cmp_vsource_dc")!;
const ground = getComponent("cmp_ground")!;
const esp32Devkit = getComponent("cmp_esp32_devkit")!;
import {
  connectPins,
  deleteSelection,
  moveInstance,
  placeInstance,
  rotateInstance,
  setParameterOverride,
} from "../src/index";

/** Seeded rc-lowpass-style schematic used across the mutation tests. */
function rcLowpass(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_rc_lowpass",
    projectId: "proj_rc_lowpass",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
      { instanceId: "C1", componentId: "cmp_capacitor_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_in",
        name: "IN",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_out",
        name: "OUT",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "C1", pinId: "p1" },
        ],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "V1", pinId: "neg" },
          { instanceId: "C1", pinId: "p2" },
          { instanceId: "GND1", pinId: "gnd" },
        ],
      },
    ],
    layout: {
      instances: {
        V1: { x: 100, y: 200, rotation: 0 },
        R1: { x: 240, y: 120, rotation: 0 },
        C1: { x: 380, y: 200, rotation: 90 },
        GND1: { x: 100, y: 320, rotation: 0 },
      },
    },
    provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
  };
}

function expectValid(schematic: Schematic): void {
  const result = validateSchematic(schematic);
  expect(result.errors).toEqual([]);
  expect(result.valid).toBe(true);
}

describe("placeInstance", () => {
  it("generates R-prefixed ids for resistors, counting past existing ones", () => {
    const { schematic, instanceId } = placeInstance(rcLowpass(), resistorGeneric, { x: 55, y: 63 });
    expect(instanceId).toBe("R2");
    expect(schematic.instances.map((i) => i.instanceId)).toContain("R2");
    expectValid(schematic);
  });

  it("does not mutate the input schematic", () => {
    const before = rcLowpass();
    const snapshot = JSON.parse(JSON.stringify(before));
    placeInstance(before, resistorGeneric, { x: 0, y: 0 });
    expect(before).toEqual(snapshot);
  });

  it("snaps placement to the 10px grid and records layout", () => {
    const { schematic, instanceId } = placeInstance(rcLowpass(), resistorGeneric, { x: 54, y: 66 });
    expect(schematic.layout?.instances[instanceId]).toEqual({ x: 50, y: 70, rotation: 0 });
    expectValid(schematic);
  });

  it("uses category prefixes C/D/V/U/GND for the other registry parts", () => {
    let sch = rcLowpass();
    const expectations: Array<[typeof resistorGeneric, string]> = [
      [capacitorGeneric, "C2"],
      [ledGeneric, "D1"],
      [vsourceDc, "V2"],
      [esp32Devkit, "U1"],
      [ground, "GND2"],
    ];
    for (const [component, expected] of expectations) {
      const placed = placeInstance(sch, component, { x: 10, y: 10 });
      expect(placed.instanceId).toBe(expected);
      sch = placed.schematic;
      expectValid(sch);
    }
  });

  it("keeps generated ids unique across repeated placement", () => {
    let sch = rcLowpass();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const placed = placeInstance(sch, ledGeneric, { x: i * 20, y: 0 });
      expect(ids.has(placed.instanceId)).toBe(false);
      ids.add(placed.instanceId);
      sch = placed.schematic;
    }
    expectValid(sch);
  });

  it("records the componentId of the placed registry component", () => {
    const { schematic, instanceId } = placeInstance(rcLowpass(), ledGeneric, { x: 0, y: 0 });
    const instance = schematic.instances.find((i) => i.instanceId === instanceId);
    expect(instance?.componentId).toBe("cmp_led_generic");
    expect(getComponent(instance!.componentId)).toBe(ledGeneric);
  });
});

describe("moveInstance", () => {
  it("moves the layout entry, snapped to the grid", () => {
    const moved = moveInstance(rcLowpass(), "R1", { x: 123, y: 87 });
    expect(moved.layout?.instances["R1"]).toMatchObject({ x: 120, y: 90 });
    expectValid(moved);
  });

  it("preserves rotation when moving", () => {
    const moved = moveInstance(rcLowpass(), "C1", { x: 400, y: 220 });
    expect(moved.layout?.instances["C1"]?.rotation).toBe(90);
    expectValid(moved);
  });

  it("returns the schematic unchanged for unknown instances", () => {
    const before = rcLowpass();
    const moved = moveInstance(before, "R99", { x: 0, y: 0 });
    expect(moved).toEqual(before);
    expectValid(moved);
  });
});

describe("rotateInstance", () => {
  it("rotates by 90 degrees and wraps 270 -> 0", () => {
    let sch = rcLowpass();
    sch = rotateInstance(sch, "R1");
    expect(sch.layout?.instances["R1"]?.rotation).toBe(90);
    sch = rotateInstance(sch, "R1");
    sch = rotateInstance(sch, "R1");
    expect(sch.layout?.instances["R1"]?.rotation).toBe(270);
    sch = rotateInstance(sch, "R1");
    expect(sch.layout?.instances["R1"]?.rotation).toBe(0);
    expectValid(sch);
  });
});

describe("connectPins", () => {
  it("creates a new net when neither pin is connected", () => {
    let sch = rcLowpass();
    const placed = placeInstance(sch, ledGeneric, { x: 500, y: 200 });
    sch = placed.schematic;
    const placed2 = placeInstance(sch, ledGeneric, { x: 560, y: 200 });
    const sch2 = placed2.schematic;
    const joined = connectPins(
      sch2,
      { instanceId: placed.instanceId, pinId: "anode" },
      { instanceId: placed2.instanceId, pinId: "cathode" },
    );
    expect(joined.nets.length).toBe(sch2.nets.length + 1);
    const newNet = joined.nets.find((n) =>
      n.connections.some((c) => c.instanceId === placed.instanceId && c.pinId === "anode"),
    );
    expect(newNet).toBeDefined();
    expect(newNet!.connections).toContainEqual({ instanceId: placed2.instanceId, pinId: "cathode" });
    expectValid(joined);
  });

  it("adds to an existing net when one pin is already connected", () => {
    let sch = rcLowpass();
    const placed = placeInstance(sch, ledGeneric, { x: 500, y: 200 });
    sch = placed.schematic;
    const next = connectPins(
      sch,
      { instanceId: placed.instanceId, pinId: "cathode" },
      { instanceId: "GND1", pinId: "gnd" },
    );
    expect(next.nets.length).toBe(sch.nets.length);
    const gndNet = next.nets.find((n) => n.netId === "net_gnd");
    expect(gndNet!.connections).toContainEqual({ instanceId: placed.instanceId, pinId: "cathode" });
    expectValid(next);
  });

  it("merges two nets, re-pointing every connection and dropping the absorbed net", () => {
    const sch = rcLowpass();
    // net_out (R1.p2, C1.p1) + net_gnd (V1.neg, C1.p2, GND1.gnd)
    const merged = connectPins(
      sch,
      { instanceId: "R1", pinId: "p2" },
      { instanceId: "V1", pinId: "neg" },
    );
    expect(merged.nets.length).toBe(2);
    const survivor = merged.nets.find((n) =>
      n.connections.some((c) => c.instanceId === "R1" && c.pinId === "p2"),
    );
    expect(survivor).toBeDefined();
    const conns = survivor!.connections;
    expect(conns).toContainEqual({ instanceId: "C1", pinId: "p1" });
    expect(conns).toContainEqual({ instanceId: "V1", pinId: "neg" });
    expect(conns).toContainEqual({ instanceId: "C1", pinId: "p2" });
    expect(conns).toContainEqual({ instanceId: "GND1", pinId: "gnd" });
    // absorbed net is gone entirely
    const allNetIds = merged.nets.map((n) => n.netId);
    expect(new Set(allNetIds).size).toBe(allNetIds.length);
    expectValid(merged);
  });

  it("is a no-op when both pins are already on the same net", () => {
    const sch = rcLowpass();
    const next = connectPins(
      sch,
      { instanceId: "V1", pinId: "pos" },
      { instanceId: "R1", pinId: "p1" },
    );
    expect(next.nets).toEqual(sch.nets);
    expectValid(next);
  });

  it("is a no-op when connecting a pin to itself", () => {
    const sch = rcLowpass();
    const next = connectPins(
      sch,
      { instanceId: "R1", pinId: "p1" },
      { instanceId: "R1", pinId: "p1" },
    );
    expect(next.nets).toEqual(sch.nets);
    expectValid(next);
  });
});

describe("deleteSelection", () => {
  it("removes instances, their connections, empty nets, and layout entries", () => {
    const sch = rcLowpass();
    const next = deleteSelection(sch, ["C1"]);
    expect(next.instances.map((i) => i.instanceId)).toEqual(["V1", "R1", "GND1"]);
    // net_out had only R1.p2 + C1.p1; with C1 gone it keeps R1.p2 (not empty)
    const out = next.nets.find((n) => n.netId === "net_out");
    expect(out?.connections).toEqual([{ instanceId: "R1", pinId: "p2" }]);
    // no connection anywhere references C1
    for (const net of next.nets) {
      expect(net.connections.some((c) => c.instanceId === "C1")).toBe(false);
    }
    expect(next.layout?.instances["C1"]).toBeUndefined();
    expectValid(next);
  });

  it("drops nets that become empty", () => {
    const sch = rcLowpass();
    const next = deleteSelection(sch, ["R1", "C1"]);
    expect(next.nets.find((n) => n.netId === "net_out")).toBeUndefined();
    expectValid(next);
  });

  it("deletes everything cleanly", () => {
    const sch = rcLowpass();
    const next = deleteSelection(sch, ["V1", "R1", "C1", "GND1"]);
    expect(next.instances).toEqual([]);
    expect(next.nets).toEqual([]);
    expect(next.layout?.instances ?? {}).toEqual({});
    expectValid(next);
  });

  it("ignores unknown ids", () => {
    const before = rcLowpass();
    const next = deleteSelection(before, ["nope"]);
    expect(next).toEqual(before);
    expectValid(next);
  });
});

describe("setParameterOverride", () => {
  it("sets a parameter override on the instance", () => {
    const next = setParameterOverride(rcLowpass(), "C1", "capacitance", 2.2e-6);
    const c1 = next.instances.find((i) => i.instanceId === "C1");
    expect(c1?.parameterOverrides).toEqual({ capacitance: 2.2e-6 });
    expectValid(next);
  });

  it("updates an existing override without touching others", () => {
    let sch = setParameterOverride(rcLowpass(), "R1", "resistance", 10_000);
    const r1 = sch.instances.find((i) => i.instanceId === "R1");
    expect(r1?.parameterOverrides).toEqual({ resistance: 10_000 });
    sch = setParameterOverride(sch, "R1", "resistance", 220);
    expect(sch.instances.find((i) => i.instanceId === "R1")?.parameterOverrides).toEqual({
      resistance: 220,
    });
    expectValid(sch);
  });

  it("clears an override when value is undefined", () => {
    const next = setParameterOverride(rcLowpass(), "R1", "resistance", undefined);
    const r1 = next.instances.find((i) => i.instanceId === "R1");
    expect(r1?.parameterOverrides?.["resistance"]).toBeUndefined();
    expectValid(next);
  });
});

describe("registry coverage", () => {
  it("every registry component gets a prefix and a valid placement", () => {
    let sch = rcLowpass();
    for (const component of registryComponents) {
      const placed = placeInstance(sch, component, { x: 0, y: 0 });
      // Readable per-part prefixes landed with issue #23 (BTN/SW/M/BZ/LA/RV/LDR/Q);
      // batch 3 adds the inductor's L prefix; batch 6 adds the 7-seg display's DS prefix.
      expect(placed.instanceId).toMatch(/^(R|C|DS|D|V|U|GND|BTN|SW|M|BZ|LA|RV|LDR|Q|L|I)\d+$/);
      sch = placed.schematic;
    }
    expectValid(sch);
  });
});
