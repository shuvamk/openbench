import type { ProjectBundle, Schematic } from "@openbench/ir-schema";
import type { Lesson } from "@openbench/lesson";
import { deriveStepsFromHistory } from "./author";

/**
 * Wrap the live editor build as a {@link Lesson} the StudentRunnerPanel can
 * validate against, so the editor's Teaching panel can preview the lesson the
 * author is building without a share round-trip (issue #163).
 *
 * The current bundle becomes the `targetBundle` (the reference the runner's
 * "do it for me" auto-place binds against), and the undo-history is derived into
 * candidate {@link Step}s exactly as the author panel does — so what the author
 * sees and what the previewing student runs stay in lock-step. Pure: no store,
 * no engine wiring; the panel supplies the live bundle + history.
 */
export function buildPreviewLesson(bundle: ProjectBundle, past: readonly Schematic[]): Lesson {
  const steps = deriveStepsFromHistory(past, bundle.schematic);
  return {
    lessonFormat: "0.1.0",
    id: "les_preview",
    title: `${bundle.project.name} (preview)`,
    description: "",
    difficulty: "beginner",
    targetBundle: bundle,
    steps,
  };
}
