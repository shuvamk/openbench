import type { Project } from "@openbench/ir-schema";
import { resolveProjectId } from "./alias";
import type { ProjectBundle, ProjectStore } from "./types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * In-memory ProjectStore for tests and SSR passes where IndexedDB does not
 * exist. Bundles are deep-cloned on the way in and out so callers can never
 * mutate stored state by reference.
 */
export class MemoryProjectStore implements ProjectStore {
  private readonly bundles = new Map<string, ProjectBundle>();

  async list(): Promise<Project[]> {
    return [...this.bundles.values()].map((bundle) => clone(bundle.project));
  }

  async load(projectId: string): Promise<ProjectBundle | undefined> {
    const bundle = this.bundles.get(resolveProjectId(projectId));
    return bundle === undefined ? undefined : clone(bundle);
  }

  async save(bundle: ProjectBundle): Promise<void> {
    this.bundles.set(bundle.project.id, clone(bundle));
  }

  async remove(projectId: string): Promise<void> {
    this.bundles.delete(resolveProjectId(projectId));
  }
}

export function createMemoryProjectStore(): ProjectStore {
  return new MemoryProjectStore();
}
