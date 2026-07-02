/**
 * @openbench/ir-schema — the canonical OpenBench Interchange Format.
 *
 * Executable twin of .context/interchange-format.md. The spec doc and these
 * schemas must never drift (spec-sync test). Currently implemented kinds:
 * `component`. Remaining kinds land via Phase 1 issues.
 */
export { IR_VERSION, isSupportedIrVersion } from "./version";
export type { ValidationError, ValidationResult } from "./validate";
export {
  componentSchema,
  validateComponent,
  type Component,
  type ComponentParameter,
  type Pin,
} from "./component";
