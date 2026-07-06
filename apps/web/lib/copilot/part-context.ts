import type { Component } from "@openbench/ir-schema";

/**
 * Grounding for the copilot's "what is this / explain this part" answers
 * (issue #82). It assembles a plain-text context from the SELECTED component's
 * IR `education` block — the SAME single source of truth the Learn panel
 * (`components/editor/LearnPanel.tsx`) renders — so the static panel and the AI
 * can never contradict each other.
 *
 * Every education sub-field is optional. When the block is absent or empty the
 * context degrades to just the part's identity (name + category): no fabricated
 * summary, no empty "Gotchas:" heading. Pure and UI-free.
 */

export interface PartContext {
  componentId: string;
  name: string;
  category: string;
  /** True when the education block supplied at least one grounding field. */
  grounded: boolean;
  /** Assembled grounding text — fed to the model, or shown as-is in mock mode. */
  context: string;
}

export function assemblePartContext(component: Component): PartContext {
  const lines: string[] = [
    `Part: ${component.name} (${component.id})`,
    `Category: ${component.category}`,
  ];

  const education = component.education;
  let grounded = false;

  if (education) {
    if (education.summary) {
      lines.push(`Summary: ${education.summary}`);
      grounded = true;
    }

    if (education.gotchas && education.gotchas.length > 0) {
      lines.push("Gotchas:");
      for (const gotcha of education.gotchas) lines.push(`- ${gotcha}`);
      grounded = true;
    }

    if (education.keyFormula) {
      lines.push(`Key formula: ${education.keyFormula.display}`);
      for (const [symbol, description] of Object.entries(education.keyFormula.variables)) {
        lines.push(`  ${symbol} = ${description}`);
      }
      grounded = true;
    }

    const paramNotes = Object.entries(education.paramNotes ?? {});
    if (paramNotes.length > 0) {
      lines.push("Parameter notes:");
      for (const [name, note] of paramNotes) lines.push(`- ${name}: ${note}`);
      grounded = true;
    }
  }

  return {
    componentId: component.id,
    name: component.name,
    category: component.category,
    grounded,
    context: lines.join("\n"),
  };
}
