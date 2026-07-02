import { describe, expect, it } from "vitest";
import { validateProject } from "../src/index";

/**
 * Acceptance tests for issue #5 — the `project` IR kind.
 * Mirrors the project example in .context/interchange-format.md.
 */
const minimalProject = {
  irVersion: "0.1.0",
  kind: "project",
  id: "proj_00000000000000000000000000000000",
  name: "Blink with adjustable brightness",
  schematicId: "sch_00000000000000000000000000000000",
  firmwareTargetId: "fw_00000000000000000000000000000000",
  latestSimulationRunId: "sim_00000000000000000000000000000000",
  collaborators: [],
  provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
};

const clone = () => structuredClone(minimalProject) as Record<string, any>;

describe("validateProject", () => {
  it("accepts the canonical project", () => {
    const result = validateProject(minimalProject);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a project without linked documents (all references optional)", () => {
    const doc = clone();
    delete doc.schematicId;
    delete doc.firmwareTargetId;
    delete doc.latestSimulationRunId;
    const result = validateProject(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an id not matching proj_*", () => {
    const doc = clone();
    doc.id = "project_1";
    const result = validateProject(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("requires a name", () => {
    const doc = clone();
    delete doc.name;
    const result = validateProject(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "name")).toBe(true);
  });

  it("accepts an empty collaborators array (reserved for Phase 2)", () => {
    const doc = clone();
    doc.collaborators = [];
    const result = validateProject(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects non-array collaborators", () => {
    const doc = clone();
    doc.collaborators = "everyone";
    const result = validateProject(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "collaborators")).toBe(true);
  });
});
