import type { Project, ProjectBundle } from "@openbench/ir-schema";

/**
 * ProjectBundle is the pinned contract between the dashboard (implements) and
 * the editor (consumes). It was promoted to the shared IR package (issue #89)
 * so non-UI consumers can use it too; re-exported here so existing imports of
 * `project-store/types` keep resolving. Phase 1 persistence is client-side per
 * ADR-0008; a server-backed store slots in behind this same interface in Phase 2.
 */
export type { ProjectBundle };

export interface ProjectStore {
  list(): Promise<Project[]>;
  load(projectId: string): Promise<ProjectBundle | undefined>;
  save(bundle: ProjectBundle): Promise<void>;
  remove(projectId: string): Promise<void>;
}
