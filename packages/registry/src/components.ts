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

/**
 * Integrated-circuit parts (batch 4, issue #44) — the first parts that expand
 * through the `.subckt` path (ADR-0017). More ICs (NE555, 74xx logic) follow
 * once their behavioral SPICE models are verified in a browser WASM session.
 */

/**
 * Ideal op-amp as a one-line VCVS subcircuit (open-loop gain 100k referenced to
 * global node 0). With external feedback this gives textbook closed-loop gains —
 * enough for active filters, integrators, and buffers. Real behaviour verified
 * in-browser (the node MockBackend returns synthetic waveforms, not SPICE).
 */
export const opampIdeal: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_opamp_ideal",
  name: "Op-Amp (ideal)",
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
  provenance: PROVENANCE,
};

/**
 * TMP36 analog temperature sensor: Vout = 500mV + 10mV/°C, modeled as a DC
 * source between `vout` and `gnd` whose voltage derives from `tempC`. The `vs`
 * supply pin exists for wiring/ERC but is not part of the SPICE card.
 */
export const tmp36: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_tmp36",
  name: "TMP36 Temp Sensor",
  category: "sensor",
  pins: [
    { id: "vs", name: "+Vs", electricalType: "power_in" },
    { id: "vout", name: "Vout", electricalType: "output" },
    { id: "gnd", name: "GND", electricalType: "power_in" },
  ],
  parameters: [{ name: "tempC", unit: "celsius", default: 25, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "V{ref} {vout} {gnd} DC {vout_v}",
    derivedParams: { vout_v: "0.5 + 0.01 * tempC" },
  },
  provenance: PROVENANCE,
};

/**
 * Current sources (batch 5) — the Norton complement to the voltage sources.
 * Enables current-driven biasing, Norton equivalents, and current-mode demos.
 */

/** Ideal DC current source: pushes `current` amps from pos to neg. */
export const isourceDc: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_isource_dc",
  name: "DC Current Source",
  category: "power",
  pins: [
    { id: "pos", name: "+", electricalType: "passive" },
    { id: "neg", name: "-", electricalType: "passive" },
  ],
  parameters: [{ name: "current", unit: "ampere", default: 0.001, type: "number" }],
  simModel: {
    engine: "ngspice",
    template: "I{ref} {pos} {neg} DC {current}",
  },
  provenance: PROVENANCE,
};

/** Sinusoidal current source — AC current stimulus (mirrors cmp_vsource_sin). */
export const isourceSin: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_isource_sin",
  name: "Sine Current Source",
  category: "power",
  pins: [
    { id: "pos", name: "+", electricalType: "passive" },
    { id: "neg", name: "-", electricalType: "passive" },
  ],
  parameters: [
    { name: "ioffset", unit: "ampere", default: 0, type: "number" },
    { name: "iamplitude", unit: "ampere", default: 0.001, type: "number" },
    { name: "frequency", unit: "hertz", default: 1000, type: "number" },
    { name: "tdelay", unit: "second", default: 0, type: "number" },
    { name: "damping", unit: "hertz", default: 0, type: "number" },
  ],
  simModel: {
    engine: "ngspice",
    template:
      "I{ref} {pos} {neg} SIN({ioffset} {iamplitude} {frequency} {tdelay} {damping})",
  },
  provenance: PROVENANCE,
};

/**
 * Digital & visual ICs (batch 6, issue #44). The 74xx logic gates expand through
 * the `.subckt` path (ADR-0017) as single-gate behavioral models: an ngspice
 * `B` (behavioral) source drives the output to a 0/5V logic level via nested
 * ternaries over a 2.5V input threshold — no boolean operators, correct by
 * inspection. Output is referenced to global node 0 (like `cmp_opamp_ideal`), so
 * no supply pins are needed for the simulation. The 7-segment display is purely
 * visual: eight segment LEDs sharing one common cathode (same DLED physics as the
 * existing LED/RGB parts). Exact SPICE logic timing is browser-WASM-verified; the
 * node MockBackend returns synthetic waveforms, not SPICE physics.
 */

/** 7400 quad NAND — one gate: Y = NOT(A AND B), TTL-ish 2.5V input threshold. */
export const logic7400: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_logic_7400",
  name: "NAND Gate (7400)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "input" },
    { id: "b", name: "B", electricalType: "input" },
    { id: "y", name: "Y", electricalType: "output" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "X{ref} {a} {b} {y} NAND7400",
    subckt:
      ".subckt NAND7400 a b y\nBy y 0 V = (V(a) > 2.5) ? ((V(b) > 2.5) ? 0 : 5) : 5\n.ends NAND7400",
  },
  provenance: PROVENANCE,
};

/** 7404 hex inverter — one gate: Y = NOT(A). */
export const logic7404: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_logic_7404",
  name: "NOT Gate (7404)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "input" },
    { id: "y", name: "Y", electricalType: "output" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "X{ref} {a} {y} NOT7404",
    subckt: ".subckt NOT7404 a y\nBy y 0 V = (V(a) > 2.5) ? 0 : 5\n.ends NOT7404",
  },
  provenance: PROVENANCE,
};

/** 7408 quad AND — one gate: Y = A AND B. */
export const logic7408: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_logic_7408",
  name: "AND Gate (7408)",
  category: "active",
  pins: [
    { id: "a", name: "A", electricalType: "input" },
    { id: "b", name: "B", electricalType: "input" },
    { id: "y", name: "Y", electricalType: "output" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template: "X{ref} {a} {b} {y} AND7408",
    subckt:
      ".subckt AND7408 a b y\nBy y 0 V = (V(a) > 2.5) ? ((V(b) > 2.5) ? 5 : 0) : 0\n.ends AND7408",
  },
  provenance: PROVENANCE,
};

/**
 * Common-cathode 7-segment display: eight anode segments (a–g plus decimal point
 * dp) share one common cathode. A multi-line template emits one D-card per segment
 * (one card per line, issue #21), all sharing the DSEG model — the same LED physics
 * as `cmp_led_generic`. Driving a segment high lights it in the live view.
 */
export const sevenSegmentDisplay: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_7segment_display",
  name: "7-Segment Display",
  category: "other",
  pins: [
    { id: "a", name: "a", electricalType: "passive" },
    { id: "b", name: "b", electricalType: "passive" },
    { id: "c", name: "c", electricalType: "passive" },
    { id: "d", name: "d", electricalType: "passive" },
    { id: "e", name: "e", electricalType: "passive" },
    { id: "f", name: "f", electricalType: "passive" },
    { id: "g", name: "g", electricalType: "passive" },
    { id: "dp", name: "dp", electricalType: "passive" },
    { id: "com", name: "COM", electricalType: "passive" },
  ],
  parameters: [],
  simModel: {
    engine: "ngspice",
    template:
      "D{ref}a {a} {com} DSEG\n" +
      "D{ref}b {b} {com} DSEG\n" +
      "D{ref}c {c} {com} DSEG\n" +
      "D{ref}d {d} {com} DSEG\n" +
      "D{ref}e {e} {com} DSEG\n" +
      "D{ref}f {f} {com} DSEG\n" +
      "D{ref}g {g} {com} DSEG\n" +
      "D{ref}dp {dp} {com} DSEG",
    modelCard: ".model DSEG D(IS=1e-14 N=2.0)",
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
