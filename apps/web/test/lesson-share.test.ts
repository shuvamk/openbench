import { describe, expect, it } from "vitest";
import { IR_VERSION, type ProjectBundle, type Schematic } from "@openbench/ir-schema";
import { checkSchematic } from "@openbench/erc";
import { getComponent } from "@openbench/registry";
import {
  MockLessonAI,
  evaluateStep,
  type Lesson,
  type RecordingBatch,
} from "@openbench/lesson";
import { isShareError } from "../lib/share";
import { decodeLessonShare, encodeLessonShare } from "../lib/lesson/share";

/**
 * Acceptance tests for the stateless lesson share codec (issue #92), per
 * .context/design/teaching-mode.md §6: a lesson serializes through the SAME #40
 * codec (gzip + URL-safe base64, no backend, one size budget) with a `lesson`
 * payload instead of a bare bundle. Plus the end-to-end author→share→validate→hint
 * path running entirely on the key-free `MockLessonAI`.
 */

const AT = "2026-07-05T00:00:00Z";

function sch(instances: Schematic["instances"], nets: Schematic["nets"] = []): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_les",
    projectId: "proj_les",
    instances,
    nets,
    provenance: { source: "frontend", at: AT },
  };
}

function bundleOf(schematic: Schematic): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: schematic.projectId,
      name: "Lesson target",
      schematicId: schematic.id,
      collaborators: [],
      provenance: { source: "frontend", at: AT },
    },
    schematic,
  };
}

function targetSchematic(): Schematic {
  return sch(
    [
      { instanceId: "DISP1", componentId: "cmp_7segment_display" },
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 330 } },
    ],
    [
      {
        netId: "net_supply",
        name: "SUPPLY",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_seg_a",
        name: "SEG_A",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "DISP1", pinId: "a" },
        ],
      },
    ],
  );
}

function lessonWith(steps: Lesson["steps"]): Lesson {
  return {
    lessonFormat: "0.1.0",
    id: "les_7seg",
    title: "7-Segment LED Display",
    description: "Light segment **a**.",
    difficulty: "beginner",
    targetBundle: bundleOf(targetSchematic()),
    steps,
  };
}

describe("lesson share codec", () => {
  it("round-trips a lesson: decodeLessonShare(encodeLessonShare(l)) deep-equals l (targetBundle intact)", async () => {
    const lesson = lessonWith([
      {
        id: "s1",
        instruction: "Place the display and a 5 V source.",
        expect: {
          all: [
            { component: { of: "cmp_7segment_display", as: "DISP" } },
            { component: { of: "cmp_vsource_dc", as: "V" } },
          ],
        },
      },
    ]);
    const encoded = await encodeLessonShare(lesson);
    expect(isShareError(encoded)).toBe(false);
    const decoded = await decodeLessonShare(encoded as string);
    expect(decoded).toEqual(lesson);
    expect(decoded.targetBundle).toEqual(lesson.targetBundle);
  });

  it("produces a URL-safe payload (no +, /, = or whitespace)", async () => {
    const encoded = (await encodeLessonShare(lessonWith([]))) as string;
    expect(typeof encoded).toBe("string");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("runs the whole author→share→validate→hint path on MockLessonAI (no key)", async () => {
    const ai = new MockLessonAI();

    // AUTHOR — derive steps from a recording of the target build.
    const step1 = sch([
      { instanceId: "DISP1", componentId: "cmp_7segment_display" },
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
    ]);
    const recording: RecordingBatch[] = [{ schematic: step1 }, { schematic: targetSchematic() }];
    const steps = await ai.autoAuthor(bundleOf(targetSchematic()), recording);
    expect(steps.length).toBeGreaterThan(0);

    // SHARE — serialize the authored lesson and read it back.
    const lesson = lessonWith(steps);
    const decoded = await decodeLessonShare((await encodeLessonShare(lesson)) as string);

    // VALIDATE — every authored step passes against the finished target.
    for (const step of decoded.steps) {
      expect(evaluateStep(step, targetSchematic(), getComponent, checkSchematic).passed).toBe(true);
    }

    // HINT — the tutor explains the first step against an empty canvas, no key.
    const empty = sch([]);
    const { violations } = checkSchematic(empty, getComponent);
    const message = await ai.tutor(decoded.steps[0]!, empty, {
      resolveComponent: getComponent,
      violations,
    });
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/ERC_[A-Z_]+/);
  });
});
