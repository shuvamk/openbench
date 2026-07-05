import type { Component, ProjectBundle, Schematic } from "@openbench/ir-schema";
import type { Violation } from "@openbench/erc";

/**
 * Teaching-mode lesson core types (issue #89), implementing the settled design
 * in .context/design/teaching-mode.md §2–3 (ADR-0022).
 *
 * A {@link Lesson} is product metadata wrapped around a target {@link ProjectBundle}
 * — deliberately NOT an IR kind (it carries pedagogy, not engine interchange).
 * Each {@link Step}'s `expect` is a {@link SchematicPredicate}: an existential,
 * subset match over the student's live schematic, expressed as an `all`/`any`/`not`
 * tree of `component` and `connected` clauses referencing instances by role
 * variable rather than by the student's freely-chosen instanceIds.
 */

/** Versioned independently of `irVersion` — a lesson is not an IR document. */
export type LessonFormat = "0.1.0";

export type Difficulty = "intro" | "beginner" | "intermediate" | "advanced";

/** A guided, shareable walkthrough over a target design. `les_`-prefixed id. */
export interface Lesson {
  lessonFormat: LessonFormat;
  id: `les_${string}`;
  title: string;
  /** Markdown. */
  description: string;
  difficulty: Difficulty;
  /** The finished reference circuit + its sim/firmware. */
  targetBundle: ProjectBundle;
  /** What the student starts from; omit ⇒ empty schematic, or a partial shell. */
  startBundle?: ProjectBundle;
  steps: Step[];
}

/** One instruction gated by a schematic predicate. */
export interface Step {
  /** Stable id used for progress tracking. */
  id: string;
  /** Markdown shown to the student. */
  instruction: string;
  /** PASS condition, evaluated against the live schematic. */
  expect: SchematicPredicate;
  /** Static fallback hint (markdown); an AI tutor may supersede it. */
  hint?: string;
  /** If true, the student may "do it for me" — apply the minimal satisfying mutation. */
  allowAutoPlace?: boolean;
}

/** A declarative subset-match tree. Leaves assert existence / connectivity. */
export type SchematicPredicate =
  | { all: SchematicPredicate[] }
  | { any: SchematicPredicate[] }
  | { not: SchematicPredicate }
  | ComponentClause
  | ConnectedClause;

/** "There is an instance of `of`, meeting `where`, bound to role `as`." */
export interface ComponentClause {
  component: {
    /** componentId, e.g. "cmp_resistor_generic". */
    of: string;
    /** Role variable other clauses can reference. */
    as?: string;
    /** Parameter constraints the bound instance must satisfy (ANDed). */
    where?: ParamConstraint[];
    /** Cardinality of matching instances. Default `{ min: 1 }`. */
    count?: { min?: number; max?: number };
  };
}

/** "These pin-refs all sit on ONE shared net." Subset: the net may have more. */
export interface ConnectedClause {
  connected: {
    /** ≥2 refs; all must resolve to the same netId. */
    pins: PinRef[];
  };
}

/** A pin on a role-bound instance, or on a named net (e.g. a ground/rail). */
export type PinRef =
  | { role: string; pin: string }
  /** A net matched by name (case-insensitive), e.g. `{ net: "GND" }`. */
  | { net: string };

/** A constraint on one resolved component parameter (matchers are ANDed). */
export interface ParamConstraint {
  param: string;
  eq?: number | string;
  /** Symmetric ±tolerancePct% band around `value` (numeric params). */
  approx?: { value: number; tolerancePct: number };
  min?: number;
  max?: number;
}

/** Per-top-level-clause diagnostic driving incremental progress + hints. */
export interface ClauseResult {
  satisfied: boolean;
  /** Human-readable description, e.g. "a 330Ω resistor". */
  describe: string;
  /** Drives the templated hint when unsatisfied. */
  hintKey?: string;
}

/** The outcome of evaluating one {@link Step} against a schematic. */
export interface StepResult {
  /** True when some binding satisfies every top-level clause. */
  passed: boolean;
  /** One entry per top-level clause, in author order. */
  clauses: ClauseResult[];
  /** ERC-derived hints (see §3.4) — advisory only, never affect `passed`. */
  warnings: string[];
}

/** Injected component resolver — maps a componentId to its IR (or undefined). */
export type ResolveComponent = (componentId: string) => Component | undefined;

/**
 * Optional ERC runner (the `@openbench/erc` `checkSchematic` signature). When
 * supplied to {@link evaluateStep}, violations touching instances/nets bound in
 * the step surface as advisory warnings; they never change the structural verdict.
 */
export type ErcRunner = (
  schematic: Schematic,
  resolveComponent: ResolveComponent,
) => { violations: Violation[] };
