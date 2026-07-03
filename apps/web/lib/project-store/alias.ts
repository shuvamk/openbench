/** The seeded demo project's literal id (issue #11). */
export const DEMO_PROJECT_ID = "proj_demo";

/** The seeded interactive playground project's literal id (issue #26). */
export const PLAYGROUND_PROJECT_ID = "proj_playground";

/**
 * Friendly deep-link names for seeded projects, so the marketing site can
 * link `/editor/demo` and `/editor/playground` without knowing the id
 * prefix convention.
 */
const ALIASES: Readonly<Record<string, string>> = {
  demo: DEMO_PROJECT_ID,
  playground: PLAYGROUND_PROJECT_ID,
};

/** `load("demo")` / `load("playground")` must resolve the seeded projects. */
export function resolveProjectId(projectId: string): string {
  return ALIASES[projectId] ?? projectId;
}
