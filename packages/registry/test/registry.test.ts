import { describe, expect, it } from "vitest";
import { validateComponent, type Component } from "@openbench/ir-schema";
import { getComponent, registryComponents } from "../src/index";

/**
 * Acceptance tests for issue #6 — the curated component registry.
 * Every entry is a full Component IR document (kind "component") stamped
 * with registry provenance; templates may only reference declared tokens.
 */

const EXPECTED_IDS = [
  "cmp_resistor_generic",
  "cmp_capacitor_generic",
  "cmp_led_generic",
  "cmp_vsource_dc",
  "cmp_vsource_pulse",
  "cmp_ground",
  "cmp_esp32_devkit",
];

const byId = (id: string): Component => {
  const component = registryComponents.find((c) => c.id === id);
  if (!component) throw new Error(`registry is missing ${id}`);
  return component;
};

describe("registryComponents", () => {
  it("contains exactly the curated Phase 1 parts", () => {
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

  it("every simModel template token is declared (ref, pin ids, parameter names)", () => {
    for (const component of registryComponents) {
      if (!component.simModel) continue;
      const declared = new Set([
        "ref",
        ...component.pins.map((p) => p.id),
        ...component.parameters.map((p) => p.name),
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
