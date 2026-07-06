import type { Component, Schematic, SimulationRun } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { checkSchematic } from "@openbench/erc";

/**
 * The copilot's read-only "explain this circuit / why won't this work?" action
 * (issue #43). It consumes `@openbench/erc` and the latest `simulationRun`, and
 * returns a deterministic summary that cites the machine ERC rule id — this is
 * an agent-facing explanation, distinct from the beginner-facing ERC panel
 * (which deliberately hides `ERC_*` codes). Pure and UI-free.
 */

export interface Explanation {
  /** One-paragraph, deterministic natural-language summary. */
  summary: string;
  /** Machine rule ids cited (e.g. `ERC_NO_GROUND`), in violation order. */
  ercRules: string[];
  /** Status of the latest simulation run, if any was supplied. */
  simStatus?: SimulationRun["status"];
}

export function explainCircuit(
  schematic: Schematic,
  simulationRuns: readonly SimulationRun[] = [],
  resolveComponent: (id: string) => Component | undefined = getComponent,
): Explanation {
  const { violations } = checkSchematic(schematic, resolveComponent);
  const ercRules = violations.map((v) => v.rule);
  const latest = simulationRuns[simulationRuns.length - 1];
  const simStatus = latest?.status;

  const parts: string[] = [];

  if (violations.length === 0) {
    parts.push("No electrical-rule-check issues were found.");
  } else {
    const count = violations.length === 1 ? "1 electrical issue" : `${violations.length} electrical issues`;
    parts.push(`This circuit has ${count}:`);
    for (const violation of violations) {
      parts.push(`- ${violation.rule}: ${violation.message}`);
    }
  }

  if (latest) {
    parts.push(
      `The latest simulation (${latest.id}) ${describeStatus(latest.status)}.`,
    );
  }

  return { summary: parts.join("\n"), ercRules, simStatus };
}

function describeStatus(status: SimulationRun["status"]): string {
  switch (status) {
    case "completed":
      return "completed successfully";
    case "failed":
      return "failed";
    case "running":
      return "is still running";
    case "queued":
      return "is queued";
    default:
      return String(status);
  }
}
