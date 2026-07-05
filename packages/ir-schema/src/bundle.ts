import type { FirmwareTarget } from "./firmware-target";
import type { Project } from "./project";
import type { Schematic } from "./schematic";
import type { SimulationRun } from "./simulation-run";

/**
 * A ProjectBundle aggregates the IR documents that make up one project — the
 * project metadata, its schematic, and any simulation / firmware artifacts.
 *
 * Promoted from `apps/web` to the shared IR package (issue #89) so non-UI
 * consumers (the lesson runner, MCP servers, future server-backed stores) can
 * pass bundles around without depending on the web app. It is a convenience
 * aggregate, not a seventh IR `kind`: it has no schema of its own and is not
 * part of the `irDocument` discriminated union.
 */
export interface ProjectBundle {
  project: Project;
  schematic: Schematic;
  simulationRuns?: SimulationRun[];
  firmwareTarget?: FirmwareTarget;
}
