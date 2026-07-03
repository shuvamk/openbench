// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registryComponents } from "@openbench/registry";
import { getSymbolGeometry, getSymbolKind } from "../lib/editor/geometry";
import { refPrefix } from "../lib/editor/mutations";
import { SymbolGlyph } from "../components/editor/symbols";

/**
 * Issue #23 acceptance: every curated registry part renders a real symbol
 * (never the generic fallback box), and its pin anchors cover exactly the
 * declared pin ids — wire connectivity depends on that invariant.
 */
describe("symbol coverage for the curated registry", () => {
  for (const component of registryComponents) {
    it(`${component.id} resolves to a non-generic symbol kind`, () => {
      expect(getSymbolKind(component)).not.toBe("generic");
    });

    it(`${component.id} pin anchors cover exactly its declared pins`, () => {
      const anchors = getSymbolGeometry(component).pins;
      expect(Object.keys(anchors).sort()).toEqual(component.pins.map((p) => p.id).sort());
    });

    it(`${component.id} glyph renders`, () => {
      const { container } = render(
        <svg>
          <SymbolGlyph component={component} />
        </svg>,
      );
      expect(container.querySelector("g")).not.toBeNull();
    });
  }
});

describe("dedicated symbol kinds (issue #23)", () => {
  const expectations: Record<string, string> = {
    cmp_diode_generic: "diode",
    cmp_npn_2n2222: "npn",
    cmp_potentiometer: "potentiometer",
    cmp_pushbutton: "pushbutton",
    cmp_switch_spst: "switch",
    cmp_dc_motor: "motor",
    cmp_buzzer: "buzzer",
    cmp_lamp: "lamp",
    cmp_rgb_led: "rgbled",
    cmp_ldr: "ldr",
    cmp_led_generic: "led",
  };
  for (const [id, kind] of Object.entries(expectations)) {
    it(`${id} → ${kind}`, () => {
      const component = registryComponents.find((c) => c.id === id);
      expect(component).toBeDefined();
      expect(getSymbolKind(component!)).toBe(kind);
    });
  }

  it("interactive parts get readable instance prefixes", () => {
    const byId = new Map(registryComponents.map((c) => [c.id, c]));
    expect(refPrefix(byId.get("cmp_pushbutton")!)).toBe("BTN");
    expect(refPrefix(byId.get("cmp_switch_spst")!)).toBe("SW");
    expect(refPrefix(byId.get("cmp_dc_motor")!)).toBe("M");
    expect(refPrefix(byId.get("cmp_potentiometer")!)).toBe("RV");
    expect(refPrefix(byId.get("cmp_buzzer")!)).toBe("BZ");
    expect(refPrefix(byId.get("cmp_lamp")!)).toBe("LA");
    expect(refPrefix(byId.get("cmp_ldr")!)).toBe("LDR");
  });
});
