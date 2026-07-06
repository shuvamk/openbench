/**
 * @openbench/lesson — teaching-mode lesson core.
 *
 * Pure types + the subset-match SchematicPredicate evaluator (`evaluateStep`)
 * that the authoring UI, student runner, and AI tutor all build on. Depends
 * only on the IR types and the ERC engine; component resolution is injected so
 * the package stays decoupled from the registry. See
 * .context/design/teaching-mode.md (ADR-0022).
 */
export { evaluateStep } from "./evaluate";
export { validateLesson, type LessonIssue, type LessonValidation } from "./validate";
export {
  deriveStepsFromRecording,
  loosenConstraints,
  mergeSteps,
  splitStep,
  type DeriveOptions,
  type RecordingBatch,
} from "./record";
export {
  MockLessonAI,
  defaultLessonAI,
  type LessonAI,
  type TutorContext,
} from "./ai";
export type {
  ClauseResult,
  ComponentClause,
  ConnectedClause,
  Difficulty,
  ErcRunner,
  Lesson,
  LessonFormat,
  ParamConstraint,
  PinRef,
  ResolveComponent,
  SchematicPredicate,
  Step,
  StepResult,
} from "./types";
