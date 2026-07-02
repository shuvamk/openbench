import type {
  FirmwareTarget,
  Project,
  Schematic,
  SimulationRun,
} from "@openbench/ir-schema";

/**
 * Pinned contract between the dashboard (implements) and the editor (consumes).
 * Phase 1 persistence is client-side per ADR-0008; a server-backed store slots
 * in behind this same interface in Phase 2.
 */
export interface ProjectBundle {
  project: Project;
  schematic: Schematic;
  simulationRuns?: SimulationRun[];
  firmwareTarget?: FirmwareTarget;
}

export interface ProjectStore {
  list(): Promise<Project[]>;
  load(projectId: string): Promise<ProjectBundle | undefined>;
  save(bundle: ProjectBundle): Promise<void>;
  remove(projectId: string): Promise<void>;
}
