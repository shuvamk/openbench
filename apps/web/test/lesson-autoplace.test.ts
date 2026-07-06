import { describe, expect, it } from "vitest";
import { IR_VERSION, type ProjectBundle, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { evaluateStep, type Lesson, type Step } from "@openbench/lesson";
import { autoPlaceStep, stepAllowsAutoPlace } from "../lib/lesson/autoplace";

/**
 * "Do it for me" (issue 153, teaching-mode.md §7): applying the minimal mutation
 * from the lesson's targetBundle so an allowAutoPlace step's predicate passes.
 * Roles in the predicate (R/V/DISP) are NOT the target instanceIds (R1/V1/DISP1),
 * and the student's own parts carry their own ids — so autoplace must bind roles
 * to the target by component + `where`, then map onto the live schematic.
 */
const AT = "2026-07-05T00:00:00Z";
const sch = (
  instances: Schematic["instances"],
  nets: Schematic["nets"],
): Schematic => ({
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_7seg",
  projectId: "proj_7seg",
  instances,
  nets,
  provenance: { source: "test", at: AT },
});

// The reference (target) solution — full single-segment build.
const targetSchematic = sch(
  [
    { instanceId: "V1", componentId: "cmp_vsource_dc", parameterOverrides: { voltage: 5 } },
    { instanceId: "DISP1", componentId: "cmp_7segment_display" },
    { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 330 } },
    { instanceId: "GND1", componentId: "cmp_ground" },
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
      connections: [
        { instanceId: "R1", pinId: "p2" },
        { instanceId: "DISP1", pinId: "a" },
      ],
    },
    {
      netId: "net_com",
      name: "GND",
      connections: [
        { instanceId: "DISP1", pinId: "com" },
        { instanceId: "GND1", pinId: "gnd" },
        { instanceId: "V1", pinId: "neg" },
      ],
    },
  ],
);

function lesson(): Lesson {
  return {
    lessonFormat: "0.1.0",
    id: "les_7seg",
    title: "7-Segment",
    description: "Light segment a.",
    difficulty: "beginner",
    targetBundle: { schematic: targetSchematic } as ProjectBundle,
    steps: [
      {
        id: "s1-parts",
        instruction: "Place the display and supply.",
        expect: {
          all: [
            { component: { of: "cmp_7segment_display", as: "DISP" } },
            {
              component: {
                of: "cmp_vsource_dc",
                as: "V",
                where: [{ param: "voltage", approx: { value: 5, tolerancePct: 5 } }],
              },
            },
          ],
        },
      },
      {
        id: "s2-resistor-a",
        instruction: "Wire a 330Ω resistor between supply and segment a.",
        expect: {
          all: [
            {
              component: {
                of: "cmp_resistor_generic",
                as: "R",
                where: [{ param: "resistance", approx: { value: 330, tolerancePct: 10 } }],
              },
            },
            { connected: { pins: [{ role: "R", pin: "p1" }, { role: "V", pin: "pos" }] } },
            { connected: { pins: [{ role: "R", pin: "p2" }, { role: "DISP", pin: "a" }] } },
          ],
        },
        allowAutoPlace: true,
      },
    ],
  };
}

// The student has completed step 1 with THEIR OWN instanceIds (not the target's).
const studentAfterStep1 = sch(
  [
    { instanceId: "u_disp", componentId: "cmp_7segment_display" },
    { instanceId: "u_src", componentId: "cmp_vsource_dc", parameterOverrides: { voltage: 5 } },
  ],
  [],
);

const step2 = () => lesson().steps[1] as Step;

describe("stepAllowsAutoPlace", () => {
  it("is true only for steps flagged allowAutoPlace", () => {
    expect(stepAllowsAutoPlace(lesson().steps[0]!)).toBe(false);
    expect(stepAllowsAutoPlace(step2())).toBe(true);
  });
});

describe("autoPlaceStep", () => {
  it("makes an unsatisfied allowAutoPlace step pass by importing the target slice", () => {
    const before = evaluateStep(step2(), studentAfterStep1, getComponent);
    expect(before.passed).toBe(false);

    const next = autoPlaceStep(lesson(), step2(), studentAfterStep1, getComponent);
    expect(evaluateStep(step2(), next, getComponent).passed).toBe(true);
  });

  it("adds the missing resistor and wires it to the student's existing parts", () => {
    const next = autoPlaceStep(lesson(), step2(), studentAfterStep1, getComponent);
    // A 330Ω resistor was placed.
    const resistor = next.instances.find(
      (i) => i.componentId === "cmp_resistor_generic" && i.parameterOverrides?.resistance === 330,
    );
    expect(resistor).toBeDefined();
    // The student's own instances are preserved (not duplicated).
    expect(next.instances.filter((i) => i.componentId === "cmp_vsource_dc")).toHaveLength(1);
    expect(next.instances.filter((i) => i.componentId === "cmp_7segment_display")).toHaveLength(1);
    // The new resistor's p1 shares a net with the student's source pos.
    const rId = resistor!.instanceId;
    const p1Net = next.nets.find((n) =>
      n.connections.some((c) => c.instanceId === rId && c.pinId === "p1"),
    );
    expect(p1Net!.connections).toContainEqual({ instanceId: "u_src", pinId: "pos" });
  });

  it("is a no-op-ish idempotent apply — re-running keeps the step passing without dup parts", () => {
    const once = autoPlaceStep(lesson(), step2(), studentAfterStep1, getComponent);
    const twice = autoPlaceStep(lesson(), step2(), once, getComponent);
    expect(evaluateStep(step2(), twice, getComponent).passed).toBe(true);
    expect(twice.instances.filter((i) => i.componentId === "cmp_resistor_generic")).toHaveLength(1);
  });

  // Regression (issue #54): a single step that introduces several IDENTICAL parts
  // (e.g. seven 330Ω resistors, one per segment) must place a DISTINCT instance
  // per role. The previous reuse logic re-bound a just-imported clone to the next
  // role — collapsing N roles onto ⌈N/2⌉ instances — because it only excluded
  // instances already *reused*, not ones already assigned to a role this call.
  it("places one distinct instance per role when a step introduces N identical parts", () => {
    const N = 5;
    const roles = Array.from({ length: N }, (_, i) => `R${i + 1}`);
    const targets = roles.map((_r, i) => ({
      instanceId: `T${i + 1}`,
      componentId: "cmp_resistor_generic",
      parameterOverrides: { resistance: 330 },
    }));
    const multiTarget = sch(targets, []);
    const multiLesson: Lesson = {
      lessonFormat: "0.1.0",
      id: "les_multi",
      title: "Many resistors",
      description: "Place N identical resistors.",
      difficulty: "beginner",
      targetBundle: { schematic: multiTarget } as ProjectBundle,
      steps: [
        {
          id: "place-many",
          instruction: "Place N resistors.",
          expect: {
            all: roles.map((role) => ({
              component: {
                of: "cmp_resistor_generic",
                as: role,
                where: [{ param: "resistance", approx: { value: 330, tolerancePct: 5 } }],
              },
            })),
          },
          allowAutoPlace: true,
        },
      ],
    };
    const step = multiLesson.steps[0]!;
    const placed = autoPlaceStep(multiLesson, step, sch([], []), getComponent);
    expect(
      placed.instances.filter((i) => i.componentId === "cmp_resistor_generic"),
    ).toHaveLength(N);
    // The step needs N DISTINCT instances (injective role binding) — so it passes.
    expect(evaluateStep(step, placed, getComponent).passed).toBe(true);
  });
});
