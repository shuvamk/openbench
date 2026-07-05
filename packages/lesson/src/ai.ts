import type { ProjectBundle, Schematic } from "@openbench/ir-schema";
import type { Violation } from "@openbench/erc";
import { evaluateStep } from "./evaluate";
import { deriveStepsFromRecording, type DeriveOptions, type RecordingBatch } from "./record";
import type { ResolveComponent, Step } from "./types";

/**
 * Teaching-mode AI seam (issue #92), per .context/design/teaching-mode.md §7
 * (ADR-0022). Two AI touch-points behind one interface whose **default
 * implementation is a deterministic mock**, so the entire feature — author,
 * share, validate, hint — runs end to end with **zero API key**. A real,
 * key-backed implementation only *upgrades* prose/predicate quality; it slots
 * in behind the copilot's provider (#43) without changing this contract.
 */

/** Context the {@link LessonAI.tutor} explanation is grounded in. */
export interface TutorContext {
  /** Maps a componentId to its IR — injected so the seam stays registry-agnostic. */
  resolveComponent: ResolveComponent;
  /**
   * Live-circuit ERC violations (human `message`s) to fold into the
   * explanation. Advisory: they colour "why isn't the sim happy" without
   * gating anything. Machine `rule` codes are never surfaced.
   */
  violations?: Violation[];
}

export interface LessonAI {
  /** Draft steps (instructions + predicates) from a recording of the target build. */
  autoAuthor(
    bundle: ProjectBundle,
    recording: RecordingBatch[],
    options?: DeriveOptions,
  ): Promise<Step[]>;
  /** Explain, in prose, what's left for a step given the live schematic. */
  tutor(step: Step, schematic: Schematic, context: TutorContext): Promise<string>;
}

/**
 * The zero-dependency, no-key default. `autoAuthor` is exactly the structural
 * {@link deriveStepsFromRecording} (§5); `tutor` composes the step's static
 * `hint` with the templated unmet-clause descriptions (§3.3) and the ERC
 * messages (§3.4). Deterministic: same inputs → same output, no network.
 */
export class MockLessonAI implements LessonAI {
  async autoAuthor(
    _bundle: ProjectBundle,
    recording: RecordingBatch[],
    options?: DeriveOptions,
  ): Promise<Step[]> {
    return deriveStepsFromRecording(recording, options);
  }

  async tutor(step: Step, schematic: Schematic, context: TutorContext): Promise<string> {
    const { resolveComponent, violations = [] } = context;
    const result = evaluateStep(step, schematic, resolveComponent);

    const parts: string[] = [];
    if (step.hint) parts.push(step.hint);

    const unmet = result.clauses.filter((c) => !c.satisfied).map((c) => c.describe);
    if (unmet.length > 0) parts.push(`Still to do: ${unmet.join("; ")}.`);

    for (const violation of violations) parts.push(violation.message);

    return parts.join(" ").trim();
  }
}

/** Key-optional default: the deterministic mock (no API key, no network). */
export const defaultLessonAI: LessonAI = new MockLessonAI();
