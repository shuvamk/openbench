import { describe, expect, it } from "vitest";
import { validateComponent } from "@openbench/ir-schema";
import { getComponent, registryComponents } from "../src/index";

/**
 * Acceptance tests for issue #79 — author `education` content for the three
 * hero parts (LED, resistor, capacitor). The block is optional and additive
 * (IR #78); adapters ignore it. These tests pin the three authored entries and
 * guard the integrity of every authored block against param-name drift, while
 * confirming the other parts stay valid with no block at all.
 */

const HERO_IDS = ["cmp_led_generic", "cmp_resistor_generic", "cmp_capacitor_generic"] as const;

/** The parameter names a component actually declares. */
function paramNames(id: string): Set<string> {
  return new Set((getComponent(id)?.parameters ?? []).map((p) => p.name));
}

describe("hero-part education content (issue #79)", () => {
  it("the three hero parts each carry a non-empty education block and still validate", () => {
    for (const id of HERO_IDS) {
      const part = getComponent(id);
      expect(part, `${id} should be in the registry`).toBeDefined();
      const edu = part!.education;
      expect(edu, `${id} should carry an education block`).toBeDefined();
      // "Non-empty": at least a summary and at least one gotcha.
      expect(edu!.summary && edu!.summary.length > 0).toBe(true);
      expect(Array.isArray(edu!.gotchas) && edu!.gotchas!.length > 0).toBe(true);
      expect(validateComponent(part!).valid, `${id} must still pass validateComponent`).toBe(true);
    }
  });

  it("the LED gotchas call out polarity and the current-limiting resistor", () => {
    const gotchas = (getComponent("cmp_led_generic")!.education!.gotchas ?? []).join(" \n ");
    expect(gotchas).toMatch(/polari/i); // polarity / polarized
    expect(gotchas).toMatch(/current[-\s]?limit/i);
    expect(gotchas).toMatch(/resistor/i);
  });

  it("paramNotes keys only reference parameters that actually exist on the part", () => {
    for (const id of HERO_IDS) {
      const notes = getComponent(id)!.education?.paramNotes ?? {};
      const declared = paramNames(id);
      for (const key of Object.keys(notes)) {
        expect(declared.has(key), `${id} paramNotes references unknown param "${key}"`).toBe(true);
      }
    }
  });

  it("an interactiveHint targetParam resolves against its target component's params", () => {
    for (const id of HERO_IDS) {
      const hint = getComponent(id)!.education?.interactiveHint;
      if (!hint) continue;
      const targetId = hint.targetComponentId ?? id;
      const declared = paramNames(targetId);
      expect(getComponent(targetId), `${id} hint targets unknown component ${targetId}`).toBeDefined();
      expect(
        declared.has(hint.targetParam),
        `${id} interactiveHint targetParam "${hint.targetParam}" is not a param of ${targetId}`,
      ).toBe(true);
    }
  });

  it("parts without authored content stay valid and simply expose no education block", () => {
    const authored = new Set<string>(HERO_IDS);
    let sawUnauthored = false;
    for (const part of registryComponents) {
      if (authored.has(part.id)) continue;
      sawUnauthored = true;
      expect(part.education, `${part.id} should have no education block`).toBeUndefined();
      expect(validateComponent(part).valid, `${part.id} must stay valid`).toBe(true);
    }
    // Sanity: the epic's "only 3 parts" scope means there ARE unauthored parts.
    expect(sawUnauthored).toBe(true);
  });
});
