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

const registry = new Map<string, Component>(
  [resistor, capacitor, vsource, ground, ledRed, ledGreen, esp32].map((c) => [c.id, c]),
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
