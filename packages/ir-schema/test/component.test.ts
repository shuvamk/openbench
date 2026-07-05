import { describe, expect, it } from "vitest";
import { validateComponent } from "../src/index";

/**
 * Acceptance tests for issue #1 — the `component` IR kind.
 * `minimalResistor` is the canonical cmp_resistor_generic example from
 * .context/interchange-format.md; if the doc and this fixture drift, the
 * spec-sync test (spec-sync.test.ts) catches it.
 */
const minimalResistor = {
  irVersion: "0.1.0",
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
  provenance: { source: "registry", addedBy: "registry-curator", at: "2026-07-02T00:00:00Z" },
};

const clone = () => structuredClone(minimalResistor) as Record<string, unknown>;

describe("validateComponent", () => {
  it("accepts the canonical minimal resistor", () => {
    const result = validateComponent(minimalResistor);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an unsupported irVersion", () => {
    const doc = clone();
    doc.irVersion = "9.9.9";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "irVersion")).toBe(true);
  });

  it("rejects a component without pins", () => {
    const doc = clone();
    delete doc.pins;
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("pins"))).toBe(true);
  });

  it("rejects duplicate pin ids", () => {
    const doc = clone();
    (doc.pins as Array<{ id: string }>)[1]!.id = "p1";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("duplicate pin id"))).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const doc = clone();
    doc.kind = "componentX";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "kind")).toBe(true);
  });

  it("rejects a simModel template referencing an undeclared parameter", () => {
    const doc = clone();
    (doc.simModel as { template: string }).template = "R{ref} {p1} {p2} {capacitance}";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("capacitance"))).toBe(true);
  });

  it("accepts an optional simModel.modelCard SPICE .model line (issue #5 additive field)", () => {
    const doc = clone();
    (doc.simModel as Record<string, unknown>).modelCard = ".model DLED D(IS=1e-14)";
    const result = validateComponent(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string simModel.modelCard", () => {
    const doc = clone();
    (doc.simModel as Record<string, unknown>).modelCard = 42;
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "simModel.modelCard")).toBe(true);
  });

  it("rejects a component id not matching cmp_*", () => {
    const doc = clone();
    doc.id = "resistor_generic";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("accepts an optional simModel.subckt .subckt/.ends block (issue #34 additive field)", () => {
    const doc = clone();
    const sim = doc.simModel as Record<string, unknown>;
    sim.template = "X{ref} {p1} {p2} TWOPIN";
    sim.subckt = ".subckt TWOPIN a b\nR1 a b 1k\n.ends TWOPIN";
    const result = validateComponent(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an empty simModel.subckt string", () => {
    const doc = clone();
    (doc.simModel as Record<string, unknown>).subckt = "";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "simModel.subckt")).toBe(true);
  });

  it("rejects a non-string simModel.subckt", () => {
    const doc = clone();
    (doc.simModel as Record<string, unknown>).subckt = 42;
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "simModel.subckt")).toBe(true);
  });
});

/**
 * Issue #21 — simModel.derivedParams (additive, patch-level): arithmetic
 * expressions over declared parameter names. Allowed: numbers (incl. 1e12
 * style), identifiers that are declared parameter names, + - * / and
 * parentheses. Anything else is structurally invalid.
 */
describe("simModel.derivedParams (issue #21 additive field)", () => {
  /** Canonical pushbutton example from the issue / interchange-format.md. */
  const pushbutton = () =>
    ({
      irVersion: "0.1.0",
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
      provenance: { source: "registry", addedBy: "registry-curator", at: "2026-07-02T00:00:00Z" },
    }) as Record<string, unknown>;

  const simModelOf = (doc: Record<string, unknown>) => doc.simModel as Record<string, unknown>;

  it("accepts the pushbutton example (template token referencing a derivedParams key)", () => {
    const result = validateComponent(pushbutton());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts division, parentheses, and decimal/scientific literals", () => {
    const doc = pushbutton();
    simModelOf(doc).derivedParams = {
      ronoff: "(pressed * 2.5e-3) / (pressed + 1) + 1e12 / 4",
    };
    const result = validateComponent(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an expression referencing an undeclared parameter", () => {
    const doc = pushbutton();
    simModelOf(doc).derivedParams = { ronoff: "0.001 + (1 - held) * 1e12" };
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.path === "simModel.derivedParams.ronoff");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("held");
  });

  it.each([
    ["semicolons", "1; process.exit(1)"],
    ["quotes", "require('fs')"],
    ["member access dots", "process.exit"],
    ["ternaries", "pressed ? 1 : 0"],
    ["comparison operators", "pressed > 1"],
    ["index brackets", "pressed[0]"],
    ["commas / argument lists", "pow(pressed, 2)"],
  ])("rejects structurally invalid expressions (%s)", (_label, expression) => {
    const doc = pushbutton();
    simModelOf(doc).derivedParams = { ronoff: expression };
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "simModel.derivedParams.ronoff")).toBe(true);
  });

  it("rejects a derivedParams key colliding with a declared parameter name", () => {
    const doc = pushbutton();
    simModelOf(doc).template = "R{ref} {p1} {p2} {pressed}";
    simModelOf(doc).derivedParams = { pressed: "1 - pressed" };
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.path === "simModel.derivedParams.pressed");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("pressed");
  });

  it("rejects a non-string derivedParams expression", () => {
    const doc = pushbutton();
    simModelOf(doc).derivedParams = { ronoff: 42 };
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "simModel.derivedParams.ronoff")).toBe(true);
  });

  it("still rejects template tokens that are neither pins, parameters, ref, nor derivedParams keys", () => {
    const doc = pushbutton();
    simModelOf(doc).template = "R{ref} {p1} {p2} {bogus}";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("bogus"))).toBe(true);
  });
});

