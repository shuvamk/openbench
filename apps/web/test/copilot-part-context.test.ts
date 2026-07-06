import { describe, expect, it } from "vitest";
import { IR_VERSION, type Component } from "@openbench/ir-schema";
import { assemblePartContext } from "../lib/copilot/part-context";
import { createCopilot } from "../lib/copilot/engine";

/**
 * Issue #82 acceptance — the copilot grounds "what is this / explain this part"
 * answers in the SELECTED component's IR `education` block, so the static Learn
 * panel and the AI can never contradict each other (single source of truth).
 * A component without the block degrades gracefully.
 */

const AT = "2026-07-06T00:00:00Z";

function baseComponent(overrides: Partial<Component> = {}): Component {
  return {
    irVersion: IR_VERSION,
    kind: "component",
    id: "cmp_resistor_generic",
    name: "Resistor",
    category: "passive",
    pins: [
      { id: "p1", name: "1", electricalType: "passive" },
      { id: "p2", name: "2", electricalType: "passive" },
    ],
    parameters: [],
    provenance: { source: "test", at: AT },
    ...overrides,
  };
}

function educatedResistor(): Component {
  return baseComponent({
    education: {
      summary: "A resistor limits current in a circuit.",
      gotchas: [
        "Resistors have no polarity.",
        "Exceeding the power rating burns it out.",
      ],
      keyFormula: {
        display: "V = I × R",
        variables: { V: "voltage across the resistor", I: "current", R: "resistance" },
      },
      paramNotes: { resistance: "Larger values pass less current." },
    },
  });
}

describe("copilot part-context assembly (education grounding)", () => {
  it("includes every field of the education block in the assembled context", () => {
    const ctx = assemblePartContext(educatedResistor());

    expect(ctx.grounded).toBe(true);
    expect(ctx.context).toContain("A resistor limits current in a circuit.");
    expect(ctx.context).toContain("Resistors have no polarity.");
    expect(ctx.context).toContain("Exceeding the power rating burns it out.");
    expect(ctx.context).toContain("V = I × R");
    expect(ctx.context).toContain("voltage across the resistor");
    expect(ctx.context).toContain("Larger values pass less current.");
  });

  it("names the part even when grounded so the answer is self-contained", () => {
    const ctx = assemblePartContext(educatedResistor());
    expect(ctx.context).toContain("Resistor");
    expect(ctx.componentId).toBe("cmp_resistor_generic");
  });

  it("degrades gracefully for a component with no education block", () => {
    const ctx = assemblePartContext(baseComponent({ id: "cmp_plain", name: "Plain Part" }));

    expect(ctx.grounded).toBe(false);
    // No fabricated / empty education fields injected.
    expect(ctx.context).not.toMatch(/Summary:/);
    expect(ctx.context).not.toMatch(/Gotchas:/);
    expect(ctx.context).not.toMatch(/Key formula:/);
    // Still self-contained: the part is still identified.
    expect(ctx.context).toContain("Plain Part");
  });

  it("treats an empty education block as ungrounded (no empty-field injection)", () => {
    const ctx = assemblePartContext(baseComponent({ education: {} }));
    expect(ctx.grounded).toBe(false);
    expect(ctx.context).not.toMatch(/Summary:/);
  });

  it("copilot.explainPart returns a grounded answer that cites the summary", () => {
    const copilot = createCopilot();
    const result = copilot.explainPart(educatedResistor());
    expect(result.grounded).toBe(true);
    expect(result.context).toContain("A resistor limits current in a circuit.");
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it("copilot.explainPart still answers (from general knowledge) with no block", () => {
    const copilot = createCopilot();
    const result = copilot.explainPart(baseComponent({ id: "cmp_plain", name: "Plain Part" }));
    expect(result.grounded).toBe(false);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.answer).toContain("Plain Part");
  });
});
