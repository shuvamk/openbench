import { IR_VERSION, type Component, type Provenance } from "@openbench/ir-schema";

/**
 * Curated Phase 1 component library (issue #6).
 *
 * Every entry is a full Component IR document — the same shape
 * `validateComponent` accepts — stamped with registry provenance. Parts that
 * only exist for netlist semantics (ground) or firmware emulation (ESP32
 * DevKit) deliberately carry NO simModel; the netlist compiler treats them
 * specially instead of emitting a SPICE card.
 */

const PROVENANCE: Provenance = {
  source: "registry",
  addedBy: "registry-curator",
  at: "2026-07-02T00:00:00Z",
};

export const resistorGeneric: Component = {
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
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {resistance}",
  },
  footprint: { kicadRef: "Resistor_SMD:R_0603_1608Metric" },
  provenance: PROVENANCE,
};

export const capacitorGeneric: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_capacitor_generic",
  name: "Capacitor",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "capacitance", unit: "farad", default: 1e-6, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "C{ref} {p1} {p2} {capacitance}",
  },
  footprint: { kicadRef: "Capacitor_SMD:C_0603_1608Metric" },
  provenance: PROVENANCE,
};

export const ledGeneric: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_led_generic",
  name: "LED",
  category: "passive",
  pins: [
    { id: "anode", name: "A", electricalType: "passive" },
    { id: "cathode", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "D{ref} {anode} {cathode} DLED",
    modelCard: ".model DLED D(IS=1e-14 N=2.0)",
  },
  footprint: { kicadRef: "LED_SMD:LED_0603_1608Metric" },
  provenance: PROVENANCE,
};

export const vsourceDc: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_vsource_dc",
  name: "DC Voltage Source",
  category: "power",
  pins: [
    { id: "pos", name: "+", electricalType: "passive" },
    { id: "neg", name: "-", electricalType: "passive" },
  ],
  parameters: [{ name: "voltage", unit: "volt", default: 5, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "V{ref} {pos} {neg} DC {voltage}",
  },
  provenance: PROVENANCE,
};

/**
 * SPICE PULSE source (issue #17). Defaults give a 0→5V, ~1kHz square wave
 * (400us on / 1ms period, 1us edges) — enough to show dynamic RC behaviour
 * in a transient run without any parameter overrides.
 */
export const vsourcePulse: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_vsource_pulse",
  name: "Pulse Voltage Source",
  category: "power",
  pins: [
    { id: "pos", name: "+", electricalType: "passive" },
    { id: "neg", name: "-", electricalType: "passive" },
  ],
  parameters: [
    { name: "vlow", unit: "volt", default: 0, type: "number" },
    { name: "vhigh", unit: "volt", default: 5, type: "number" },
    { name: "tdelay", unit: "second", default: 0, type: "number" },
    { name: "trise", unit: "second", default: 1e-6, type: "number" },
    { name: "tfall", unit: "second", default: 1e-6, type: "number" },
    { name: "ton", unit: "second", default: 4e-4, type: "number" },
    { name: "tperiod", unit: "second", default: 1e-3, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template:
      "V{ref} {pos} {neg} PULSE({vlow} {vhigh} {tdelay} {trise} {tfall} {ton} {tperiod})",
  },
  provenance: PROVENANCE,
};

/** Names the ground net only — no simModel; SPICE node 0 comes from the compiler. */
export const ground: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_ground",
  name: "Ground",
  category: "power",
  pins: [{ id: "gnd", name: "GND", electricalType: "power_in" }],
  parameters: [],
  provenance: PROVENANCE,
};

/** Emulated by Renode/QEMU, not SPICE — hence no simModel. */
export const esp32Devkit: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_esp32_devkit",
  name: "ESP32 DevKitC",
  category: "mcu",
  pins: [
    { id: "3V3", name: "3V3", electricalType: "power_out" },
    { id: "GND", name: "GND", electricalType: "power_in" },
    { id: "EN", name: "EN", electricalType: "input" },
    { id: "GPIO2", name: "GPIO2", electricalType: "bidirectional" },
    { id: "GPIO4", name: "GPIO4", electricalType: "bidirectional" },
    { id: "TX0", name: "TX0", electricalType: "output" },
    { id: "RX0", name: "RX0", electricalType: "input" },
    { id: "VIN", name: "VIN", electricalType: "power_in" },
  ],
  parameters: [],
  footprint: { kicadRef: "Module:ESP32-DevKitC" },
  provenance: PROVENANCE,
};
