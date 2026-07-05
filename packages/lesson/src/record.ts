import type { Net, Schematic, SchematicInstance } from "@openbench/ir-schema";
import type {
  ComponentClause,
  ConnectedClause,
  ParamConstraint,
  PinRef,
  SchematicPredicate,
  Step,
} from "./types";

/**
 * Author-by-recording (issue #90) — turn an editor mutation recording into a
 * `Step[]`, per .context/design/teaching-mode.md §5 (ADR-0022).
 *
 * The recording is the editor's undo-history (#18) sliced into coherent
 * batches, each captured as the *cumulative* schematic snapshot after that
 * batch. `deriveStepsFromRecording` diffs consecutive snapshots and turns each
 * batch's structural diff into one candidate step:
 *   - instances added → `component` clauses (role = the instanceId, `where`
 *     seeded from the placed parameter overrides);
 *   - nets formed or extended → `connected` clauses over the net's pins.
 * Roles are the students'-instance ids, so a `connected` clause that references
 * a part introduced in an earlier step binds it as a free existential variable
 * (see the evaluator) — no cross-step declaration needed.
 *
 * The derivation is purely structural: it produces exactly the predicate the
 * built schematic satisfies, so every derived step passes against the final
 * snapshot by construction. The author then edits instructions, loosens
 * constraints ({@link loosenConstraints}), and splits/merges steps
 * ({@link splitStep}/{@link mergeSteps}) — all satisfiability-preserving.
 */

/** One coherent group of recorded mutations, as its cumulative schematic. */
export interface RecordingBatch {
  /** Schematic state AFTER this batch of mutations. */
  schematic: Schematic;
  /** Optional author-facing label (folded into the default instruction). */
  label?: string;
}

export interface DeriveOptions {
  /**
   * Parts the student already starts with (the lesson's `startBundle`). Their
   * instances/nets are the baseline for the first diff and never become steps.
   * Defaults to an empty schematic.
   */
  startSchematic?: Schematic;
  /**
   * `"overrides"` (default) seeds each new instance's `where` from its
   * parameter overrides as exact `eq` constraints; `"none"` seeds no `where`.
   */
  seedWhere?: "overrides" | "none";
}

const EMPTY_INSTANCES: SchematicInstance[] = [];
const EMPTY_NETS: Net[] = [];

const instanceIds = (schematic: Schematic | undefined): Set<string> =>
  new Set((schematic?.instances ?? EMPTY_INSTANCES).map((i) => i.instanceId));

const connectionKeys = (net: Net): string =>
  (net.connections ?? [])
    .map((c) => `${c.instanceId} ${c.pinId}`)
    .sort()
    .join("|");

/** Nets in `after` that are new, or whose connection set grew vs `before`. */
function changedNets(before: Schematic | undefined, after: Schematic): Net[] {
  const prev = new Map((before?.nets ?? EMPTY_NETS).map((n) => [n.netId, connectionKeys(n)]));
  return (after.nets ?? EMPTY_NETS).filter((net) => {
    if ((net.connections ?? []).length < 2) return false; // need ≥2 pins to assert connectivity
    const priorKeys = prev.get(net.netId);
    return priorKeys === undefined || priorKeys !== connectionKeys(net);
  });
}

/** Seed a `where` from an instance's numeric/string parameter overrides. */
function seedWhereFor(
  instance: SchematicInstance,
  mode: "overrides" | "none",
): ParamConstraint[] | undefined {
  if (mode === "none") return undefined;
  const overrides = instance.parameterOverrides;
  if (overrides === undefined) return undefined;
  const constraints: ParamConstraint[] = [];
  for (const [param, value] of Object.entries(overrides)) {
    if (typeof value === "number" || typeof value === "string") {
      constraints.push({ param, eq: value });
    }
  }
  return constraints.length > 0 ? constraints : undefined;
}

const componentClauseFor = (
  instance: SchematicInstance,
  seed: "overrides" | "none",
): ComponentClause => {
  const where = seedWhereFor(instance, seed);
  return {
    component: {
      of: instance.componentId,
      as: instance.instanceId,
      ...(where ? { where } : {}),
    },
  };
};

const connectedClauseFor = (net: Net): ConnectedClause => ({
  connected: {
    pins: (net.connections ?? []).map(
      (c): PinRef => ({ role: c.instanceId, pin: c.pinId }),
    ),
  },
});

