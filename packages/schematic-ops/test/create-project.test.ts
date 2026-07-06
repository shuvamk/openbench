import { validateProject, validateSchematic } from "@openbench/ir-schema";
import { describe, expect, it } from "vitest";
import { createProject } from "../src/index";

/**
 * Acceptance for the `create_project` factory (spike #33 §5, issue #42): a thin
 * shared factory in schematic-ops that mints a fresh, valid ProjectBundle with
 * an empty schematic. Both the in-app copilot and the agent-control MCP server
 * start new projects through this one function.
 */
describe("createProject", () => {
  it("mints a bundle whose project and schematic both validate", () => {
    const { project, schematic } = createProject("RC low-pass");
    expect(validateProject(project).valid).toBe(true);
    expect(validateSchematic(schematic).valid).toBe(true);
  });

  it("links the project and schematic and starts empty", () => {
    const { project, schematic } = createProject("My board");
    expect(project.name).toBe("My board");
    expect(project.kind).toBe("project");
    expect(schematic.kind).toBe("schematic");
    expect(project.schematicId).toBe(schematic.id);
    expect(schematic.projectId).toBe(project.id);
    expect(schematic.instances).toEqual([]);
    expect(schematic.nets).toEqual([]);
    expect(project.id).toMatch(/^proj_[a-z0-9_-]+$/);
    expect(schematic.id).toMatch(/^sch_[a-z0-9_-]+$/);
  });

  it("is deterministic when ids and clock are injected", () => {
    const opts = { projectId: "proj_fixed1", schematicId: "sch_fixed1", now: "2026-07-06T00:00:00Z" };
    const a = createProject("Same", opts);
    const b = createProject("Same", opts);
    expect(a).toEqual(b);
    expect(a.project.id).toBe("proj_fixed1");
    expect(a.schematic.id).toBe("sch_fixed1");
    expect(a.project.provenance.at).toBe("2026-07-06T00:00:00Z");
  });
});
