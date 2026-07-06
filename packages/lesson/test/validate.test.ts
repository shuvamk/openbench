import { describe, expect, it } from "vitest";
import { IR_VERSION, type ProjectBundle, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { validateLesson, type Lesson, type Step } from "../src/index";

/**
 * Acceptance tests for issue #50 — the lesson self-consistency validator.
 *
 * The subset-match evaluator (`evaluateStep`) already shipped with #89 and is
 * covered by evaluate.test.ts; the remaining gap #50 names is `validateLesson`:
 * a pure, never-throwing check that a lesson's finished `targetBundle` actually
 * satisfies its own steps (so a shared/authored lesson can't ask a student to
 * reach a state the reference design itself never reaches), plus structural
 * checks that reject malformed lessons with a structured result rather than a
 * throw.
 */

const AT = "2026-07-06T00:00:00Z";

function sch(instances: Schematic["instances"], nets: Schematic["nets"]): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_rc",
    projectId: "proj_rc",
    instances,
    nets,
    provenance: { source: "test", at: AT },
  };
}

function bundle(schematic: Schematic): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_rc",
      name: "Series resistor",
      collaborators: [],
      provenance: { source: "test", at: AT },
    },
    schematic,
  };
}

// Finished reference circuit: a 330Ω resistor between a 5 V source and ground.
const V1 = { instanceId: "V1", componentId: "cmp_vsource_dc" } as const;
const R1 = {
  instanceId: "R1",
  componentId: "cmp_resistor_generic",
  parameterOverrides: { resistance: 330 },
} as const;
const GND1 = { instanceId: "GND1", componentId: "cmp_ground" } as const;

const netTop = {
  netId: "net_top",
  name: "VCC",
  connections: [
    { instanceId: "V1", pinId: "pos" },
    { instanceId: "R1", pinId: "p1" },
  ],
};
const netBot = {
  netId: "net_bot",
  name: "GND",
  connections: [
    { instanceId: "R1", pinId: "p2" },
    { instanceId: "V1", pinId: "neg" },
    { instanceId: "GND1", pinId: "gnd" },
  ],
};

const targetSchematic = () => sch([V1, R1, GND1], [netTop, netBot]);

const stepHasResistor: Step = {
  id: "s1-resistor",
  instruction: "Drag a resistor onto the canvas.",
  expect: { component: { of: "cmp_resistor_generic", as: "R" } },
};

const stepResistorWired: Step = {
  id: "s2-wired",
  instruction: "Wire the resistor's p1 to the source's positive terminal.",
  expect: {
    all: [
      { component: { of: "cmp_vsource_dc", as: "V" } },
      { component: { of: "cmp_resistor_generic", as: "R" } },
      { connected: { pins: [{ role: "V", pin: "pos" }, { role: "R", pin: "p1" }] } },
    ],
  },
};

function lessonWith(steps: Step[]): Lesson {
  return {
    lessonFormat: "0.1.0",
    id: "les_series_resistor",
    title: "Series resistor",
    description: "Wire a resistor between a source and ground.",
    difficulty: "intro",
    targetBundle: bundle(targetSchematic()),
    steps,
  };
}

describe("validateLesson", () => {
  it("accepts a lesson whose target bundle satisfies every step", () => {
    const result = validateLesson(lessonWith([stepHasResistor, stepResistorWired]), getComponent);
    expect(result.ok).toBe(true);
  });

  it("rejects a lesson whose target does not satisfy its own final step", () => {
    // Final step demands a 1000Ω resistor, but the reference circuit ships 330Ω.
    const finalStepUnreachable: Step = {
      id: "s3-wrong-value",
      instruction: "Set the resistor to 1000Ω.",
      expect: {
        component: {
          of: "cmp_resistor_generic",
          as: "R",
          where: [{ param: "resistance", eq: 1000 }],
        },
      },
    };
    const result = validateLesson(
      lessonWith([stepHasResistor, finalStepUnreachable]),
      getComponent,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid");
    // The offending step is named so an author can jump straight to it.
    expect(result.issues.some((i) => i.stepId === "s3-wrong-value")).toBe(true);
    expect(result.issues.some((i) => i.code === "TARGET_FAILS_STEP")).toBe(true);
  });

  it("rejects a lesson with no steps (structured, no throw)", () => {
    const result = validateLesson(lessonWith([]), getComponent);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid");
    expect(result.issues.some((i) => i.code === "EMPTY_STEPS")).toBe(true);
  });

  it("rejects a step missing its id or expect predicate (structured, no throw)", () => {
    const malformed = {
      ...lessonWith([stepHasResistor]),
      steps: [{ id: "", instruction: "no expect", expect: undefined }],
    } as unknown as Lesson;
    const result = validateLesson(malformed, getComponent);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid");
    expect(result.issues.some((i) => i.code === "MALFORMED_STEP")).toBe(true);
  });

  it("rejects duplicate step ids (progress tracking needs them unique)", () => {
    const dup = lessonWith([stepHasResistor, { ...stepResistorWired, id: "s1-resistor" }]);
    const result = validateLesson(dup, getComponent);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid");
    expect(result.issues.some((i) => i.code === "DUPLICATE_STEP_ID")).toBe(true);
  });

  it("never throws on a wholly malformed lesson value", () => {
    expect(() => validateLesson(null as unknown as Lesson, getComponent)).not.toThrow();
    const result = validateLesson(null as unknown as Lesson, getComponent);
    expect(result.ok).toBe(false);
  });
});
