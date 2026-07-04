import type { Component } from "@openbench/ir-schema";

/** Human labels for the registry's component categories (shared by the palette). */
export const CATEGORY_LABELS: Record<string, string> = {
  passive: "Passives",
  active: "Active",
  connector: "Connectors",
  mcu: "Microcontrollers",
  power: "Power",
  sensor: "Sensors",
  other: "Electromechanical",
};

/** Resolve a category to its human label, falling back to the raw value. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** The text a query is matched against: name, category (raw + label) and the
 * part number hidden in the id (`cmp_nmos_2n7000` → "nmos 2n7000"). */
function searchableText(component: Component): string {
  const idWords = component.id.replace(/^cmp_/, "").replace(/_/g, " ");
  return [
    component.name,
    component.category,
    categoryLabel(component.category),
    idWords,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Tokenised, case-insensitive match. An empty/whitespace query matches
 * everything; otherwise every whitespace-separated token must appear somewhere
 * in the component's searchable text (AND semantics), so "sine source" narrows
 * but "sine motor" excludes.
 */
export function matchesComponent(component: Component, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = searchableText(component);
  return tokens.every((token) => haystack.includes(token));
}

/** Filter a component list by query, preserving the input order. */
export function filterComponents(
  components: Component[],
  query: string,
): Component[] {
  return components.filter((component) => matchesComponent(component, query));
}
