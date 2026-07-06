import { describe, expect, it } from "vitest";
import { validateComponent, type Component } from "@openbench/ir-schema";
import { getComponent } from "../src/index";

/**
 * Acceptance tests for issue #170 — extend `education` content + `interactiveHint`
 * to the next tier of hero parts. The generic Learn panel (#80) and live "try it"
 * knob (#81) already render any authored block, so this is content-only: the guard
 * is that each authored block validates, its `paramNotes`/`interactiveHint`
 * reference parameters that actually exist, and every `interactiveHint.observe`
 * names a derived series the subject's `liveKind` actually emits (otherwise the
 * knob's read-out would be perpetually blank).
 */

const TIER2_IDS = [
  "cmp_diode_generic",
  "cmp_potentiometer",
  "cmp_dc_motor",
  "cmp_pushbutton",
] as const;

/** The parameter names a component actually declares. */
function paramNames(id: string): Set<string> {
  return new Set((getComponent(id)?.parameters ?? []).map((p) => p.name));
}

/**
 * Faithful mirror of `apps/web/lib/live/derive.ts` `liveKind()` for the ids that
 * matter here — kept local so the registry package stays free of an apps/web
 * dependency. Only the parts we author hints for need to be classified exactly.
 */
function liveKindOf(component: Component): string {
  switch (component.id) {
    case "cmp_led_generic":
    case "cmp_diode_generic":
      return "led";
    case "cmp_rgb_led":
      return "rgb";
    case "cmp_dc_motor":
      return "motor";
    case "cmp_buzzer":
      return "buzzer";
    case "cmp_lamp":
      return "lamp";
    case "cmp_pushbutton":
    case "cmp_switch_spst":
      return "switch";
    case "cmp_vsource_dc":
    case "cmp_vsource_pulse":
    case "cmp_vsource_sin":
      return "source";
    default:
      break;
  }
  return component.simModel?.template?.startsWith("R{ref}") ? "resistor" : "unknown";
}

/** Derived-series keys each kind emits (mirror of derive.ts's per-kind switch). */
function emittedSeries(component: Component): Set<string> {
  const kind = liveKindOf(component);
  switch (kind) {
    case "led":
      return new Set(["voltage", "current", "brightness"]);
    case "rgb":
      return new Set(["brightness_r", "brightness_g", "brightness_b"]);
    case "motor":
      return new Set(["voltage", "rpmFraction"]);
    case "buzzer":
    case "lamp":
      return new Set(["voltage", "intensity", "on"]);
    case "switch":
      return new Set(["closed"]);
    case "source":
      return new Set(["voltage"]);
    case "resistor": {
      // `voltage` always; `current` only when a resistance-named param exists
      // (derive.ts looks up resistance|r|rwinding|ronoff to compute current).
      const names = new Set((component.parameters ?? []).map((p) => p.name));
      const keys = new Set(["voltage"]);
      if (["resistance", "r", "rwinding", "ronoff"].some((n) => names.has(n))) keys.add("current");
      return keys;
    }
    default:
      return new Set();
  }
}

describe("tier-2 hero-part education content (issue #170)", () => {
  it("each tier-2 part carries a non-empty education block and still validates", () => {
    for (const id of TIER2_IDS) {
      const part = getComponent(id);
      expect(part, `${id} should be in the registry`).toBeDefined();
      const edu = part!.education;
      expect(edu, `${id} should carry an education block`).toBeDefined();
      expect(edu!.summary && edu!.summary.length > 0, `${id} needs a summary`).toBe(true);
      expect(
        Array.isArray(edu!.gotchas) && edu!.gotchas!.length > 0,
        `${id} needs at least one gotcha`,
      ).toBe(true);
      expect(validateComponent(part!).valid, `${id} must still pass validateComponent`).toBe(true);
    }
  });

  it("paramNotes keys only reference parameters that exist on the part", () => {
    for (const id of TIER2_IDS) {
      const notes = getComponent(id)!.education?.paramNotes ?? {};
      const declared = paramNames(id);
      for (const key of Object.keys(notes)) {
        expect(declared.has(key), `${id} paramNotes references unknown param "${key}"`).toBe(true);
      }
    }
  });

  it("each interactiveHint targetParam is a real param of its target component", () => {
    for (const id of TIER2_IDS) {
      const hint = getComponent(id)!.education?.interactiveHint;
      if (!hint) continue;
      const targetId = hint.targetComponentId ?? id;
      expect(getComponent(targetId), `${id} hint targets unknown component ${targetId}`).toBeDefined();
      expect(
        paramNames(targetId).has(hint.targetParam),
        `${id} interactiveHint targetParam "${hint.targetParam}" is not a param of ${targetId}`,
      ).toBe(true);
    }
  });

  it("each interactiveHint.observe is a series the SUBJECT's liveKind actually emits", () => {
    for (const id of TIER2_IDS) {
      const subject = getComponent(id)!;
      const hint = subject.education?.interactiveHint;
      if (!hint) continue;
      const emitted = emittedSeries(subject);
      expect(
        emitted.has(hint.observe),
        `${id} interactiveHint.observe "${hint.observe}" is not emitted by liveKind ${liveKindOf(subject)} (has: ${[...emitted].join(", ")})`,
      ).toBe(true);
    }
  });

  it("the diode's knob lives on a series resistor (it has no own numeric param)", () => {
    // The diode has no editable parameter, so — like the LED — its knob must
    // address a wired-in resistor rather than itself.
    const hint = getComponent("cmp_diode_generic")!.education?.interactiveHint;
    expect(hint).toBeDefined();
    expect(hint!.targetComponentId).toBe("cmp_resistor_generic");
  });
});
