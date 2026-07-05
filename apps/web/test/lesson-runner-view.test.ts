import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import type { Lesson } from "@openbench/lesson";
import { checkSchematic } from "@openbench/erc";
import { getComponent } from "@openbench/registry";
import { deriveRunnerView } from "../lib/lesson/runner";

const AT = "2026-07-05T00:00:00Z";

/** A trimmed two-step 7-seg lesson: place parts, then a 330Ω resistor wired in. */
function lesson(): Lesson {
  return {
    lessonFormat: "0.1.0",
    id: "les_7seg_test",
    title: "7-Segment",
    description: "Light a 7-segment display.",
    difficulty: "beginner",
    targetBundle: {} as Lesson["targetBundle"],
    steps: [
      {
        id: "s1-parts",
        instruction: "Place a **7-Segment Display** and a **5 V DC source**.",
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
        hint: "Display under Outputs; source under Sources.",
      },
      {
        id: "s2-resistor-a",
        instruction: "Wire a **330 Ω** resistor between the supply and segment **a**.",
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
        hint: "One resistor pin to +5 V, the other to the display's a pin.",
        allowAutoPlace: true,
      },
    ],
  };
}

function emptySchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_t",
    projectId: "proj_t",
    instances: [],
    nets: [],
    provenance: { source: "frontend", at: AT },
  };
}

/** Display + 5 V source only — satisfies step 1, not step 2. */
function partsOnly(): Schematic {
  return {
    ...emptySchematic(),
    instances: [
      { instanceId: "DISP1", componentId: "cmp_7segment_display" },
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
    ],
  };
}

/** partsOnly + a correctly-wired 330Ω resistor. Satisfies steps 1 and 2. */
function resistorWired(resistance: number): Schematic {
  return {
    ...emptySchematic(),
    instances: [
      { instanceId: "DISP1", componentId: "cmp_7segment_display" },
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      {
        instanceId: "R1",
        componentId: "cmp_resistor_generic",
        parameterOverrides: { resistance },
      },
    ],
    nets: [
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
  };
}

describe("deriveRunnerView", () => {
  it("makes the first unsatisfied step active and locks the rest", () => {
    const view = deriveRunnerView(lesson(), emptySchematic(), getComponent, checkSchematic);
    expect(view.activeIndex).toBe(0);
    expect(view.complete).toBe(false);
    expect(view.steps.map((s) => s.status)).toEqual(["active", "locked"]);
    expect(view.active?.step.id).toBe("s1-parts");
  });

  it("advances the active step forward once its predicate passes", () => {
    const view = deriveRunnerView(lesson(), partsOnly(), getComponent, checkSchematic);
    expect(view.activeIndex).toBe(1);
    expect(view.steps[0]!.status).toBe("passed");
    expect(view.steps[0]!.result.passed).toBe(true);
    expect(view.active?.step.id).toBe("s2-resistor-a");
  });

  it("keeps a step active with an unsatisfied clause when the resistor value is wrong", () => {
    const view = deriveRunnerView(lesson(), resistorWired(1000), getComponent, checkSchematic);
    expect(view.activeIndex).toBe(1);
    expect(view.active?.result.passed).toBe(false);
    // The 330Ω constraint clause is the one that fails.
    expect(view.active?.result.clauses.some((c) => !c.satisfied)).toBe(true);
  });

  it("completes when every step passes", () => {
    const view = deriveRunnerView(lesson(), resistorWired(330), getComponent, checkSchematic);
    expect(view.complete).toBe(true);
    expect(view.activeIndex).toBe(2);
    expect(view.active).toBeUndefined();
    expect(view.steps.every((s) => s.status === "passed")).toBe(true);
  });

  it("surfaces ERC floating-pin warnings on a passing step without failing it", () => {
    // Resistor correct → step 2 passes, but display segments b–g dangle → warnings.
    const view = deriveRunnerView(lesson(), resistorWired(330), getComponent, checkSchematic);
    const step2 = view.steps[1]!;
    expect(step2.result.passed).toBe(true);
    expect(step2.result.warnings.length).toBeGreaterThan(0);
  });
});
