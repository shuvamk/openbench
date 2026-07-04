import { describe, expect, it } from "vitest";
import { registryComponents, getComponent } from "@openbench/registry";
import {
  categoryLabel,
  CATEGORY_LABELS,
  filterComponents,
  matchesComponent,
} from "../lib/editor/palette-filter";

const resistor = getComponent("cmp_resistor_generic")!;
const sine = getComponent("cmp_vsource_sin")!;
const nmos = getComponent("cmp_nmos_2n7000")!;

describe("categoryLabel", () => {
  it("maps known categories to human labels", () => {
    expect(categoryLabel("passive")).toBe(CATEGORY_LABELS.passive);
    expect(categoryLabel("mcu")).toBe("Microcontrollers");
  });

  it("falls back to the raw category for unknown values", () => {
    expect(categoryLabel("mystery")).toBe("mystery");
  });
});

describe("matchesComponent", () => {
  it("matches everything on an empty or whitespace query", () => {
    expect(matchesComponent(resistor, "")).toBe(true);
    expect(matchesComponent(resistor, "   ")).toBe(true);
  });

  it("matches a case-insensitive substring of the name", () => {
    expect(matchesComponent(sine, "sine")).toBe(true);
    expect(matchesComponent(sine, "VOLTAGE")).toBe(true);
    expect(matchesComponent(sine, "capacitor")).toBe(false);
  });

  it("matches on the human category label", () => {
    // resistor is a passive; its category label is "Passives"
    expect(matchesComponent(resistor, "passive")).toBe(true);
  });

  it("matches on the part number embedded in the id", () => {
    // cmp_nmos_2n7000 -> searchable "nmos 2n7000"
    expect(matchesComponent(nmos, "2n7000")).toBe(true);
    expect(matchesComponent(nmos, "nmos")).toBe(true);
  });

  it("requires every whitespace-separated token to match (AND semantics)", () => {
    expect(matchesComponent(sine, "sine source")).toBe(true);
    expect(matchesComponent(sine, "sine motor")).toBe(false);
  });
});

describe("filterComponents", () => {
  it("returns the full list unchanged for an empty query", () => {
    expect(filterComponents(registryComponents, "")).toEqual(registryComponents);
  });

  it("narrows to matching components, preserving input order", () => {
    const result = filterComponents(registryComponents, "diode");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => matchesComponent(c, "diode"))).toBe(true);
    // order preserved relative to the source list
    const sourceOrder = registryComponents.filter((c) => matchesComponent(c, "diode"));
    expect(result).toEqual(sourceOrder);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterComponents(registryComponents, "zzzznotathing")).toEqual([]);
  });
});
