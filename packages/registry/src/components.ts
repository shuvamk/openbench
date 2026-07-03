import { IR_VERSION, type Component, type Provenance } from "@openbench/ir-schema";

/**
 * Curated component library: Phase 1 parts (issue #6) plus ten real-world
 * parts (issue #22).
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

export const diodeGeneric: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_diode_generic",
  name: "Diode (1N4148)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "passive" },
    { id: "k", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "D{ref} {a} {k} D1N4148",
    modelCard: ".model D1N4148 D(IS=2.52e-9 N=1.752)",
  },
  provenance: PROVENANCE,
};

export const npn2n2222: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_npn_2n2222",
  name: "NPN Transistor (2N2222)",
  category: "active",
  pins: [
    { id: "c", name: "C", electricalType: "passive" },
    { id: "b", name: "B", electricalType: "passive" },
    { id: "e", name: "E", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "Q{ref} {c} {b} {e} Q2N2222",
    modelCard: ".model Q2N2222 NPN(IS=1e-14 BF=200)",
  },
  provenance: PROVENANCE,
};

/**
 * Two series resistors around the wiper (issue #22). The `+ 1` floor keeps
 * both halves >= 1 ohm at position 0 and 1 so ngspice never sees a 0-ohm
 * resistor.
 */
export const potentiometer: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_potentiometer",
  name: "Potentiometer",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "wiper", name: "W", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [
    { name: "rtotal", unit: "ohm", default: 10000, type: "number" },
    { name: "position", default: 0.5, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template: "R{ref}A {p1} {wiper} {rA}\nR{ref}B {wiper} {p2} {rB}",
    derivedParams: {
      rA: "rtotal*position + 1",
      rB: "rtotal*(1-position) + 1",
    },
  },
  provenance: PROVENANCE,
};

/** Resistor switch: 1 mOhm pressed, ~1e12 ohm (open) released (issue #22). */
export const pushbutton: Component = {
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
  provenance: PROVENANCE,
};

/** Same resistor-switch trick as cmp_pushbutton, latched via `closed`. */
export const switchSpst: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_switch_spst",
  name: "Switch (SPST)",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "closed", default: 0, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {ronoff}",
    derivedParams: { ronoff: "0.001 + (1 - closed) * 1e12" },
  },
  provenance: PROVENANCE,
};

/**
 * DC model only: the winding resistance sets the stall current. `vnominal`
 * documents the rated voltage for UI/validation; it is not part of the
 * SPICE card.
 */
export const dcMotor: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_dc_motor",
  name: "DC Motor",
  category: "other",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [
    { name: "rwinding", unit: "ohm", default: 24, type: "number" },
    { name: "vnominal", unit: "volt", default: 6, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {rwinding}",
  },
  provenance: PROVENANCE,
};

export const buzzer: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_buzzer",
  name: "Buzzer",
  category: "other",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "r", unit: "ohm", default: 42, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {r}",
  },
  provenance: PROVENANCE,
};

export const lamp: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_lamp",
  name: "Lamp",
  category: "other",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "r", unit: "ohm", default: 60, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {r}",
  },
  provenance: PROVENANCE,
};

/**
 * Common-cathode RGB LED: a multi-line template expands to one D-card per
 * colour channel (one card per line, issue #21), all sharing one model card.
 */
export const rgbLed: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_rgb_led",
  name: "RGB LED",
  category: "active",
  pins: [
    { id: "r", name: "R", electricalType: "passive" },
    { id: "g", name: "G", electricalType: "passive" },
    { id: "b", name: "B", electricalType: "passive" },
    { id: "com", name: "COM", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template:
      "D{ref}R {r} {com} DLEDRGB\nD{ref}G {g} {com} DLEDRGB\nD{ref}B {b} {com} DLEDRGB",
    modelCard: ".model DLEDRGB D(IS=1e-14 N=2.0)",
  },
  provenance: PROVENANCE,
};

/** Photoresistor: linear interpolation from rdark (lux=0) to rlight (lux=1). */
export const ldr: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_ldr",
  name: "LDR (Photoresistor)",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [
    { name: "rdark", unit: "ohm", default: 100000, type: "number" },
    { name: "rlight", unit: "ohm", default: 1000, type: "number" },
    { name: "lux", default: 0.5, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template: "R{ref} {p1} {p2} {r}",
    derivedParams: { r: "rdark + (rlight - rdark) * lux" },
  },
  provenance: PROVENANCE,
};

