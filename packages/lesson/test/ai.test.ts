import { describe, expect, it } from "vitest";
import { IR_VERSION, type ProjectBundle, type Schematic } from "@openbench/ir-schema";
import { checkSchematic } from "@openbench/erc";
import { getComponent } from "@openbench/registry";
import {
  MockLessonAI,
  defaultLessonAI,
  deriveStepsFromRecording,
  type LessonAI,
  type RecordingBatch,
  type Step,
} from "../src/index";

/**
 * Acceptance tests for the key-optional AI seam (issue #92), per
 * .context/design/teaching-mode.md §7 (ADR-0022). `MockLessonAI` is a
 * deterministic default that needs no API key: `autoAuthor` reuses
 * `deriveStepsFromRecording`, `tutor` composes the step's static hint with the
 * templated clause/ERC messages. The real key-backed impl only *upgrades* prose.
 */

const AT = "2026-07-05T00:00:00Z";

function sch(instances: Schematic["instances"], nets: Schematic["nets"] = []): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_ai",
    projectId: "proj_ai",
    instances,
    nets,
    provenance: { source: "test", at: AT },
  };
}

function bundleOf(schematic: Schematic): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: schematic.projectId,
      name: "AI seam",
      schematicId: schematic.id,
      collaborators: [],
      provenance: { source: "test", at: AT },
    },
    schematic,
  };
}

/** Recording: display + source, then a 330Ω resistor wired to segment a. */
function recording(): { batches: RecordingBatch[]; target: Schematic } {
  const step1 = sch([
    { instanceId: "DISP1", componentId: "cmp_7segment_display" },
    { instanceId: "V1", componentId: "cmp_vsource_dc" },
  ]);
  const target = sch(
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
  return { batches: [{ schematic: step1 }, { schematic: target }], target };
}

describe("MockLessonAI", () => {
  const ai: LessonAI = new MockLessonAI();

  it("the default LessonAI is the deterministic mock — no key required", () => {
    expect(defaultLessonAI).toBeInstanceOf(MockLessonAI);
  });

  it("autoAuthor derives the same steps as deriveStepsFromRecording, with no key set", async () => {
    const { batches, target } = recording();
    const steps = await ai.autoAuthor(bundleOf(target), batches);
    expect(steps).toEqual(deriveStepsFromRecording(batches));
    // The derived steps validate against the finished target schematic.
    const last = steps[steps.length - 1]!;
    const { evaluateStep } = await import("../src/index");
    expect(evaluateStep(last, target, getComponent, checkSchematic).passed).toBe(true);
  });

  it("tutor returns the step's hint plus the ERC message, with no key set", async () => {
    // A lone display: every segment pin floats → ERC produces a human message.
    const broken = sch([{ instanceId: "DISP1", componentId: "cmp_7segment_display" }]);
    const { violations } = checkSchematic(broken, getComponent);
    expect(violations.length).toBeGreaterThan(0);

    const step: Step = {
      id: "s2",
      instruction: "Wire a **330 Ω** resistor to segment a.",
      expect: {
        component: {
          of: "cmp_resistor_generic",
          as: "R",
          where: [{ param: "resistance", approx: { value: 330, tolerancePct: 10 } }],
        },
      },
      hint: "One resistor pin to +5 V, the other to the display's a pin.",
    };

    const message = await ai.tutor(step, broken, { resolveComponent: getComponent, violations });

    expect(message).toContain(step.hint);
    // Carries at least one of the ERC engine's human messages…
    expect(violations.some((v) => message.includes(v.message))).toBe(true);
    // …and never leaks a raw ERC_ machine code.
    expect(message).not.toMatch(/ERC_[A-Z_]+/);
  });
});
