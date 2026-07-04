import { describe, expect, it } from "vitest";
import {
  IR_VERSION,
  validateComponent,
  validateNetlist,
  validateSchematic,
  type Component,
  type Schematic,
} from "@openbench/ir-schema";
import { compileNetlist } from "../src/index";

/**
 * Acceptance tests for issue #7 — the netlist compiler.
 *
 * Fixtures are registry-like Component documents built locally so this
 * package stays decoupled from @openbench/registry.
 */

const FIXTURE_AT = "2026-07-02T00:00:00Z";
const NOW = "2026-07-02T12:34:56Z";
const fixtureProvenance = { source: "test-fixture", at: FIXTURE_AT };

const resistor: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_resistor_generic",
  name: "Resistor",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "resistance", unit: "ohm", default: 1000, type: "number" }],
  simModel: { engine: "ngspice", template: "{ref} {p1} {p2} {resistance}" },
  provenance: fixtureProvenance,
};

const capacitor: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_capacitor_generic",
  name: "Capacitor",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "capacitance", unit: "farad", default: "1u", type: "string" }],
  simModel: { engine: "ngspice", template: "{ref} {p1} {p2} {capacitance}" },
  provenance: fixtureProvenance,
};

const vsource: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_vsource_dc",
  name: "DC Voltage Source",
  category: "power",
  pins: [
    { id: "p", name: "+", electricalType: "power_out" },
    { id: "n", name: "-", electricalType: "power_in" },
  ],
  parameters: [{ name: "voltage", unit: "volt", default: 5, type: "number" }],
  simModel: { engine: "ngspice", template: "{ref} {p} {n} DC {voltage}" },
  provenance: fixtureProvenance,
};

const ground: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_ground",
  name: "Ground",
  category: "power",
  pins: [{ id: "p1", name: "GND", electricalType: "power_in" }],
  parameters: [],
  provenance: fixtureProvenance,
};

const ledRed: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_led_red",
  name: "LED (red)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "passive" },
    { id: "k", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "{ref} {a} {k} DLED",
    modelCard: ".model DLED D(IS=1e-14)",
  },
  provenance: fixtureProvenance,
};

/** Same modelCard *content* as cmp_led_red — exercises dedup by content. */
const ledGreen: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_led_green",
  name: "LED (green)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "passive" },
    { id: "k", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "{ref} {a} {k} DLED",
    modelCard: ".model DLED D(IS=1e-14)",
  },
  provenance: fixtureProvenance,
};

/** Issue #21 — derivedParams: on/off resistance computed from `pressed`. */
const pushbutton: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_pushbutton",
  name: "Pushbutton",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "pressed", default: 0, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {ronoff}",
    derivedParams: { ronoff: "0.001 + (1 - pressed) * 1e12" },
  },
  provenance: fixtureProvenance,
};

/** Issue #21 — division + parens in a derived expression (parallel resistors). */
const parallelPair: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_parallel_pair",
  name: "Parallel resistor pair",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [
    { name: "r1", unit: "ohm", default: 1000, type: "number" },
    { name: "r2", unit: "ohm", default: 1000, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {req}",
    derivedParams: { req: "(r1 * r2) / (r1 + r2)" },
  },
  provenance: fixtureProvenance,
};

/**
 * Issue #21 — multi-line template: three D-cards ({ref}-suffixed names keep
 * multi-device instances unique) plus a shared modelCard. The modelCard
 * content matches cmp_led_red/cmp_led_green to exercise cross-component dedup.
 */
const ledRgb: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_led_rgb",
  name: "RGB LED",
  category: "active",
  pins: [
    { id: "r", name: "R", electricalType: "passive" },
    { id: "g", name: "G", electricalType: "passive" },
    { id: "b", name: "B", electricalType: "passive" },
    { id: "k", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "D{ref}R {r} {k} DLED\nD{ref}G {g} {k} DLED\nD{ref}B {b} {k} DLED",
    modelCard: ".model DLED D(IS=1e-14)",
  },
  provenance: fixtureProvenance,
};

