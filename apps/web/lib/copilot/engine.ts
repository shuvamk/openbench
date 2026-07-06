import type { Component, Schematic, SimulationRun } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { applyToolCall, schematicDiff, type CopilotToolCall } from "./tools";
import { explainCircuit, type Explanation } from "./explain";
import { assemblePartContext, type PartContext } from "./part-context";

/**
 * The copilot engine (issue #43): a key-optional seam over model access,
 * mirroring ADR-0003. With no API key it runs a deterministic scripted
 * planner ("mock" mode) so the keyless deploy and the test suite work with
 * ZERO network access; a key would swap in a real model client behind the same
 * `Copilot` interface. Either way, a proposal is a real IR mutation the user
 * reviews and accepts — never an opaque apply.
 */

export type CopilotMode = "mock" | "live";

export interface CopilotConfig {
  /** Model API key. Absent/empty → mock mode. */
  apiKey?: string;
}

/** A reviewable proposed change: the tool-call, its diff, and before/after IR. */
export interface CopilotProposal {
  id: string;
  toolCall: CopilotToolCall;
  /** Short, human-readable description of the intended change. */
  summary: string;
  /** Instance ids the change adds / removes (for the diff view). */
  added: string[];
  removed: string[];
  before: Schematic;
  after: Schematic;
}

/** A read-only "what is this / explain this part" answer, grounded in the IR. */
export interface PartExplanation extends PartContext {
  /** Natural-language answer (deterministic in mock mode). */
  answer: string;
}

export interface Copilot {
  readonly mode: CopilotMode;
  /**
   * Turn a natural-language prompt into a reviewable proposal, WITHOUT touching
   * the live document. Returns null when the prompt maps to no known action.
   */
  propose(schematic: Schematic, prompt: string): CopilotProposal | null;
  /** Read-only "explain this circuit" over ERC + the latest sim run. */
  explain(schematic: Schematic, simulationRuns?: readonly SimulationRun[]): Explanation;
  /**
   * Read-only "explain this part" grounded in the component's IR `education`
   * block (issue #82). Degrades to general knowledge when the block is absent.
   */
  explainPart(component: Component): PartExplanation;
}

/** Mock mode unless a non-empty API key is configured. */
export function resolveCopilotMode(config: CopilotConfig = {}): CopilotMode {
  return config.apiKey && config.apiKey.length > 0 ? "live" : "mock";
}

/**
 * Scripted keyword → part map for mock mode. Longest, most-specific keywords
 * are matched first so "led" doesn't shadow nothing important, etc.
 */
const PART_KEYWORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bpull-?ups?\b|\bresistors?\b|\bresistance\b/i, "cmp_resistor_generic"],
  [/\bcapacitors?\b|\bcaps?\b/i, "cmp_capacitor_generic"],
  [/\binductors?\b/i, "cmp_inductor_generic"],
  [/\bgrounds?\b|\bgnd\b/i, "cmp_ground"],
  [/\bleds?\b/i, "cmp_led_generic"],
  [/\bdiodes?\b/i, "cmp_diode_generic"],
  [/\bvoltage sources?\b|\bbatter(?:y|ies)\b|\bvsource\b/i, "cmp_vsource_dc"],
];

function planToolCall(prompt: string): CopilotToolCall | null {
  for (const [pattern, componentId] of PART_KEYWORDS) {
    if (pattern.test(prompt)) {
      return { name: "add_instance", args: { componentId } };
    }
  }
  return null;
}

function buildProposal(
  schematic: Schematic,
  toolCall: CopilotToolCall,
  resolveComponent: (id: string) => Component | undefined,
): CopilotProposal | null {
  let result;
  try {
    result = applyToolCall(schematic, toolCall, resolveComponent);
  } catch {
    return null;
  }
  const diff = schematicDiff(schematic, result.schematic);
  const component = resolveComponent(toolCall.args.componentId);
  const label = component?.name ?? toolCall.args.componentId;
  return {
    // Deterministic id (no Date/random) so tests and snapshots are stable.
    id: `prop_${toolCall.name}_${schematic.instances.length}`,
    toolCall,
    summary: `Add ${label}${result.instanceId ? ` (${result.instanceId})` : ""}`,
    added: diff.added,
    removed: diff.removed,
    before: schematic,
    after: result.schematic,
  };
}

/**
 * Construct a copilot. `resolveComponent` is injected for testability and
 * defaults to the registry singleton.
 */
export function createCopilot(
  config: CopilotConfig = {},
  resolveComponent: (id: string) => Component | undefined = getComponent,
): Copilot {
  const mode = resolveCopilotMode(config);
  // Live mode is a seam: until a model client lands, both modes use the
  // scripted planner. Mock mode is guaranteed network-free.
  return {
    mode,
    propose(schematic, prompt) {
      const toolCall = planToolCall(prompt);
      if (!toolCall) return null;
      return buildProposal(schematic, toolCall, resolveComponent);
    },
    explain(schematic, simulationRuns) {
      return explainCircuit(schematic, simulationRuns, resolveComponent);
    },
    explainPart(component) {
      const context = assemblePartContext(component);
      return { ...context, answer: buildPartAnswer(context) };
    },
  };
}

/**
 * Deterministic mock-mode answer for "explain this part". Grounded answers lead
 * with the authored summary; ungrounded ones fall back to a general-knowledge
 * one-liner so the copilot never fabricates an education field it wasn't given.
 */
function buildPartAnswer(context: PartContext): string {
  const summaryLine = context.context
    .split("\n")
    .find((line) => line.startsWith("Summary: "));
  if (context.grounded && summaryLine) {
    return summaryLine.slice("Summary: ".length);
  }
  return `${context.name} is a ${context.category} component.`;
}
