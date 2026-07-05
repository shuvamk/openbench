import { describe, expect, it } from "vitest";
import {
  IR_VERSION,
  validateNetlist,
  validateSchematic,
  type Component,
  type Schematic,
  type SchematicInstance,
} from "@openbench/ir-schema";
import { compileNetlist } from "@openbench/netlist-compiler";
import { getComponent, registryComponents } from "../src/index";

/**
 * Acceptance tests for issue #22 — every registry simModel must expand
 * through compileNetlist. The trivial fixture wires each pin of a single
 * instance ("X1") to its own net, so pin ids map to SPICE nodes 1..n in
 * declaration order.
 */

const FIXTURE_AT = "2026-07-02T00:00:00Z";
const NOW = "2026-07-02T12:34:56Z";

/** The ten parts added by issue #22 — all must carry a simModel. */
const ISSUE_22_IDS = [
  "cmp_diode_generic",
  "cmp_npn_2n2222",
  "cmp_potentiometer",
  "cmp_pushbutton",
  "cmp_switch_spst",
  "cmp_dc_motor",
  "cmp_buzzer",
  "cmp_lamp",
  "cmp_rgb_led",
  "cmp_ldr",
];

/** One instance of the part with every pin on its own single-connection net. */
function fixtureSchematic(
  component: Component,
  parameterOverrides?: Record<string, number | string | boolean>,
): Schematic {
  const instance: SchematicInstance =
    parameterOverrides === undefined
      ? { instanceId: "X1", componentId: component.id }
      : { instanceId: "X1", componentId: component.id, parameterOverrides };
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_fixture",
    projectId: "proj_fixture",
    instances: [instance],
    nets: component.pins.map((pin) => ({
      netId: `net_${pin.id}`,
      connections: [{ instanceId: "X1", pinId: pin.id }],
    })),
    provenance: { source: "test-fixture", at: FIXTURE_AT },
  };
}

function compilePart(
  componentId: string,
  parameterOverrides?: Record<string, number | string | boolean>,
) {
  const component = getComponent(componentId);
  if (!component) throw new Error(`registry is missing ${componentId}`);
  return compileNetlist(fixtureSchematic(component, parameterOverrides), getComponent, {
    now: NOW,
  });
}

/** Last whitespace-separated field of a SPICE card, as a number. */
function lastField(spiceCard: string): number {
  const fields = spiceCard.trim().split(/\s+/);
  return Number(fields[fields.length - 1]);
}

describe("every registry simModel expands through compileNetlist (issue #22)", () => {
  const simParts = registryComponents.filter((c) => c.simModel !== undefined);

  it("the ten issue #22 parts are present and all carry a simModel", () => {
    const simIds = simParts.map((c) => c.id);
    for (const id of ISSUE_22_IDS) {
      expect(simIds).toContain(id);
    }
  });

  it("the trivial fixture itself is a valid schematic", () => {
    const resistor = getComponent("cmp_resistor_generic");
    if (!resistor) throw new Error("registry is missing cmp_resistor_generic");
    const result = validateSchematic(fixtureSchematic(resistor));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(simParts.map((c) => [c.id] as const))(
    "%s compiles cleanly to a valid netlist",
    (id) => {
      const result = compilePart(id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
      expect(result.netlist.elements.length).toBeGreaterThan(0);
      const validation = validateNetlist(result.netlist);
      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);
    },
  );
});

describe("cmp_diode_generic and cmp_npn_2n2222 expansion", () => {
  it("diode expands to a D-card plus its model card", () => {
    const result = compilePart("cmp_diode_generic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "DX1 1 2 D1N4148" },
      { instanceId: "cmp_diode_generic", spiceCard: ".model D1N4148 D(IS=2.52e-9 N=1.752)" },
    ]);
  });

  it("NPN expands to a Q-card plus its model card", () => {
    const result = compilePart("cmp_npn_2n2222");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "QX1 1 2 3 Q2N2222" },
      { instanceId: "cmp_npn_2n2222", spiceCard: ".model Q2N2222 NPN(IS=1e-14 BF=200)" },
    ]);
  });
});