const esp32: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_esp32_devkit",
  name: "ESP32 DevKit",
  category: "mcu",
  pins: [
    { id: "3V3", name: "3V3", electricalType: "power_out" },
    { id: "GND", name: "GND", electricalType: "power_in" },
    { id: "IO2", name: "IO2", electricalType: "bidirectional" },
  ],
  parameters: [],
  provenance: fixtureProvenance,
};

/**
 * Issue #34 — subcircuit part: an `X{ref} … NAME` call template paired with a
 * `.subckt … .ends` definition block. Two instances share one block (dedup by
 * content), mirroring modelCard dedup.
 */
const opampIdeal: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_opamp_ideal",
  name: "Ideal Op-Amp",
  category: "active",
  pins: [
    { id: "inp", name: "IN+", electricalType: "input" },
    { id: "inn", name: "IN-", electricalType: "input" },
    { id: "out", name: "OUT", electricalType: "output" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "X{ref} {inp} {inn} {out} OPAMP",
    subckt: ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP",
  },
  provenance: fixtureProvenance,
};

const registry = new Map<string, Component>(
  [
    resistor,
    capacitor,
    vsource,
    ground,
    ledRed,
    ledGreen,
    pushbutton,
    parallelPair,
    ledRgb,
    esp32,
    opampIdeal,
  ].map((c) => [c.id, c]),
);
const resolve = (id: string): Component | undefined => registry.get(id);

function makeSchematic(partial: Pick<Schematic, "instances" | "nets"> & { id?: string }): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: partial.id ?? "sch_fixture",
    projectId: "proj_fixture",
    instances: partial.instances,
    nets: partial.nets,
    provenance: fixtureProvenance,
  };
}

describe("fixtures", () => {
  it("every component fixture is a valid registry-shaped component", () => {
    for (const component of registry.values()) {
      const result = validateComponent(component);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });
});

describe("compileNetlist — voltage divider (acceptance #1)", () => {
  const schematic = makeSchematic({
    id: "sch_divider",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 10000 } },
      { instanceId: "R2", componentId: "cmp_resistor_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_vin",
        name: "VIN",
        connections: [
          { instanceId: "V1", pinId: "p" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_out",
        name: "OUT",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "R2", pinId: "p1" },
        ],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "R2", pinId: "p2" },
          { instanceId: "V1", pinId: "n" },
          { instanceId: "GND1", pinId: "p1" },
        ],
      },
    ],
  });

  it("is built from a valid schematic fixture", () => {
    expect(validateSchematic(schematic).valid).toBe(true);
  });

  it("compiles nodes in declaration order with GND mapped to 0", () => {
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.nodes).toEqual([
      { netId: "net_vin", spiceNode: "1" },
      { netId: "net_out", spiceNode: "2" },
      { netId: "net_gnd", spiceNode: "0" },
    ]);
  });

  it("expands templates with overrides and parameter defaults", () => {
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "V1", spiceCard: "V1 1 0 DC 5" },
      { instanceId: "R1", spiceCard: "R1 1 2 10000" },
      { instanceId: "R2", spiceCard: "R2 2 0 1000" },
    ]);
    expect(result.warnings).toEqual(["skipped GND1: no simulation model"]);
  });

  it("stamps the netlist envelope (id, schematicId, derivedBy, provenance) and passes validateNetlist", () => {
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { netlist } = result;
    expect(netlist.irVersion).toBe(IR_VERSION);
    expect(netlist.kind).toBe("netlist");
    expect(netlist.id).toBe("net_divider");
    expect(netlist.schematicId).toBe("sch_divider");
    expect(netlist.derivedBy).toBe("netlist-compiler@0.1.0");
    expect(netlist.provenance).toEqual({ source: "netlist-compiler", at: NOW });
    const validation = validateNetlist(netlist);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("honours opts.idSuffix over the schematic-derived suffix", () => {
    const result = compileNetlist(schematic, resolve, { now: NOW, idSuffix: "custom_suffix" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.id).toBe("net_custom_suffix");
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const a = compileNetlist(schematic, resolve, { now: NOW });
    const b = compileNetlist(schematic, resolve, { now: NOW });
    expect(a).toEqual(b);
  });

  it("defaults provenance.at to the current time when opts.now is omitted", () => {
    const before = Date.now();
    const result = compileNetlist(schematic, resolve);
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const at = Date.parse(result.netlist.provenance.at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });
});

describe("compileNetlist — RC circuit with parameter override (acceptance #2)", () => {
  const schematic = makeSchematic({
    id: "sch_rc",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc", parameterOverrides: { voltage: 3.3 } },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
      { instanceId: "C1", componentId: "cmp_capacitor_generic", parameterOverrides: { capacitance: "10u" } },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_in",
        name: "IN",
        connections: [
          { instanceId: "V1", pinId: "p" },
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
        name: "gnd",
        connections: [
          { instanceId: "C1", pinId: "p2" },
          { instanceId: "V1", pinId: "n" },
          { instanceId: "GND1", pinId: "p1" },
        ],
      },
    ],
  });

  it("applies overrides (number and string) and maps lowercase gnd to node 0", () => {
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.nodes).toEqual([
      { netId: "net_in", spiceNode: "1" },
      { netId: "net_out", spiceNode: "2" },
      { netId: "net_gnd", spiceNode: "0" },
    ]);
    expect(result.netlist.elements).toEqual([
      { instanceId: "V1", spiceCard: "V1 1 0 DC 3.3" },
      { instanceId: "R1", spiceCard: "R1 1 2 4700" },
      { instanceId: "C1", spiceCard: "C1 2 0 10u" },
    ]);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });
});

