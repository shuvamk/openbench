import type { ErcRunner, Lesson, ResolveComponent, Step } from "./types";
import { evaluateStep } from "./evaluate";

/**
 * Lesson self-consistency validator (issue #50), complementing the subset-match
 * evaluator from #89. Where `evaluateStep` asks "does the *student's* schematic
 * satisfy this step?", `validateLesson` asks the author-time question: "is this
 * lesson internally coherent?" — chiefly, does the finished `targetBundle`
 * itself satisfy every step? Because the predicates are monotone subset matches
 * (design/teaching-mode.md §3), the reference design is expected to pass every
 * step; a step the target can't reach is an authoring bug that would strand a
 * student, so we reject it up front.
 *
 * Pure and total: like the evaluator it NEVER throws. Any malformed input yields
 * a structured `{ ok: false, issues }` result so callers (author UI, share-link
 * loader, AI auto-author) can surface problems instead of crashing.
 */

/** A single reason a lesson failed validation. `stepId` is set when step-scoped. */
export interface LessonIssue {
  code:
    | "MALFORMED_LESSON"
    | "EMPTY_STEPS"
    | "MALFORMED_STEP"
    | "DUPLICATE_STEP_ID"
    | "TARGET_FAILS_STEP";
  message: string;
  stepId?: string;
}

export type LessonValidation = { ok: true } | { ok: false; issues: LessonIssue[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Validate a lesson's internal consistency. `resolveComponent` (and the optional
 * `erc`) are the same injected dependencies `evaluateStep` takes — the target is
 * checked with exactly the evaluator a student runs against, so "the author says
 * it's done" and "the runner agrees it's done" can never diverge.
 */
export function validateLesson(
  lesson: Lesson,
  resolveComponent: ResolveComponent,
  erc?: ErcRunner,
): LessonValidation {
  const issues: LessonIssue[] = [];

  if (!isObject(lesson)) {
    return { ok: false, issues: [{ code: "MALFORMED_LESSON", message: "Lesson is not an object." }] };
  }

  const steps = (lesson as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    return {
      ok: false,
      issues: [{ code: "MALFORMED_LESSON", message: "Lesson.steps is missing or not an array." }],
    };
  }
  if (steps.length === 0) {
    return { ok: false, issues: [{ code: "EMPTY_STEPS", message: "A lesson needs at least one step." }] };
  }

  // Structural pass: each step must carry a non-empty id and an `expect` predicate,
  // and ids must be unique (progress tracking keys on them).
  const seen = new Set<string>();
  const wellFormed: Step[] = [];
  steps.forEach((step, i) => {
    if (!isObject(step) || typeof step.id !== "string" || step.id.length === 0 || !isObject(step.expect)) {
      issues.push({
        code: "MALFORMED_STEP",
        message: `Step at index ${i} is missing a non-empty id or an expect predicate.`,
        ...(isObject(step) && typeof step.id === "string" && step.id.length > 0 ? { stepId: step.id } : {}),
      });
      return;
    }
    if (seen.has(step.id)) {
      issues.push({ code: "DUPLICATE_STEP_ID", message: `Duplicate step id "${step.id}".`, stepId: step.id });
      return;
    }
    seen.add(step.id);
    wellFormed.push(step as unknown as Step);
  });

  // Self-consistency: the finished reference schematic must satisfy each
  // structurally-valid step. Only checked when a target schematic is present —
  // a malformed/absent target is reported as a lesson-level issue instead.
  const schematic = (lesson.targetBundle as { schematic?: unknown } | undefined)?.schematic;
  if (!isObject(schematic)) {
    issues.push({ code: "MALFORMED_LESSON", message: "Lesson.targetBundle.schematic is missing." });
  } else {
    for (const step of wellFormed) {
      const result = evaluateStep(step, schematic as Parameters<typeof evaluateStep>[1], resolveComponent, erc);
      if (!result.passed) {
        issues.push({
          code: "TARGET_FAILS_STEP",
          message: `The target circuit does not satisfy step "${step.id}".`,
          stepId: step.id,
        });
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