/**
 * Fundamental parts (batch 3): the passives/actives that were missing from the
 * Phase 1 + issue #22 sets. Inductor completes the R/C/L trio (enables RL/RLC),
 * the SIN source unlocks AC/audio transient demos, zener/schottky diodes and the
 * PNP/NMOS devices round out the semiconductor palette. All simulate through the
 * standard template expansion; none need special compiler handling.
 */

/** Completes the R/C/L passive trio — enables RL and RLC transient demos. */
export const inductorGeneric: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_inductor_generic",
  name: "Inductor",
  category: "passive",
  pins: [
    { id: "p1", name: "1", electricalType: "passive" },
    { id: "p2", name: "2", electricalType: "passive" },
  ],
  parameters: [{ name: "inductance", unit: "henry", default: 1e-3, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "L{ref} {p1} {p2} {inductance}",
  },
  footprint: { kicadRef: "Inductor_SMD:L_0603_1608Metric" },
  provenance: PROVENANCE,
};

/**
 * SPICE SIN source. Defaults give a 0-centred 5V, 1kHz sine with no delay or
 * damping — an instant AC stimulus for the transient sim and the live view
 * (LEDs/motors/lamps pulse with it). SIN args: offset, amplitude, freq, delay,
 * damping factor.
 */
export const vsourceSin: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_vsource_sin",
  name: "Sine Voltage Source",
  category: "power",
  pins: [
    { id: "pos", name: "+", electricalType: "passive" },
    { id: "neg", name: "-", electricalType: "passive" },
  ],
  parameters: [
    { name: "voffset", unit: "volt", default: 0, type: "number" },
    { name: "vamplitude", unit: "volt", default: 5, type: "number" },
    { name: "frequency", unit: "hertz", default: 1000, type: "number" },
    { name: "tdelay", unit: "second", default: 0, type: "number" },
    { name: "damping", unit: "hertz", default: 0, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template:
      "V{ref} {pos} {neg} SIN({voffset} {vamplitude} {frequency} {tdelay} {damping})",
  },
  provenance: PROVENANCE,
};

/** Reverse-breakdown regulator: BV=5.1V clamps in reverse (D model with BV). */
export const zenerDiode: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_zener_diode",
  name: "Zener Diode (5.1V)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "passive" },
    { id: "k", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "D{ref} {a} {k} DZENER",
    modelCard: ".model DZENER D(IS=1e-14 N=1.5 BV=5.1)",
  },
  provenance: PROVENANCE,
};

/** Low forward-drop rectifier (BAT54-like): high IS + small series RS. */
export const schottkyDiode: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_schottky_diode",
  name: "Schottky Diode (BAT54)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "passive" },
    { id: "k", name: "K", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "D{ref} {a} {k} DSCHOTTKY",
    modelCard: ".model DSCHOTTKY D(IS=1e-7 N=1.0 RS=0.05)",
  },
  provenance: PROVENANCE,
};

/** Complement to the 2N2222 NPN — same c/b/e ordering, PNP model. */
export const pnp2n3906: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_pnp_2n3906",
  name: "PNP Transistor (2N3906)",
  category: "active",
  pins: [
    { id: "c", name: "C", electricalType: "passive" },
    { id: "b", name: "B", electricalType: "passive" },
    { id: "e", name: "E", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "Q{ref} {c} {b} {e} Q2N3906",
    modelCard: ".model Q2N3906 PNP(IS=1e-14 BF=180)",
  },
  provenance: PROVENANCE,
};

/**
 * N-channel enhancement MOSFET (2N7000-like). The 3-pin schematic part (d/g/s)
 * ties the SPICE bulk to the source, so the template repeats {s} for both the
 * source and body nodes: M{ref} d g s s MODEL.
 */
export const nmos2n7000: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_nmos_2n7000",
  name: "N-Channel MOSFET (2N7000)",
  category: "active",
  pins: [
    { id: "d", name: "D", electricalType: "passive" },
    { id: "g", name: "G", electricalType: "passive" },
    { id: "s", name: "S", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "M{ref} {d} {g} {s} {s} MOSN",
    modelCard: ".model MOSN NMOS(VTO=2.1 KP=0.05)",
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
