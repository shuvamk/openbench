import type { Schematic } from "@openbench/ir-schema";
import {
  evaluateStep,
  type ErcRunner,
  type Lesson,
  type ResolveComponent,
  type Step,
  type StepResult,
} from "@openbench/lesson";

/**
 * Student runner view-model (issue #91), per .context/design/teaching-mode.md
 * §3.3 (per-clause progress) and §3.4 (ERC warnings feed hints, never pass/fail).
 *
 * Pure and stateless: it evaluates every step's {@link import("@openbench/lesson").SchematicPredicate}
 * against the *live* schematic and derives a linear stepper. The **first
 * unsatisfied step is `active`**; earlier steps are `passed`, later ones
 * `locked`. Subset matching is monotone — adding correct structure never turns
 * a passed step red — so we can recompute from scratch on every IR mutation
 * without tracking a separate "furthest reached" cursor. The runner component
 * debounces the schematic feeding this function.
 */
export type RunnerStepStatus = "passed" | "active" | "locked";

export interface RunnerStep {
  step: Step;
  result: StepResult;
  status: RunnerStepStatus;
}

export interface RunnerView {
  steps: RunnerStep[];
  /** Index of the first unsatisfied step; `steps.length` when the lesson is done. */
  activeIndex: number;
  complete: boolean;
  /** The step the student is currently working; `undefined` once complete. */
  active?: RunnerStep;
  /**
   * De-duplicated ERC advisories across every evaluated step, in first-seen
   * order. Advisory only — they never gate advancement (§3.4).
   */
  warnings: string[];
}

/**
 * Evaluate a lesson against the live schematic and build the stepper view.
 * `resolveComponent` is injected so this stays registry-agnostic and unit
 * testable; `erc` is optional and only ever produces advisory warnings.
 */
export function deriveRunnerView(
  lesson: Lesson,
  schematic: Schematic,
  resolveComponent: ResolveComponent,
  erc?: ErcRunner,
): RunnerView {
  const evaluated = lesson.steps.map((step) => ({
    step,
    result: evaluateStep(step, schematic, resolveComponent, erc),
  }));

  // The active step is the first that does not pass; if all pass, we're done.
  let activeIndex = evaluated.findIndex((e) => !e.result.passed);
  if (activeIndex === -1) activeIndex = lesson.steps.length;

  const steps: RunnerStep[] = evaluated.map((e, i) => ({
    step: e.step,
    result: e.result,
    status: i < activeIndex ? "passed" : i === activeIndex ? "active" : "locked",
  }));

  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const { result } of evaluated) {
    for (const warning of result.warnings) {
      if (!seen.has(warning)) {
        seen.add(warning);
        warnings.push(warning);
      }
    }
  }

  return {
    steps,
    activeIndex,
    complete: activeIndex >= lesson.steps.length,
    active: steps[activeIndex],
    warnings,
  };
}