describe("cmp_potentiometer — both halves stay >= 1 ohm at the extremes", () => {
  it("position=0 puts the travel on the B half; A half floors at 1 ohm", () => {
    const result = compilePart("cmp_potentiometer", { position: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "RX1A 1 2 1" },
      { instanceId: "X1", spiceCard: "RX1B 2 3 10001" },
    ]);
  });

  it("position=1 puts the travel on the A half; B half floors at 1 ohm", () => {
    const result = compilePart("cmp_potentiometer", { position: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "RX1A 1 2 10001" },
      { instanceId: "X1", spiceCard: "RX1B 2 3 1" },
    ]);
  });

  it.each([[0], [0.5], [1]])("position=%s keeps both halves >= 1 ohm", (position) => {
    const result = compilePart("cmp_potentiometer", { position });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toHaveLength(2);
    for (const element of result.netlist.elements) {
      expect(lastField(element.spiceCard)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("cmp_pushbutton — pressed/released resistance", () => {
  it("pressed=1 conducts at 0.001 ohm", () => {
    const result = compilePart("cmp_pushbutton", { pressed: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "RX1 1 2 0.001" },
    ]);
  });

  it("released (default pressed=0) blocks at 1e12 + 0.001 ohm", () => {
    const result = compilePart("cmp_pushbutton");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: `RX1 1 2 ${0.001 + 1e12}` },
    ]);
  });
});

describe("cmp_switch_spst — closed/open resistance", () => {
  it("closed=1 conducts at 0.001 ohm", () => {
    const result = compilePart("cmp_switch_spst", { closed: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "RX1 1 2 0.001" },
    ]);
  });

  it("open (default closed=0) blocks at 1e12 + 0.001 ohm", () => {
    const result = compilePart("cmp_switch_spst");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: `RX1 1 2 ${0.001 + 1e12}` },
    ]);
  });
});

describe("cmp_rgb_led — multi-card expansion", () => {
  it("expands to three D-cards plus one shared model card", () => {
    const result = compilePart("cmp_rgb_led");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "DX1R 1 4 DLEDRGB" },
      { instanceId: "X1", spiceCard: "DX1G 2 4 DLEDRGB" },
      { instanceId: "X1", spiceCard: "DX1B 3 4 DLEDRGB" },
      { instanceId: "cmp_rgb_led", spiceCard: ".model DLEDRGB D(IS=1e-14 N=2.0)" },
    ]);
  });
});

describe("cmp_ldr — lux interpolation between rdark and rlight", () => {
  it.each([
    [0, 100000],
    [0.5, 50500],
    [1, 1000],
  ])("lux=%s resolves to %s ohm", (lux, expected) => {
    const result = compilePart("cmp_ldr", { lux });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: `RX1 1 2 ${expected}` },
    ]);
  });
});

describe("resistive loads (motor, buzzer, lamp)", () => {
  it.each([
    ["cmp_dc_motor", 24],
    ["cmp_buzzer", 42],
    ["cmp_lamp", 60],
  ])("%s expands to a single R-card with its default resistance", (id, ohms) => {
    const result = compilePart(id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: `RX1 1 2 ${ohms}` },
    ]);
  });
});

describe("ICs via .subckt (issue #44)", () => {
  it("cmp_opamp_ideal expands to an X card plus its .subckt block", () => {
    const result = compilePart("cmp_opamp_ideal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "XX1 1 2 3 OPAMP" },
      {
        instanceId: "cmp_opamp_ideal",
        spiceCard: ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP",
      },
    ]);
  });

  it.each([
    [0, 0.5],
    [25, 0.75],
    [100, 1.5],
  ])("cmp_tmp36 at %s°C outputs %sV", (tempC, volts) => {
    const result = compilePart("cmp_tmp36", { tempC });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pins map to nodes in declaration order: vs=1, vout=2, gnd=3.
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: `VX1 2 3 DC ${volts}` },
    ]);
  });
});

describe("digital & visual ICs compile through .subckt (issue #44, batch 6)", () => {
  it("cmp_logic_7400 expands to an X card plus its NAND .subckt block", () => {
    const result = compilePart("cmp_logic_7400");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pins map to nodes in declaration order: a=1, b=2, y=3.
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "XX1 1 2 3 NAND7400" },
      {
        instanceId: "cmp_logic_7400",
        spiceCard:
          ".subckt NAND7400 a b y\nBy y 0 V = (V(a) > 2.5) ? ((V(b) > 2.5) ? 0 : 5) : 5\n.ends NAND7400",
      },
    ]);
  });

  it("cmp_logic_7404 expands to an X card plus its inverter .subckt block", () => {
    const result = compilePart("cmp_logic_7404");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "XX1 1 2 NOT7404" },
      {
        instanceId: "cmp_logic_7404",
        spiceCard: ".subckt NOT7404 a y\nBy y 0 V = (V(a) > 2.5) ? 0 : 5\n.ends NOT7404",
      },
    ]);
  });

  it("cmp_logic_7408 expands to an X card plus its AND .subckt block", () => {
    const result = compilePart("cmp_logic_7408");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "XX1 1 2 3 AND7408" },
      {
        instanceId: "cmp_logic_7408",
        spiceCard:
          ".subckt AND7408 a b y\nBy y 0 V = (V(a) > 2.5) ? ((V(b) > 2.5) ? 5 : 0) : 0\n.ends AND7408",
      },
    ]);
  });

  it("cmp_timer_ne555 expands to an X card plus its NE555 .subckt block (issue #87)", () => {
    const result = compilePart("cmp_timer_ne555");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pins map to nodes in declaration order: gnd=1..vcc=8.
    const xCard = result.netlist.elements.find((e) => e.instanceId === "X1");
    expect(xCard?.spiceCard).toBe("XX1 1 2 3 4 5 6 7 8 NE555");
    const block = result.netlist.elements.find((e) => e.instanceId === "cmp_timer_ne555");
    expect(block?.spiceCard).toContain(".subckt NE555 gnd trig out reset ctrl thres disch vcc");
    expect(block?.spiceCard).toContain(".ends NE555");
    // exactly one X device card + one .subckt definition block
    expect(result.netlist.elements).toHaveLength(2);
  });

  it("cmp_7segment_display expands to eight D cards sharing one DSEG model card", () => {
    const result = compilePart("cmp_7segment_display");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pins map to nodes in declaration order: a=1..dp=8, com=9.
    expect(result.netlist.elements).toEqual([
      { instanceId: "X1", spiceCard: "DX1a 1 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1b 2 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1c 3 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1d 4 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1e 5 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1f 6 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1g 7 9 DSEG" },
      { instanceId: "X1", spiceCard: "DX1dp 8 9 DSEG" },
      { instanceId: "cmp_7segment_display", spiceCard: ".model DSEG D(IS=1e-14 N=2.0)" },
    ]);
  });
});

