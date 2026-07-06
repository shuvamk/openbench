import type { Component, Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { placeInstance, type Point } from "@openbench/schematic-ops";

/**
 * The copilot tool layer (issue #43). Every AI action is routed through the
 * SAME headless `@openbench/schematic-ops` mutations the palette/editor uses,
 * so an agent action can never drift from a hand edit — it's a real, reviewable
 * IR mutation, not a black box. Pure and UI-free: the panel wraps these with
 * proposal/accept state; tests exercise them directly.
 */

/** A single, structured tool-call the copilot can propose. */
export type CopilotToolCall = {
  name: "add_instance";
  args: { componentId: string; position?: Point };
};

export interface ToolResult {
  schematic: Schematic;
  /** Instance id created by the tool, if any. */
  instanceId?: string;
}

/** Default drop point when a tool-call omits an explicit position. */
const DEFAULT_POSITION: Point = { x: 0, y: 0 };

/**
 * Apply a copilot tool-call to a schematic, returning a new schematic. Throws
 * on an unresolvable component rather than silently mutating, so a bad
 * proposal surfaces before it ever reaches the document.
 */
export function applyToolCall(
  schematic: Schematic,
  call: CopilotToolCall,
  resolveComponent: (id: string) => Component | undefined = getComponent,
): ToolResult {
  switch (call.name) {
    case "add_instance": {
      const component = resolveComponent(call.args.componentId);
      if (!component) {
        throw new Error(`Unknown component: ${call.args.componentId}`);
      }
      const placed = placeInstance(
        schematic,
        component,
        call.args.position ?? DEFAULT_POSITION,
      );
      return { schematic: placed.schematic, instanceId: placed.instanceId };
    }
    default: {
      const exhaustive: never = call.name;
      throw new Error(`Unknown tool: ${String(exhaustive)}`);
    }
  }
}

export interface SchematicDiff {
  /** Instance ids present in `after` but not `before`. */
  added: string[];
  /** Instance ids present in `before` but not `after`. */
  removed: string[];
}

/**
 * A minimal instance-level diff between two schematics, so a proposal can be
 * rendered as a reviewable IR change before it's accepted.
 */
export function schematicDiff(before: Schematic, after: Schematic): SchematicDiff {
  const beforeIds = new Set(before.instances.map((i) => i.instanceId));
  const afterIds = new Set(after.instances.map((i) => i.instanceId));
  return {
    added: after.instances
      .map((i) => i.instanceId)
      .filter((id) => !beforeIds.has(id)),
    removed: before.instances
      .map((i) => i.instanceId)
      .filter((id) => !afterIds.has(id)),
  };
}
