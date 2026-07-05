import type { Schematic } from "@openbench/ir-schema";
import {
  deriveStepsFromRecording,
  evaluateStep,
  loosenConstraints,
  mergeSteps,
  splitStep,
  type DeriveOptions,
  type ErcRunner,
  type RecordingBatch,
  type ResolveComponent,
  type Step,
  type StepResult,
} from "@openbench/lesson";

/**
 * Teaching-author mode (issue 151), per .context/design/teaching-mode.md §5
 * (ADR-0022). The editor's undo-history (#18) is a stack of cumulative
 * schematic snapshots: `past` holds the pre-mutation snapshots oldest-first and
 * `bundle.schematic` is the latest. This view-model groups that history into the
 * `RecordingBatch[]` {@link deriveStepsFromRecording} consumes, then exposes the
 * satisfiability-preserving step-list edits (edit instruction/hint, split,
 * merge, loosen) and a per-step preview against the live schematic.
 *
 * Everything here is pure and registry-agnostic (resolver injected), so it is
 * unit-testable without React — the panel only wires it to the stores.
 */

/** The oldest snapshot is the derivation baseline; each later one is a batch. */
export function recordingBatchesFromHistory(
  past: readonly Schematic[],
  current: Schematic,
): { startSchematic: Schematic; batches: RecordingBatch[] } {
  const snapshots = [...past, current];
  // snapshots always has ≥1 entry (current), so start is defined.
  const [start, ...rest] = snapshots as [Schematic, ...Schematic[]];
  return {
    startSchematic: start,
    batches: rest.map((schematic) => ({ schematic })),
  };
}

/**
 * Group the undo-history into batches and derive one candidate {@link Step} per
 * batch that added structure. `startSchematic` is taken from the history's
 * baseline, so callers only override the remaining {@link DeriveOptions}.
 */
export function deriveStepsFromHistory(
  past: readonly Schematic[],
  current: Schematic,
  options: Omit<DeriveOptions, "startSchematic"> = {},
): Step[] {
  const { startSchematic, batches } = recordingBatchesFromHistory(past, current);
  return deriveStepsFromRecording(batches, { ...options, startSchematic });
}

/** Author edit: patch a step's instruction and/or hint, leaving others intact. */
export function editStepInList(
  steps: readonly Step[],
  id: string,
  patch: { instruction?: string; hint?: string },
): Step[] {
  return steps.map((step) => {
    if (step.id !== id) return step;
    const next: Step = { ...step };
    if (patch.instruction !== undefined) next.instruction = patch.instruction;
    if (patch.hint !== undefined) next.hint = patch.hint;
    return next;
  });
}

/**
 * Replace the target step with its per-clause split parts, in place. Each part
 * stays satisfiable against any schematic the original passed on (see
 * {@link splitStep}); untouched steps keep their position.
 */
export function splitStepInList(steps: readonly Step[], id: string): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    if (step.id === id) out.push(...splitStep(step));
    else out.push(step);
  }
  return out;
}

/**
 * Merge the named steps (2+) into one whose predicate is the union of their
 * clauses, positioned where the first-named step was; the rest are removed. If
 * every input passed against a schematic, so does the merge ({@link mergeSteps}).
 * Fewer than two matches is a no-op.
 */
export function mergeStepsInList(steps: readonly Step[], ids: readonly string[]): Step[] {
  const idSet = new Set(ids);
  const chosen = steps.filter((s) => idSet.has(s.id));
  if (chosen.length < 2) return [...steps];
  const merged = mergeSteps(...chosen);
  const out: Step[] = [];
  let inserted = false;
  for (const step of steps) {
    if (!idSet.has(step.id)) {
      out.push(step);
      continue;
    }
    if (!inserted) {
      out.push(merged);
      inserted = true;
    }
    // subsequent members of the merge set are dropped
  }
  return out;
}

/**
 * Loosen the target step's exact numeric equality constraints into symmetric
 * ±`tolerancePct`% bands ({@link loosenConstraints}); the exact value still
 * passes, nearby values now pass too. Untouched steps are unchanged.
 */
export function loosenStepInList(
  steps: readonly Step[],
  id: string,
  tolerancePct: number,
): Step[] {
  return steps.map((step) => (step.id === id ? loosenConstraints(step, tolerancePct) : step));
}

/** One candidate step and its live pass/fail verdict. */
export interface AuthoredStepPreview {
  step: Step;
  result: StepResult;
}

/**
 * Preview each candidate step independently against the live schematic via
 * {@link evaluateStep}. Unlike the student runner this does not lock later
 * steps — the author sees the true pass/fail of every step as they iterate.
 */
export function previewSteps(
  steps: readonly Step[],
  schematic: Schematic,
  resolveComponent: ResolveComponent,
  erc?: ErcRunner,
): AuthoredStepPreview[] {
  return steps.map((step) => ({
    step,
    result: evaluateStep(step, schematic, resolveComponent, erc),
  }));
}
