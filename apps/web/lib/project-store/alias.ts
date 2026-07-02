/** The seeded demo project's literal id (issue #11). */
export const DEMO_PROJECT_ID = "proj_demo";

/**
 * `load("demo")` must resolve the seeded demo project so the marketing site
 * can deep-link `/editor/demo` without knowing the id prefix convention.
 */
export function resolveProjectId(projectId: string): string {
  return projectId === "demo" ? DEMO_PROJECT_ID : projectId;
}
