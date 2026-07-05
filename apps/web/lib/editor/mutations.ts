/**
 * Pure, immutable schematic mutations.
 *
 * The implementation now lives in the headless `@openbench/schematic-ops`
 * package (deps: @openbench/ir-schema only) so the agent-control MCP server
 * and the in-app editor share ONE mutation implementation and can never drift
 * (issue #68 / ADR-0019). The zustand store (./store) still wraps these with
 * dirty-tracking and debounced persistence; tests exercise the package directly.
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
} from "@openbench/schematic-ops";