describe("compileNetlist — LED .model dedup (acceptance #3)", () => {
  const schematic = makeSchematic({
    id: "sch_leds",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 220 } },
      { instanceId: "D1", componentId: "cmp_led_red" },
      { instanceId: "R2", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 220 } },
      { instanceId: "D2", componentId: "cmp_led_red" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_vcc",
        name: "VCC",
        connections: [
          { instanceId: "V1", pinId: "p" },
          { instanceId: "R1", pinId: "p1" },
          { instanceId: "R2", pinId: "p1" },
        ],
      },
      {
        netId: "net_a1",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "D1", pinId: "a" },
        ],
      },
      {
        netId: "net_a2",
        connections: [
          { instanceId: "R2", pinId: "p2" },
          { instanceId: "D2", pinId: "a" },
        ],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "D1", pinId: "k" },
          { instanceId: "D2", pinId: "k" },
          { instanceId: "V1", pinId: "n" },
          { instanceId: "GND1", pinId: "p1" },
        ],
      },
    ],
  });

  it("emits the shared .model card exactly once, after the device cards", () => {
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "V1", spiceCard: "V1 1 0 DC 5" },
      { instanceId: "R1", spiceCard: "R1 1 2 220" },
      { instanceId: "D1", spiceCard: "D1 2 0 DLED" },
      { instanceId: "R2", spiceCard: "R2 1 3 220" },
      { instanceId: "D2", spiceCard: "D2 3 0 DLED" },
      { instanceId: "cmp_led_red", spiceCard: ".model DLED D(IS=1e-14)" },
    ]);
    const modelCards = result.netlist.elements.filter((e) => e.spiceCard.startsWith(".model"));
    expect(modelCards).toHaveLength(1);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });

  it("dedups .model cards by content across different components", () => {
    const mixed = makeSchematic({
      id: "sch_leds_mixed",
      instances: [
        { instanceId: "V1", componentId: "cmp_vsource_dc" },
        { instanceId: "D1", componentId: "cmp_led_red" },
        { instanceId: "D2", componentId: "cmp_led_green" },
      ],
      nets: [
        {
          netId: "net_vcc",
          name: "VCC",
          connections: [
            { instanceId: "V1", pinId: "p" },
            { instanceId: "D1", pinId: "a" },
            { instanceId: "D2", pinId: "a" },
          ],
        },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "V1", pinId: "n" },
            { instanceId: "D1", pinId: "k" },
            { instanceId: "D2", pinId: "k" },
          ],
        },
      ],
    });
    const result = compileNetlist(mixed, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const modelCards = result.netlist.elements.filter((e) => e.spiceCard.startsWith(".model"));
    expect(modelCards).toEqual([
      { instanceId: "cmp_led_red", spiceCard: ".model DLED D(IS=1e-14)" },
    ]);
  });
});