function defaultInstruction(
  index: number,
  label: string | undefined,
  added: SchematicInstance[],
  wired: Net[],
): string {
  if (label) return label;
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`add ${added.map((i) => i.componentId.replace(/^cmp_/, "")).join(", ")}`);
  }
  if (wired.length > 0) {
    parts.push(`wire ${wired.length} connection${wired.length === 1 ? "" : "s"}`);
  }
  const body = parts.length > 0 ? parts.join("; ") : "continue the build";
  return `Step ${index}: ${body}.`;
}

/**
 * Derive candidate {@link Step}s from a recording. Each batch that adds an
 * instance or forms/extends a net becomes one step; batches with no structural
 * diff (pure move/rotate) are skipped. Never throws.
 */
export function deriveStepsFromRecording(
  batches: RecordingBatch[],
  options: DeriveOptions = {},
): Step[] {
  const seed = options.seedWhere ?? "overrides";
  const steps: Step[] = [];
  let previous = options.startSchematic;

  for (const batch of batches) {
    const after = batch.schematic;
    const priorIds = instanceIds(previous);
    const added = (after.instances ?? EMPTY_INSTANCES).filter((i) => !priorIds.has(i.instanceId));
    const wired = changedNets(previous, after);

    if (added.length === 0 && wired.length === 0) {
      previous = after;
      continue; // no structural diff → not a step
    }

    const clauses: SchematicPredicate[] = [
      ...added.map((instance) => componentClauseFor(instance, seed)),
      ...wired.map((net) => connectedClauseFor(net)),
    ];

    steps.push({
      id: `step-${steps.length + 1}`,
      instruction: defaultInstruction(steps.length + 1, batch.label, added, wired),
      expect: clauses.length === 1 ? clauses[0]! : { all: clauses },
    });
    previous = after;
  }

  return steps;
}

/** The top-level clauses of a step's predicate (an `all` tree, or a lone clause). */
const topLevelClauses = (expect: SchematicPredicate): SchematicPredicate[] =>
  "all" in expect ? expect.all : [expect];

/**
 * Split a step into one step per top-level clause. Each part stays satisfiable
 * against any schematic the original passed on: a `connected` clause whose role
 * was bound by a sibling `component` clause becomes a free existential role,
 * which the evaluator binds to the same instance.
 */
export function splitStep(step: Step): Step[] {
  const clauses = topLevelClauses(step.expect);
  return clauses.map((clause, i) => ({
    ...step,
    id: `${step.id}-${i + 1}`,
    expect: clause,
  }));
}

/**
 * Merge steps into one whose predicate is the union (`all`) of their clauses.
 * If every input passed against a schematic, so does the merge (a joint binding
 * exists — the concatenation of the parts' bindings).
 */
export function mergeSteps(...steps: Step[]): Step {
  const clauses = steps.flatMap((s) => topLevelClauses(s.expect));
  const instructions = steps.map((s) => s.instruction).filter(Boolean);
  return {
    id: steps.map((s) => s.id).join("+"),
    instruction: instructions.join(" "),
    expect: clauses.length === 1 ? clauses[0]! : { all: clauses },
    ...(steps.some((s) => s.hint) ? { hint: steps.map((s) => s.hint).filter(Boolean).join(" ") } : {}),
  };
}

/** Rewrite one clause tree, replacing exact numeric `eq` constraints with approx bands. */
function loosenPredicate(pred: SchematicPredicate, tolerancePct: number): SchematicPredicate {
  if ("all" in pred) return { all: pred.all.map((p) => loosenPredicate(p, tolerancePct)) };
  if ("any" in pred) return { any: pred.any.map((p) => loosenPredicate(p, tolerancePct)) };
  if ("not" in pred) return { not: loosenPredicate(pred.not, tolerancePct) };
  if ("connected" in pred) return pred;
  const where = pred.component.where;
  if (where === undefined) return pred;
  const loosened = where.map((c): ParamConstraint => {
    if (typeof c.eq === "number") {
      const { eq: _eq, ...rest } = c;
      return { ...rest, approx: { value: c.eq as number, tolerancePct } };
    }
    return c;
  });
  return { component: { ...pred.component, where: loosened } };
}

/**
 * Loosen a step's exact numeric equality constraints (e.g. an exact `330`) into
 * symmetric ±`tolerancePct`% `approx` bands. The exact value stays inside its
 * own band, so a step that passed still passes; nearby values now pass too.
 */
export function loosenConstraints(step: Step, tolerancePct: number): Step {
  return { ...step, expect: loosenPredicate(step.expect, tolerancePct) };
}
