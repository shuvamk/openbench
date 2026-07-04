import { describe, expect, it } from "vitest";
import { validateComponent, type Component } from "@openbench/ir-schema";
import { getComponent, registryComponents } from "../src/index";

/**
 * Acceptance tests for issue #6 (curated Phase 1 registry) and issue #22
 * (ten real-world parts). Every entry is a full Component IR document
 * (kind "component") stamped with registry provenance; templates may only
 * reference declared tokens (ref, pin ids, parameter names, derivedParams keys).
 */

const EXPECTED_IDS = [
  "cmp_resistor_generic",
  "cmp_capacitor_generic",
  "cmp_led_generic",
  "cmp_vsource_dc",
  "cmp_vsource_pulse",
  "cmp_ground",
  "cmp_esp32_devkit",
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
  "cmp_inductor_generic",
  "cmp_vsource_sin",
  "cmp_zener_diode",
  "cmp_schottky_diode",
  "cmp_pnp_2n3906",
  "cmp_nmos_2n7000",
  "cmp_opamp_ideal",
  "cmp_tmp36",
];

const byId = (id: string): Component => {
  const component = registryComponents.find((c) => c.id === id);
  if (!component) throw new Error(`registry is missing ${id}`);
  return component;
};

describe("registryComponents", () => {
  it("contains exactly the curated parts (Phase 1 + issue #22)", () => {
    expect(registryComponents.map((c) => c.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every part passes validateComponent", () => {
    for (const component of registryComponents) {
      const result = validateComponent(component);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it("all ids are unique", () => {
    const ids = registryComponents.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all ids use the cmp_ prefix", () => {
    for (const component of registryComponents) {
      expect(component.id).toMatch(/^cmp_[a-z0-9_]+$/);
    }
  });

  it("every simModel template token is declared (ref, pin ids, parameter names, derivedParams keys)", () => {
    for (const component of registryComponents) {
      if (!component.simModel) continue;
      const declared = new Set([
        "ref",
        ...component.pins.map((p) => p.id),
        ...component.parameters.map((p) => p.name),
        ...Object.keys(component.simModel.derivedParams ?? {}),
      ]);
      const tokens = [...component.simModel.template.matchAll(/\{([^{}]+)\}/g)].map(
        (m) => m[1],
      );
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(declared.has(token as string)).toBe(true);
      }
    }
  });

  it("every part carries registry-curator provenance", () => {
    for (const component of registryComponents) {
      expect(component.provenance).toEqual({
        source: "registry",
        addedBy: "registry-curator",
        at: "2026-07-02T00:00:00Z",
      });
    }
  });
});

describe("getComponent", () => {
  it("returns the component for a known id", () => {
    const resistor = getComponent("cmp_resistor_generic");
    expect(resistor).toBeDefined();
    expect(resistor?.id).toBe("cmp_resistor_generic");
    expect(resistor?.kind).toBe("component");
  });

  it("returns undefined for an unknown id", () => {
    expect(getComponent("cmp_flux_capacitor")).toBeUndefined();
    expect(getComponent("")).toBeUndefined();
  });
});

describe("curated parts", () => {
  it("cmp_resistor_generic matches the canonical spec example", () => {
    const resistor = byId("cmp_resistor_generic");
    expect(resistor.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(resistor.pins.every((p) => p.electricalType === "passive")).toBe(true);
    expect(resistor.parameters).toEqual([
      { name: "resistance", unit: "ohm", default: 1000, type: "number" },
    ]);
    expect(resistor.simModel?.template).toBe("R{ref} {p1} {p2} {resistance}");
    expect(resistor.footprint?.kicadRef).toBe("Resistor_SMD:R_0603_1608Metric");
  });

  it("cmp_capacitor_generic has p1/p2 and a farad-valued capacitance parameter", () => {
    const capacitor = byId("cmp_capacitor_generic");
    expect(capacitor.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(capacitor.parameters).toEqual([
      { name: "capacitance", unit: "farad", default: 1e-6, type: "number" },
    ]);
    expect(capacitor.simModel?.template).toBe("C{ref} {p1} {p2} {capacitance}");
  });

  it("cmp_led_generic has anode/cathode pins and a DLED model card", () => {
    const led = byId("cmp_led_generic");
    expect(led.pins.map((p) => p.id)).toEqual(["anode", "cathode"]);
    expect(led.pins.every((p) => p.electricalType === "passive")).toBe(true);
    expect(led.parameters).toEqual([]);
    expect(led.simModel?.template).toBe("D{ref} {anode} {cathode} DLED");
    expect(led.simModel?.modelCard).toBe(".model DLED D(IS=1e-14 N=2.0)");
  });

  it("cmp_vsource_dc has pos/neg pins and a volt-valued voltage parameter", () => {
    const vsource = byId("cmp_vsource_dc");
    expect(vsource.pins.map((p) => p.id)).toEqual(["pos", "neg"]);
    expect(vsource.parameters).toEqual([
      { name: "voltage", unit: "volt", default: 5, type: "number" },
    ]);
    expect(vsource.simModel?.template).toBe("V{ref} {pos} {neg} DC {voltage}");
  });

  it("cmp_vsource_pulse has pos/neg pins, PULSE timing parameters and a PULSE template", () => {
    const vsource = byId("cmp_vsource_pulse");
    expect(vsource.category).toBe("power");
    expect(vsource.pins.map((p) => p.id)).toEqual(["pos", "neg"]);
    expect(vsource.parameters).toEqual([
      { name: "vlow", unit: "volt", default: 0, type: "number" },
      { name: "vhigh", unit: "volt", default: 5, type: "number" },
      { name: "tdelay", unit: "second", default: 0, type: "number" },
      { name: "trise", unit: "second", default: 1e-6, type: "number" },
      { name: "tfall", unit: "second", default: 1e-6, type: "number" },
      { name: "ton", unit: "second", default: 4e-4, type: "number" },
      { name: "tperiod", unit: "second", default: 1e-3, type: "number" },
    ]);
    expect(vsource.simModel?.template).toBe(
      "V{ref} {pos} {neg} PULSE({vlow} {vhigh} {tdelay} {trise} {tfall} {ton} {tperiod})",
    );
    expect(vsource.footprint).toBeUndefined();
  });

  it("cmp_ground is a single power_in pin with no simModel", () => {
    const ground = byId("cmp_ground");
    expect(ground.category).toBe("power");
    expect(ground.pins).toHaveLength(1);
    expect(ground.pins[0]?.id).toBe("gnd");
    expect(ground.pins[0]?.electricalType).toBe("power_in");
    expect(ground.simModel).toBeUndefined();
  });

  it("cmp_esp32_devkit exposes the required pins with correct electrical types", () => {
    const esp32 = byId("cmp_esp32_devkit");
    expect(esp32.category).toBe("mcu");
    expect(esp32.simModel).toBeUndefined();
    expect(esp32.footprint?.kicadRef).toBe("Module:ESP32-DevKitC");

    const types = new Map(esp32.pins.map((p) => [p.id, p.electricalType]));
    expect(types.get("3V3")).toBe("power_out");
    expect(types.get("GND")).toBe("power_in");
    expect(types.get("EN")).toBe("input");
    expect(types.get("GPIO2")).toBe("bidirectional");
    expect(types.get("GPIO4")).toBe("bidirectional");
    expect(types.get("TX0")).toBe("output");
    expect(types.get("RX0")).toBe("input");
  });
});

describe("real-world parts (issue #22)", () => {
  it("cmp_diode_generic has a/k pins and a 1N4148-style model card", () => {
    const diode = byId("cmp_diode_generic");
    expect(diode.category).toBe("active");
    expect(diode.pins.map((p) => p.id)).toEqual(["a", "k"]);
    expect(diode.parameters).toEqual([]);
    expect(diode.simModel?.template).toBe("D{ref} {a} {k} D1N4148");
    expect(diode.simModel?.modelCard).toBe(".model D1N4148 D(IS=2.52e-9 N=1.752)");
  });

  it("cmp_npn_2n2222 has c/b/e pins and a 2N2222 model card", () => {
    const npn = byId("cmp_npn_2n2222");
    expect(npn.category).toBe("active");
    expect(npn.pins.map((p) => p.id)).toEqual(["c", "b", "e"]);
    expect(npn.parameters).toEqual([]);
    expect(npn.simModel?.template).toBe("Q{ref} {c} {b} {e} Q2N2222");
    expect(npn.simModel?.modelCard).toBe(".model Q2N2222 NPN(IS=1e-14 BF=200)");
  });

  it("cmp_potentiometer derives both halves from rtotal and position", () => {
    const pot = byId("cmp_potentiometer");
    expect(pot.category).toBe("passive");
    expect(pot.pins.map((p) => p.id)).toEqual(["p1", "wiper", "p2"]);
    expect(pot.parameters).toEqual([
      { name: "rtotal", unit: "ohm", default: 10000, type: "number" },
      { name: "position", default: 0.5, type: "number" },
    ]);
    expect(pot.simModel?.derivedParams).toEqual({
      rA: "rtotal*position + 1",
      rB: "rtotal*(1-position) + 1",
    });
    expect(pot.simModel?.template).toBe(
      "R{ref}A {p1} {wiper} {rA}\nR{ref}B {wiper} {p2} {rB}",
    );
  });

  it("cmp_pushbutton derives its on/off resistance from pressed", () => {
    const button = byId("cmp_pushbutton");
    expect(button.category).toBe("passive");
    expect(button.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(button.parameters).toEqual([{ name: "pressed", default: 0, type: "number" }]);
    expect(button.simModel?.derivedParams).toEqual({
      ronoff: "0.001 + (1 - pressed) * 1e12",
    });
    expect(button.simModel?.template).toBe("R{ref} {p1} {p2} {ronoff}");
  });

  it("cmp_switch_spst derives its on/off resistance from closed", () => {
    const spst = byId("cmp_switch_spst");
    expect(spst.category).toBe("passive");
    expect(spst.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(spst.parameters).toEqual([{ name: "closed", default: 0, type: "number" }]);
    expect(spst.simModel?.derivedParams).toEqual({
      ronoff: "0.001 + (1 - closed) * 1e12",
    });
    expect(spst.simModel?.template).toBe("R{ref} {p1} {p2} {ronoff}");
  });

  it("cmp_dc_motor models the winding resistance and declares vnominal", () => {
    const motor = byId("cmp_dc_motor");
    expect(motor.category).toBe("other");
    expect(motor.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(motor.parameters).toEqual([
      { name: "rwinding", unit: "ohm", default: 24, type: "number" },
      { name: "vnominal", unit: "volt", default: 6, type: "number" },
    ]);
    expect(motor.simModel?.template).toBe("R{ref} {p1} {p2} {rwinding}");
  });

  it("cmp_buzzer is a 42-ohm resistive load", () => {
    const buzzer = byId("cmp_buzzer");
    expect(buzzer.category).toBe("other");
    expect(buzzer.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(buzzer.parameters).toEqual([
      { name: "r", unit: "ohm", default: 42, type: "number" },
    ]);
    expect(buzzer.simModel?.template).toBe("R{ref} {p1} {p2} {r}");
  });

  it("cmp_lamp is a 60-ohm resistive load", () => {
    const lamp = byId("cmp_lamp");
    expect(lamp.category).toBe("other");
    expect(lamp.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(lamp.parameters).toEqual([
      { name: "r", unit: "ohm", default: 60, type: "number" },
    ]);
    expect(lamp.simModel?.template).toBe("R{ref} {p1} {p2} {r}");
  });

  it("cmp_rgb_led expands to three diode cards sharing one model card", () => {
    const rgb = byId("cmp_rgb_led");
    expect(rgb.category).toBe("active");
    expect(rgb.pins.map((p) => p.id)).toEqual(["r", "g", "b", "com"]);
    expect(rgb.parameters).toEqual([]);
    expect(rgb.simModel?.template).toBe(
      "D{ref}R {r} {com} DLEDRGB\nD{ref}G {g} {com} DLEDRGB\nD{ref}B {b} {com} DLEDRGB",
    );
    expect(rgb.simModel?.modelCard).toBe(".model DLEDRGB D(IS=1e-14 N=2.0)");
  });

  it("cmp_ldr interpolates its resistance between rdark and rlight by lux", () => {
    const ldr = byId("cmp_ldr");
    expect(ldr.category).toBe("passive");
    expect(ldr.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(ldr.parameters).toEqual([
      { name: "rdark", unit: "ohm", default: 100000, type: "number" },
      { name: "rlight", unit: "ohm", default: 1000, type: "number" },
      { name: "lux", default: 0.5, type: "number" },
    ]);
    expect(ldr.simModel?.derivedParams).toEqual({
      r: "rdark + (rlight - rdark) * lux",
    });
    expect(ldr.simModel?.template).toBe("R{ref} {p1} {p2} {r}");
  });
});

describe("fundamental parts (batch 3)", () => {
  it("cmp_inductor_generic has p1/p2 and a henry-valued inductance parameter", () => {
    const inductor = byId("cmp_inductor_generic");
    expect(inductor.category).toBe("passive");
    expect(inductor.pins.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(inductor.pins.every((p) => p.electricalType === "passive")).toBe(true);
    expect(inductor.parameters).toEqual([
      { name: "inductance", unit: "henry", default: 1e-3, type: "number" },
    ]);
    expect(inductor.simModel?.template).toBe("L{ref} {p1} {p2} {inductance}");
    expect(inductor.footprint?.kicadRef).toBe("Inductor_SMD:L_0603_1608Metric");
  });

  it("cmp_vsource_sin has pos/neg pins, SIN parameters and a SIN template", () => {
    const sin = byId("cmp_vsource_sin");
    expect(sin.category).toBe("power");
    expect(sin.pins.map((p) => p.id)).toEqual(["pos", "neg"]);
    expect(sin.parameters).toEqual([
      { name: "voffset", unit: "volt", default: 0, type: "number" },
      { name: "vamplitude", unit: "volt", default: 5, type: "number" },
      { name: "frequency", unit: "hertz", default: 1000, type: "number" },
      { name: "tdelay", unit: "second", default: 0, type: "number" },
      { name: "damping", unit: "hertz", default: 0, type: "number" },
    ]);
    expect(sin.simModel?.template).toBe(
      "V{ref} {pos} {neg} SIN({voffset} {vamplitude} {frequency} {tdelay} {damping})",
    );
    expect(sin.footprint).toBeUndefined();
  });

  it("cmp_zener_diode has a/k pins and a 5.1V BV model card", () => {
    const zener = byId("cmp_zener_diode");
    expect(zener.category).toBe("active");
    expect(zener.pins.map((p) => p.id)).toEqual(["a", "k"]);
    expect(zener.parameters).toEqual([]);
    expect(zener.simModel?.template).toBe("D{ref} {a} {k} DZENER");
    expect(zener.simModel?.modelCard).toBe(".model DZENER D(IS=1e-14 N=1.5 BV=5.1)");
  });

  it("cmp_schottky_diode has a/k pins and a low-drop model card", () => {
    const schottky = byId("cmp_schottky_diode");
    expect(schottky.category).toBe("active");
    expect(schottky.pins.map((p) => p.id)).toEqual(["a", "k"]);
    expect(schottky.parameters).toEqual([]);
    expect(schottky.simModel?.template).toBe("D{ref} {a} {k} DSCHOTTKY");
    expect(schottky.simModel?.modelCard).toBe(".model DSCHOTTKY D(IS=1e-7 N=1.0 RS=0.05)");
  });

  it("cmp_pnp_2n3906 has c/b/e pins and a 2N3906 PNP model card", () => {
    const pnp = byId("cmp_pnp_2n3906");
    expect(pnp.category).toBe("active");
    expect(pnp.pins.map((p) => p.id)).toEqual(["c", "b", "e"]);
    expect(pnp.parameters).toEqual([]);
    expect(pnp.simModel?.template).toBe("Q{ref} {c} {b} {e} Q2N3906");
    expect(pnp.simModel?.modelCard).toBe(".model Q2N3906 PNP(IS=1e-14 BF=180)");
  });

  it("cmp_nmos_2n7000 has d/g/s pins, ties bulk to source, and an NMOS model card", () => {
    const nmos = byId("cmp_nmos_2n7000");
    expect(nmos.category).toBe("active");
    expect(nmos.pins.map((p) => p.id)).toEqual(["d", "g", "s"]);
    expect(nmos.parameters).toEqual([]);
    expect(nmos.simModel?.template).toBe("M{ref} {d} {g} {s} {s} MOSN");
    expect(nmos.simModel?.modelCard).toBe(".model MOSN NMOS(VTO=2.1 KP=0.05)");
  });
});

describe("ICs (batch 4, issue #44)", () => {
  it("cmp_opamp_ideal is a subckt part: X-card template + a .subckt block", () => {
    const opamp = byId("cmp_opamp_ideal");
    expect(opamp.category).toBe("active");
    expect(opamp.pins.map((p) => p.id)).toEqual(["inp", "inn", "out"]);
    expect(opamp.pins.map((p) => p.electricalType)).toEqual(["input", "input", "output"]);
    expect(opamp.parameters).toEqual([]);
    expect(opamp.simModel?.template).toBe("X{ref} {inp} {inn} {out} OPAMP");
    expect(opamp.simModel?.subckt).toBe(
      ".subckt OPAMP inp inn out\nEout out 0 inp inn 100k\n.ends OPAMP",
    );
  });

  it("cmp_tmp36 is a temp sensor whose output voltage derives from tempC", () => {
    const tmp36 = byId("cmp_tmp36");
    expect(tmp36.category).toBe("sensor");
    expect(tmp36.pins.map((p) => p.id)).toEqual(["vs", "vout", "gnd"]);
    expect(tmp36.parameters).toEqual([
      { name: "tempC", unit: "celsius", default: 25, type: "number" },
    ]);
    // TMP36: Vout = 500mV + 10mV/°C.
    expect(tmp36.simModel?.derivedParams).toEqual({ vout_v: "0.5 + 0.01 * tempC" });
    expect(tmp36.simModel?.template).toBe("V{ref} {vout} {gnd} DC {vout_v}");
  });
});