/**
 * Issue #78 — optional `education` block (additive, patch-level 0.1.1). Read-only
 * human teaching metadata per the spike #77 finding
 * (.context/findings/spike-77-education-ir.md §1). Every sub-field is optional so
 * partial authoring is valid; existing components (which omit it) stay valid.
 * `keyFormula.display` is display-only text — never parsed/evaluated (contrast
 * simModel.derivedParams).
 */
describe("education block (issue #78 additive field)", () => {
  /** Fully-populated block, mirroring the resistor content in the spike finding §3. */
  const wellFormedEducation = {
    summary: "Limits how much current flows — the workhorse for protecting parts.",
    gotchas: [
      "Bigger resistance means less current, not more — it's the brake, not the gas.",
      "Resistors have no polarity — either way round is fine.",
    ],
    keyFormula: {
      display: "V = I × R   (Ohm's law)",
      variables: {
        V: "voltage dropped across the resistor",
        I: "current through it",
        R: "its resistance in ohms",
      },
    },
    paramNotes: {
      resistance: "Ohms. In a resistor+LED loop this sets the LED current directly.",
    },
    interactiveHint: {
      targetParam: "resistance",
      observe: "current",
      prompt: "Sweep the resistance and watch the current respond — Ohm's law you can feel.",
    },
  };

  const withEducation = (education: unknown) => {
    const doc = clone();
    doc.education = education;
    return doc;
  };

  it("accepts a component WITH a well-formed education block", () => {
    const result = validateComponent(withEducation(wellFormedEducation));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a component WITHOUT an education block (backward compatible)", () => {
    const doc = clone();
    expect(doc.education).toBeUndefined();
    const result = validateComponent(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a partial education block (every sub-field is optional)", () => {
    const result = validateComponent(withEducation({ summary: "A one-way current valve." }));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts an interactiveHint that addresses a series part via targetComponentId (the LED case)", () => {
    const result = validateComponent(
      withEducation({
        interactiveHint: {
          targetParam: "resistance",
          targetComponentId: "cmp_resistor_generic",
          observe: "brightness",
          prompt: "Drag the series resistor down and watch the LED brighten.",
        },
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("treats keyFormula.display as opaque display text (never parsed/evaluated)", () => {
    const result = validateComponent(
      withEducation({
        keyFormula: { display: "τ = R × C; require('fs'); anything goes here", variables: {} },
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string summary with a structured {path,message}", () => {
    const result = validateComponent(withEducation({ summary: 42 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "education.summary")).toBe(true);
  });

  it("rejects gotchas that is not an array of strings", () => {
    const result = validateComponent(withEducation({ gotchas: "polarity matters" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("education.gotchas"))).toBe(true);
  });

  it("rejects a keyFormula missing its display string", () => {
    const result = validateComponent(withEducation({ keyFormula: { variables: {} } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "education.keyFormula.display")).toBe(true);
  });

  it("rejects keyFormula.variables values that are not strings", () => {
    const result = validateComponent(
      withEducation({ keyFormula: { display: "V = I × R", variables: { V: 5 } } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("education.keyFormula.variables"))).toBe(true);
  });

  it("rejects paramNotes whose values are not strings", () => {
    const result = validateComponent(withEducation({ paramNotes: { resistance: 12 } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("education.paramNotes"))).toBe(true);
  });

  it("rejects an interactiveHint missing its required targetParam", () => {
    const result = validateComponent(
      withEducation({ interactiveHint: { observe: "current", prompt: "try it" } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "education.interactiveHint.targetParam")).toBe(true);
  });

  it("rejects an interactiveHint missing its required observe series", () => {
    const result = validateComponent(
      withEducation({ interactiveHint: { targetParam: "resistance", prompt: "try it" } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "education.interactiveHint.observe")).toBe(true);
  });

  it("never throws on a wholly malformed education block, returns structured errors", () => {
    let result: ReturnType<typeof validateComponent>;
    expect(() => {
      result = validateComponent(withEducation(42));
    }).not.toThrow();
    expect(result!.valid).toBe(false);
    expect(result!.errors.some((e) => e.path === "education")).toBe(true);
  });
});

/** Issue #21 — templates MAY span multiple lines (one SPICE card per line). */
describe("multi-line simModel templates (issue #21)", () => {
  it("accepts a 3-card RGB-LED-style template with {ref}-suffixed device names", () => {
    const doc = clone();
    doc.id = "cmp_led_rgb";
    doc.name = "RGB LED";
    doc.category = "active";
    doc.pins = [
      { id: "r", name: "R", electricalType: "passive" },
      { id: "g", name: "G", electricalType: "passive" },
      { id: "b", name: "B", electricalType: "passive" },
      { id: "k", name: "K", electricalType: "passive" },
    ];
    doc.parameters = [];
    doc.simModel = {
      engine: "ngspice",
      template: "D{ref}R {r} {k} DLED\nD{ref}G {g} {k} DLED\nD{ref}B {b} {k} DLED",
      modelCard: ".model DLED D(IS=1e-14)",
    };
    const result = validateComponent(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("validates tokens on every line of a multi-line template", () => {
    const doc = clone();
    (doc.simModel as { template: string }).template = "R{ref} {p1} {p2} {resistance}\nX{ref} {p1} {nosuchpin} SUB";
    const result = validateComponent(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nosuchpin"))).toBe(true);
  });
});
