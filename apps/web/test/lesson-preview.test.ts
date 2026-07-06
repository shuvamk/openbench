import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { createFromTemplate } from "../lib/templates";
import { buildPreviewLesson } from "../lib/lesson/preview";

/**
 * Issue #163 — the editor's Teaching panel previews the lesson the author is
 * building by wrapping the live editor bundle as a {@link Lesson} the
 * StudentRunnerPanel can validate against. `buildPreviewLesson` is that pure
 * seam: current bundle → targetBundle, undo-history → derived steps.
 */

const AT = "2026-07-05T00:00:00Z";
const sch = (instances: Schematic["instances"], nets: Schematic["nets"]): Schematic => ({
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_preview",
  projectId: "proj_preview",
  instances,
  nets,
  provenance: { source: "test", at: AT },
});

const V1 = { instanceId: "V1", componentId: "cmp_vsource_dc" } as const;
const DISP1 = { instanceId: "U1", componentId: "cmp_7segment_display" } as const;

describe("buildPreviewLesson", () => {
  it("wraps the live bundle as the lesson target with a les_ id and 0.1.0 format", () => {
    const bundle = createFromTemplate("rc-lowpass", "My teaching build");
    const lesson = buildPreviewLesson(bundle, []);

    expect(lesson.lessonFormat).toBe("0.1.0");
    expect(lesson.id).toMatch(/^les_/);
    expect(lesson.targetBundle).toBe(bundle);
    expect(lesson.title).toContain("My teaching build");
    expect(Array.isArray(lesson.steps)).toBe(true);
  });

  it("derives one step per structure-adding batch from the undo history", () => {
    const bundle = createFromTemplate("rc-lowpass", "Author demo");
    const current = sch([V1, DISP1], []);
    const past = [sch([], []), sch([V1], [])];
    const lesson = buildPreviewLesson({ ...bundle, schematic: current }, past);

    // Two batches each added a part → two candidate steps.
    expect(lesson.steps.length).toBe(2);
    expect(lesson.targetBundle.schematic).toBe(current);
  });
});
