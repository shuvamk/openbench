/**
 * @openbench/schematic-ops — headless, pure Schematic→Schematic authoring
 * operations over the IR.
 *
 * Depends only on @openbench/ir-schema (no Next.js, no UI, no engine), so an
 * MCP server can import it as easily as the in-app editor. This is the single
 * shared mutation implementation behind both the in-app copilot and the
 * agent-control surface (ADR-0019 / issue #33) — extracted verbatim from
 * apps/web/lib/editor/mutations.ts, which now re-exports from here.
 */
export {
  GRID,
  snapToGrid,
  refPrefix,
  placeInstance,
  moveInstance,
  rotateInstance,
  connectPins,
  deleteSelection,
  setParameterOverride,
  type Point,
  type PlaceResult,
} from "./mutations";
export { createProject, type CreateProjectOptions } from "./project";