describe("compileNetlist — unresolved componentId (acceptance #4)", () => {
  it("fails with a structured error naming the instance path", () => {
    const schematic = makeSchematic({
      id: "sch_missing",
      instances: [
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "X1", componentId: "cmp_missing" },
      ],
      nets: [
        { netId: "net_a", name: "A", connections: [{ instanceId: "R1", pinId: "p1" }] },
        { netId: "net_b", name: "B", connections: [{ instanceId: "R1", pinId: "p2" }] },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("instances.1.componentId");
    expect(result.errors[0]?.message).toContain("cmp_missing");
  });
});

describe("compileNetlist — instances without simModel are skipped (acceptance #5)", () => {
  it("skips the ESP32 with a warning and still produces a valid netlist", () => {
    const schematic = makeSchematic({
      id: "sch_esp32",
      instances: [
        { instanceId: "U1", componentId: "cmp_esp32_devkit" },
        { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        {
          netId: "net_vcc",
          name: "3V3",
          connections: [
            { instanceId: "U1", pinId: "3V3" },
            { instanceId: "R1", pinId: "p1" },
          ],
        },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "U1", pinId: "GND" },
            { instanceId: "R1", pinId: "p2" },
            { instanceId: "GND1", pinId: "p1" },
          ],
        },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      "skipped U1: no simulation model",
      "skipped GND1: no simulation model",
    ]);
    expect(result.netlist.elements).toEqual([{ instanceId: "R1", spiceCard: "R1 1 0 4700" }]);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });
});

describe("compileNetlist — ground detection details", () => {
  it("treats a net connected to a cmp_ground instance as node 0 even without a ground name", () => {
    const schematic = makeSchematic({
      id: "sch_implicit_gnd",
      instances: [
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        {
          netId: "net_x",
          name: "N1",
          connections: [
            { instanceId: "R1", pinId: "p2" },
            { instanceId: "GND1", pinId: "p1" },
          ],
        },
        { netId: "net_y", name: "VCC", connections: [{ instanceId: "R1", pinId: "p1" }] },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.nodes).toEqual([
      { netId: "net_x", spiceNode: "0" },
      { netId: "net_y", spiceNode: "1" },
    ]);
  });

  it("maps every ground-named net (GND, AGND, 0) to node 0", () => {
    const schematic = makeSchematic({
      id: "sch_multi_gnd",
      instances: [
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "R2", componentId: "cmp_resistor_generic" },
      ],
      nets: [
        { netId: "net_gnd", name: "GND", connections: [{ instanceId: "R1", pinId: "p2" }] },
        { netId: "net_agnd", name: "AGND", connections: [{ instanceId: "R2", pinId: "p2" }] },
        { netId: "net_zero", name: "0", connections: [] },
        {
          netId: "net_sig",
          name: "SIG",
          connections: [
            { instanceId: "R1", pinId: "p1" },
            { instanceId: "R2", pinId: "p1" },
          ],
        },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.nodes).toEqual([
      { netId: "net_gnd", spiceNode: "0" },
      { netId: "net_agnd", spiceNode: "0" },
      { netId: "net_zero", spiceNode: "0" },
      { netId: "net_sig", spiceNode: "1" },
    ]);
  });
});

describe("compileNetlist — template expansion errors", () => {
  it("reports an unconnected pin referenced by the template", () => {
    const schematic = makeSchematic({
      id: "sch_unconnected",
      instances: [{ instanceId: "R1", componentId: "cmp_resistor_generic" }],
      nets: [{ netId: "net_a", name: "A", connections: [{ instanceId: "R1", pinId: "p1" }] }],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("instances.0.pins.p2");
    expect(result.errors[0]?.message).toContain("p2");
  });

  it("reports a template parameter with neither override nor default", () => {
    const weird: Component = {
      irVersion: IR_VERSION,
      kind: "component",
      id: "cmp_weird",
      name: "Weird",
      category: "other",
      pins: [
        { id: "p1", name: "1", electricalType: "passive" },
        { id: "p2", name: "2", electricalType: "passive" },
      ],
      parameters: [],
      // References {gain}, which is neither a pin nor a declared parameter.
      simModel: { engine: "ngspice", template: "{ref} {p1} {p2} {gain}" },
      provenance: fixtureProvenance,
    };
    const resolveWeird = (id: string) => (id === "cmp_weird" ? weird : resolve(id));
    const schematic = makeSchematic({
      id: "sch_weird",
      instances: [{ instanceId: "W1", componentId: "cmp_weird" }],
      nets: [
        { netId: "net_a", name: "A", connections: [{ instanceId: "W1", pinId: "p1" }] },
        { netId: "net_b", name: "GND", connections: [{ instanceId: "W1", pinId: "p2" }] },
      ],
    });

    const failing = compileNetlist(schematic, resolveWeird, { now: NOW });
    expect(failing.ok).toBe(false);
    if (failing.ok) return;
    expect(failing.errors).toHaveLength(1);
    expect(failing.errors[0]?.path).toBe("instances.0.parameterOverrides.gain");
    expect(failing.errors[0]?.message).toContain("gain");

    const withOverride = makeSchematic({
      id: "sch_weird",
      instances: [
        { instanceId: "W1", componentId: "cmp_weird", parameterOverrides: { gain: 42 } },
      ],
      nets: schematic.nets,
    });
    const passing = compileNetlist(withOverride, resolveWeird, { now: NOW });
    expect(passing.ok).toBe(true);
    if (!passing.ok) return;
    expect(passing.netlist.elements).toEqual([{ instanceId: "W1", spiceCard: "W1 1 0 42" }]);
  });
});

describe("compileNetlist — derivedParams (issue #21)", () => {
  const buttonSchematic = (parameterOverrides?: Record<string, number>) =>
    makeSchematic({
      id: "sch_button",
      instances: [
        { instanceId: "SW1", componentId: "cmp_pushbutton", parameterOverrides },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        { netId: "net_a", name: "A", connections: [{ instanceId: "SW1", pinId: "p1" }] },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "SW1", pinId: "p2" },
            { instanceId: "GND1", pinId: "p1" },
          ],
        },
      ],
    });

  it("pushbutton pressed=1 evaluates ronoff to 0.001", () => {
    const result = compileNetlist(buttonSchematic({ pressed: 1 }), resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "SW1", spiceCard: "RSW1 1 0 0.001" },
    ]);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });

  it("pushbutton pressed=0 (default) evaluates ronoff to 1e12 + 0.001", () => {
    const result = compileNetlist(buttonSchematic(), resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "SW1", spiceCard: `RSW1 1 0 ${1e12 + 0.001}` },
    ]);
  });

  it("evaluates division and parentheses over parameter overrides", () => {
    const schematic = makeSchematic({
      id: "sch_parallel",
      instances: [
        {
          instanceId: "RP1",
          componentId: "cmp_parallel_pair",
          parameterOverrides: { r1: 300, r2: 600 },
        },
      ],
      nets: [
        { netId: "net_a", name: "A", connections: [{ instanceId: "RP1", pinId: "p1" }] },
        { netId: "net_gnd", name: "GND", connections: [{ instanceId: "RP1", pinId: "p2" }] },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "RP1", spiceCard: "RRP1 1 0 200" },
    ]);
  });

  it.each([
    ["JS member access", "process.exit(1)"],
    ["statement separators", "1; 2"],
    ["function calls on unknown identifiers", "alert(1)"],
    ["call syntax on a declared parameter", "pressed(1)"],
    ["template-literal injection", "`${pressed}`"],
  ])("rejects malicious expressions structurally (%s), never evaluating them as JS", (_label, expression) => {
    // Bypass ir-schema validation on purpose: the compiler must not trust its inputs.
    const hostile: Component = structuredClone(pushbutton);
    hostile.simModel!.derivedParams = { ronoff: expression };
    const resolveHostile = (id: string) => (id === "cmp_pushbutton" ? hostile : resolve(id));
    const result = compileNetlist(buttonSchematic(), resolveHostile, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("instances.0.derivedParams.ronoff");
  });

  it("reports a non-numeric parameter referenced by a derived expression", () => {
    const stringy: Component = structuredClone(pushbutton);
    stringy.parameters = [{ name: "pressed", default: "yes", type: "string" }];
    const resolveStringy = (id: string) => (id === "cmp_pushbutton" ? stringy : resolve(id));
    const result = compileNetlist(buttonSchematic(), resolveStringy, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe("instances.0.derivedParams.ronoff");
    expect(result.errors[0]?.message).toContain("pressed");
  });
});

describe("compileNetlist — multi-line templates (issue #21)", () => {
  const rgbNets = (suffix: string, instanceId: string) => [
    { netId: `net_r${suffix}`, connections: [{ instanceId, pinId: "r" }] },
    { netId: `net_g${suffix}`, connections: [{ instanceId, pinId: "g" }] },
    { netId: `net_b${suffix}`, connections: [{ instanceId, pinId: "b" }] },
  ];

  it("expands each template line into its own element entry", () => {
    const schematic = makeSchematic({
      id: "sch_rgb",
      instances: [
        { instanceId: "D1", componentId: "cmp_led_rgb" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        ...rgbNets("1", "D1"),
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "D1", pinId: "k" },
            { instanceId: "GND1", pinId: "p1" },
          ],
        },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements).toEqual([
      { instanceId: "D1", spiceCard: "DD1R 1 0 DLED" },
      { instanceId: "D1", spiceCard: "DD1G 2 0 DLED" },
      { instanceId: "D1", spiceCard: "DD1B 3 0 DLED" },
      { instanceId: "cmp_led_rgb", spiceCard: ".model DLED D(IS=1e-14)" },
    ]);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });

  it("trims lines and drops blank ones (blank interior lines, trailing newline)", () => {
    const spaced: Component = structuredClone(ledRgb);
    spaced.simModel!.template =
      "D{ref}R {r} {k} DLED\n\n  D{ref}G {g} {k} DLED  \nD{ref}B {b} {k} DLED\n";
    const resolveSpaced = (id: string) => (id === "cmp_led_rgb" ? spaced : resolve(id));
    const schematic = makeSchematic({
      id: "sch_rgb_spaced",
      instances: [{ instanceId: "D1", componentId: "cmp_led_rgb" }],
      nets: [
        ...rgbNets("1", "D1"),
        { netId: "net_gnd", name: "GND", connections: [{ instanceId: "D1", pinId: "k" }] },
      ],
    });
    const result = compileNetlist(schematic, resolveSpaced, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netlist.elements.map((e) => e.spiceCard)).toEqual([
      "DD1R 1 0 DLED",
      "DD1G 2 0 DLED",
      "DD1B 3 0 DLED",
      ".model DLED D(IS=1e-14)",
    ]);
  });

  it("two RGB instances plus a red LED share one .model card (dedup unchanged)", () => {
    const schematic = makeSchematic({
      id: "sch_rgb_multi",
      instances: [
        { instanceId: "D1", componentId: "cmp_led_rgb" },
        { instanceId: "D2", componentId: "cmp_led_rgb" },
        { instanceId: "D3", componentId: "cmp_led_red" },
      ],
      nets: [
        ...rgbNets("1", "D1"),
        ...rgbNets("2", "D2"),
        { netId: "net_a3", connections: [{ instanceId: "D3", pinId: "a" }] },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "D1", pinId: "k" },
            { instanceId: "D2", pinId: "k" },
            { instanceId: "D3", pinId: "k" },
          ],
        },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const deviceCards = result.netlist.elements.filter((e) => !e.spiceCard.startsWith(".model"));
    const modelCards = result.netlist.elements.filter((e) => e.spiceCard.startsWith(".model"));
    expect(deviceCards.map((e) => e.spiceCard)).toEqual([
      "DD1R 1 0 DLED",
      "DD1G 2 0 DLED",
      "DD1B 3 0 DLED",
      "DD2R 4 0 DLED",
      "DD2G 5 0 DLED",
      "DD2B 6 0 DLED",
      "D3 7 0 DLED",
    ]);
    expect(modelCards).toEqual([
      { instanceId: "cmp_led_rgb", spiceCard: ".model DLED D(IS=1e-14)" },
    ]);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });
});

describe("compileNetlist — subcircuits (.subckt, issue #34)", () => {
  /** One instance per pin-on-its-own-net; pins map to nodes 1,2,3 in order. */
  function subcktSchematic(
    instances: Schematic["instances"],
    componentPinIds: string[],
  ): Schematic {
    let node = 0;
    const nets = [] as Schematic["nets"];
    for (const instance of instances) {
      for (const pinId of componentPinIds) {
        node += 1;
        nets.push({
          netId: `net_${instance.instanceId}_${pinId}`,
          connections: [{ instanceId: instance.instanceId, pinId }],
        });
      }
    }
    return makeSchematic({ id: "sch_subckt", instances, nets });
  }

  it("expands a subckt instance to an X card plus the .subckt block once", () => {
    const schematic = subcktSchematic(
      [{ instanceId: "U1", componentId: "cmp_opamp_ideal" }],
      ["inp", "inn", "out"],
    );
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.netlist.elements).toEqual([
      { instanceId: "U1", spiceCard: "XU1 1 2 3 OPAMP" },
      {
        instanceId: "cmp_opamp_ideal",
        spiceCard: ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP",
      },
    ]);
    expect(validateNetlist(result.netlist).valid).toBe(true);
  });

  it("dedupes the .subckt block across two instances, emitting two X cards", () => {
    const schematic = subcktSchematic(
      [
        { instanceId: "U1", componentId: "cmp_opamp_ideal" },
        { instanceId: "U2", componentId: "cmp_opamp_ideal" },
      ],
      ["inp", "inn", "out"],
    );
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xCards = result.netlist.elements.filter((e) => e.spiceCard.startsWith("X"));
    const subcktBlocks = result.netlist.elements.filter((e) => e.spiceCard.startsWith(".subckt"));
    expect(xCards).toEqual([
      { instanceId: "U1", spiceCard: "XU1 1 2 3 OPAMP" },
      { instanceId: "U2", spiceCard: "XU2 4 5 6 OPAMP" },
    ]);
    expect(subcktBlocks).toHaveLength(1);
    expect(subcktBlocks[0]!.instanceId).toBe("cmp_opamp_ideal");
  });

  it("maps subckt external nodes to the same SPICE nodes as the pin nets (ground → 0)", () => {
    const schematic = makeSchematic({
      id: "sch_opamp_follower",
      instances: [
        { instanceId: "U1", componentId: "cmp_opamp_ideal" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        { netId: "net_in", name: "IN", connections: [{ instanceId: "U1", pinId: "inp" }] },
        {
          netId: "net_fb",
          name: "GND",
          connections: [
            { instanceId: "U1", pinId: "inn" },
            { instanceId: "GND1", pinId: "p1" },
          ],
        },
        { netId: "net_out", name: "OUT", connections: [{ instanceId: "U1", pinId: "out" }] },
      ],
    });
    const result = compileNetlist(schematic, resolve, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // inn is on the GND net → external node 0; the .subckt body stays untouched.
    const xCard = result.netlist.elements.find((e) => e.spiceCard.startsWith("X"));
    expect(xCard!.spiceCard).toBe("XU1 1 0 2 OPAMP");
  });

  it("a subckt instance with an unconnected pin is a collected error, never a throw", () => {
    // Only inp/inn are wired; `out` is on no net → the X card cannot resolve it.
    const schematic = makeSchematic({
      id: "sch_opamp_floating",
      instances: [{ instanceId: "U1", componentId: "cmp_opamp_ideal" }],
      nets: [
        { netId: "net_inp", connections: [{ instanceId: "U1", pinId: "inp" }] },
        { netId: "net_inn", connections: [{ instanceId: "U1", pinId: "inn" }] },
      ],
    });
    let result!: ReturnType<typeof compileNetlist>;
    expect(() => {
      result = compileNetlist(schematic, resolve, { now: NOW });
    }).not.toThrow();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("not connected"))).toBe(true);
  });
});
