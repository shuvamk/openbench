import {
  validateProject,
  validateSchematic,
  type ValidationError,
} from "@openbench/ir-schema";
import { createFromTemplate } from "../templates";
import { DEMO_PROJECT_ID, resolveProjectId } from "./alias";
import { IndexedDbProjectStore } from "./indexeddb";
import { MemoryProjectStore, createMemoryProjectStore } from "./memory";
import type { ProjectBundle, ProjectStore } from "./types";

export { DEMO_PROJECT_ID, resolveProjectId } from "./alias";
export { IndexedDbProjectStore } from "./indexeddb";
export { MemoryProjectStore, createMemoryProjectStore } from "./memory";
export type { ProjectBundle, ProjectStore } from "./types";

let memorySingleton: MemoryProjectStore | undefined;
let indexedDbSingleton: IndexedDbProjectStore | undefined;

/**
 * The app-wide ProjectStore: IndexedDB in the browser, in-memory anywhere
 * `indexedDB` does not exist (SSR, plain node tests). One instance per
 * backing so repeated calls share state.
 */
export function getProjectStore(): ProjectStore {
  if (typeof indexedDB !== "undefined") {
    indexedDbSingleton ??= new IndexedDbProjectStore();
    return indexedDbSingleton;
  }
  memorySingleton ??= new MemoryProjectStore();
  return memorySingleton;
}

/**
 * First-run seeding: creates the "demo" project (literal id `proj_demo`,
 * also reachable via the `demo` alias) from the RC low-pass template.
 * No-op when the demo project already exists.
 */
export async function ensureSeeded(store: ProjectStore): Promise<void> {
  const existing = await store.load(DEMO_PROJECT_ID);
  if (existing !== undefined) {
    return;
  }
  const bundle = createFromTemplate("rc-lowpass", "RC low-pass demo");
  bundle.project.id = DEMO_PROJECT_ID;
  bundle.schematic.projectId = DEMO_PROJECT_ID;
  await store.save(bundle);
}

/** Serialize a bundle for `.openbench.json` export (stable, human-diffable). */
export function serializeBundle(bundle: ProjectBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export type ParseBundleResult =
  | { ok: true; bundle: ProjectBundle }
  | { ok: false; errors: ValidationError[] };

/**
 * Parse and validate a `.openbench.json` payload. Both IR documents must
 * pass their schema validators and the schematic must belong to the project.
 */
export function parseBundle(json: string): ParseBundleResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      errors: [{ path: "", message: `not valid JSON: ${(error as Error).message}` }],
    };
  }

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: [{ path: "", message: "bundle must be a JSON object" }] };
  }
  const candidate = raw as Partial<ProjectBundle>;

  const errors: ValidationError[] = [];
  const projectResult = validateProject(candidate.project);
  errors.push(
    ...projectResult.errors.map((e) => ({
      path: e.path === "" ? "project" : `project.${e.path}`,
      message: e.message,
    })),
  );
  const schematicResult = validateSchematic(candidate.schematic);
  errors.push(
    ...schematicResult.errors.map((e) => ({
      path: e.path === "" ? "schematic" : `schematic.${e.path}`,
      message: e.message,
    })),
  );

  if (
    projectResult.valid &&
    schematicResult.valid &&
    candidate.schematic!.projectId !== candidate.project!.id
  ) {
    errors.push({
      path: "schematic.projectId",
      message: `schematic belongs to "${candidate.schematic!.projectId}", not "${candidate.project!.id}"`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, bundle: candidate as ProjectBundle };
}