/**
 * Golden reference: an ideal-op-amp non-inverting amplifier with Rf = Rg = 10k
 * gives a closed-loop gain of 1 + Rf/Rg = 2 (issue #44 acceptance). This asserts
 * the whole schematic → netlist path wires the OPAMP subckt, the feedback divider,
 * and the input source into one valid deck; the exact 2× transfer is browser-WASM
 * -verified (the node MockBackend returns synthetic waveforms, not SPICE physics).
 */
describe("op-amp non-inverting amplifier (gain 2) reference schematic (issue #44)", () => {
  const RF = 10000;
  const RG = 10000;

  function nonInvertingAmp(): Schematic {
    const instances: SchematicInstance[] = [
      { instanceId: "V1", componentId: "cmp_vsource_dc", parameterOverrides: { voltage: 1 } },
      { instanceId: "X1", componentId: "cmp_opamp_ideal" },
      { instanceId: "RF", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: RF } },
      { instanceId: "RG", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: RG } },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ];
    return {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_noninv_amp",
      projectId: "proj_fixture",
      instances,
      nets: [
        // vin: source + → op-amp IN+  (node 1)
        {
          netId: "net_vin",
          connections: [
            { instanceId: "V1", pinId: "pos" },
            { instanceId: "X1", pinId: "inp" },
          ],
        },
        // out: op-amp OUT → Rf  (node 2)
        {
          netId: "net_out",
          connections: [
            { instanceId: "X1", pinId: "out" },
            { instanceId: "RF", pinId: "p1" },
          ],
        },
        // fb: op-amp IN- ← Rf ← Rg divider  (node 3)
        {
          netId: "net_fb",
          connections: [
            { instanceId: "X1", pinId: "inn" },
            { instanceId: "RF", pinId: "p2" },
            { instanceId: "RG", pinId: "p1" },
          ],
        },
        // ground: source -, Rg bottom, ground symbol  (node 0)
        {
          netId: "net_gnd",
          connections: [
            { instanceId: "V1", pinId: "neg" },
            { instanceId: "RG", pinId: "p2" },
            { instanceId: "GND1", pinId: "gnd" },
          ],
        },
      ],
      provenance: { source: "test-fixture", at: FIXTURE_AT },
    };
  }

  it("is a valid schematic", () => {
    const result = validateSchematic(nonInvertingAmp());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("compiles to a valid netlist wiring the OPAMP subckt + feedback divider", () => {
    const result = compileNetlist(nonInvertingAmp(), getComponent, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The ground symbol carries no simModel — skipped with a warning, not an error.
    expect(result.warnings).toEqual(["skipped GND1: no simulation model"]);
    expect(result.netlist.elements).toEqual([
      { instanceId: "V1", spiceCard: "VV1 1 0 DC 1" },
      { instanceId: "X1", spiceCard: "XX1 1 3 2 OPAMP" },
      { instanceId: "RF", spiceCard: `RRF 2 3 ${RF}` },
      { instanceId: "RG", spiceCard: `RRG 3 0 ${RG}` },
      {
        instanceId: "cmp_opamp_ideal",
        spiceCard: ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP",
      },
    ]);
    const validation = validateNetlist(result.netlist);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("Rf = Rg encodes the non-inverting gain of 1 + Rf/Rg = 2", () => {
    expect(1 + RF / RG).toBe(2);
  });
});
