import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { checkSchematic } from "@openbench/erc";
import { getComponent } from "@openbench/registry";
import { evaluateStep, type Lesson, type SchematicPredicate, type Step } from "../src/index";

/**
 * Acceptance tests for issue #89 — the teaching-mode lesson core, matching the
 * settled design in .context/design/teaching-mode.md (ADR-0022).
 *
 * `evaluateStep(step, schematic, resolveComponent, erc?)` is a pure, existential
 * subset-match evaluator over an `all`/`any`/`not` predicate tree of `component`
 * and `connected` clauses. A step passes when SOME injective binding of role
 * variables → distinct instances satisfies every top-level clause. Component
 * resolution is injected and the evaluator never throws. ERC is an optional
 * warning feed and never changes `passed`.
 *
 * The worked example is the §4 "7-Segment LED Display" lesson, built with the
 * real registry ids: cmp_7segment_display (pins a–g, dp, com), cmp_vsource_dc
 * (pos/neg, voltage), cmp_resistor_generic (p1/p2, resistance), cmp_ground (gnd).
 */

const AT = "2026-07-05T00:00:00Z";

function sch(
  instances: Schematic["instances"],
  nets: Schematic["nets"],
): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_7seg",
    projectId: "proj_7seg",
    instances,
    nets,
    provenance: { source: "test", at: AT },
  };
}

// ── Instances of the finished single-segment (`a`) circuit ──────────────────
const V1 = { instanceId: "V1", componentId: "cmp_vsource_dc" } as const; // voltage default 5
const DISP1 = { instanceId: "U1", componentId: "cmp_7segment_display" } as const;
const R1 = {
  instanceId: "Ra",
  componentId: "cmp_resistor_generic",
  parameterOverrides: { resistance: 330 },
} as const;
const GND1 = { instanceId: "GND1", componentId: "cmp_ground" } as const;

const netVpos = {
  netId: "net_vpos",
  name: "VCC",
  connections: [
    { instanceId: "V1", pinId: "pos" },
    { instanceId: "Ra", pinId: "p1" },
  ],
};
const netSegA = {
  netId: "net_seg_a",
  connections: [
    { instanceId: "Ra", pinId: "p2" },
    { instanceId: "U1", pinId: "a" },
  ],
};
const netCom = {
  netId: "net_com",
  name: "GND",
  connections: [
    { instanceId: "U1", pinId: "com" },
    { instanceId: "GND1", pinId: "gnd" },
    { instanceId: "V1", pinId: "neg" },
  ],
};

// Progressive builds of the schematic, one per completed step.
const afterStep1 = () => sch([V1, DISP1], []);
const afterStep2 = () => sch([V1, DISP1, R1], [netVpos, netSegA]);
const afterStep3 = () => sch([V1, DISP1, R1, GND1], [netVpos, netSegA, netCom]);

// ── The 3-step lesson (verbatim from design/teaching-mode.md §4) ────────────
const step1: Step = {
  id: "s1-parts",
  instruction: "Drag a **7-Segment Display** and a **5 V DC source** onto the canvas.",
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
};
const step2: Step = {
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
  allowAutoPlace: true,
};
const step3: Step = {
  id: "s3-ground",
  instruction: "Connect the display's **COM** (common cathode) to **Ground**.",
  expect: {
    all: [
      { component: { of: "cmp_ground", as: "GND" } },
      { connected: { pins: [{ role: "DISP", pin: "com" }, { role: "GND", pin: "gnd" }] } },
    ],
  },
};

const sevenSegLesson: Lesson = {
  lessonFormat: "0.1.0",
  id: "les_7seg",
  title: "7-Segment LED Display",
  description: "Light one segment of a common-cathode display.",
  difficulty: "beginner",
  targetBundle: {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_7seg",
      name: "7-Segment LED Display",
      collaborators: [],
      provenance: { source: "test", at: AT },
    },
    schematic: afterStep3(),
  },
  steps: [step1, step2, step3],
};

const pass = (step: Step, schematic: Schematic) =>
  evaluateStep(step, schematic, getComponent).passed;

describe("evaluateStep — 7-Segment worked example", () => {
  it("evaluates green step-by-step as the student builds the circuit", () => {
    expect(sevenSegLesson.steps).toHaveLength(3);

    // Step 1: parts placed, no wiring required.
    expect(pass(step1, afterStep1())).toBe(true);
    expect(pass(step2, afterStep1())).toBe(false);
    expect(pass(step3, afterStep1())).toBe(false);

    // Step 2: 330Ω resistor wired supply → segment a.
    expect(pass(step2, afterStep2())).toBe(true);
    expect(pass(step3, afterStep2())).toBe(false);

    // Step 3: common cathode grounded.
    expect(pass(step3, afterStep3())).toBe(true);
  });

  it("is monotone: adding correct wiring never un-passes an earlier step", () => {
    for (const s of [afterStep1(), afterStep2(), afterStep3()]) {
      expect(pass(step1, s)).toBe(true);
    }
    for (const s of [afterStep2(), afterStep3()]) {
      expect(pass(step2, s)).toBe(true);
    }
  });

  it("reports one satisfied entry per top-level clause in author order", () => {
    const result = evaluateStep(step2, afterStep2(), getComponent);
    expect(result.passed).toBe(true);
    // step2 has 3 top-level clauses: the resistor + two connections.
    expect(result.clauses).toHaveLength(3);
    expect(result.clauses.every((c) => c.satisfied)).toBe(true);
    expect(result.clauses.map((c) => c.describe).every((d) => typeof d === "string")).toBe(true);
  });

  it("shows partial progress on a half-wired step", () => {
    // Resistor placed and one end wired, but not yet to segment a.
    const halfWired = sch([V1, DISP1, R1], [netVpos]);
    const result = evaluateStep(step2, halfWired, getComponent);
    expect(result.passed).toBe(false);
    const satisfied = result.clauses.filter((c) => c.satisfied).length;
    expect(satisfied).toBeGreaterThanOrEqual(1);
    expect(satisfied).toBeLessThan(result.clauses.length);
  });
});

describe("evaluateStep — param constraints", () => {
  const approxStep: Step = {
    id: "approx",
    instruction: "330Ω ±10%",
    expect: {
      component: {
        of: "cmp_resistor_generic",
        as: "R",
        where: [{ param: "resistance", approx: { value: 330, tolerancePct: 10 } }],
      },
    },
  };
  const withResistance = (ohms: number) =>
    sch([{ instanceId: "Ra", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: ohms } }], []);

  it("a 330Ω ±10% approx constraint passes across the tolerance band", () => {
    expect(pass(approxStep, withResistance(300))).toBe(true);
    expect(pass(approxStep, withResistance(330))).toBe(true);
    expect(pass(approxStep, withResistance(360))).toBe(true);
  });

  it("the same constraint fails an out-of-band value", () => {
    expect(pass(approxStep, withResistance(1000))).toBe(false);
    // The registry default (1000Ω) also fails when no override is present.
    const defaulted = sch([{ instanceId: "Ra", componentId: "cmp_resistor_generic" }], []);
    expect(pass(approxStep, defaulted)).toBe(false);
  });
});

describe("evaluateStep — predicate tree combinators", () => {
  const hasResistor: SchematicPredicate = { component: { of: "cmp_resistor_generic" } };
  const hasCap: SchematicPredicate = { component: { of: "cmp_capacitor_generic" } };

  it("any: passes when at least one alternative holds", () => {
    const step: Step = { id: "any", instruction: "R or C", expect: { any: [hasResistor, hasCap] } };
    expect(pass(step, afterStep2())).toBe(true); // has a resistor
    expect(pass(step, afterStep1())).toBe(false); // neither
  });

  it("not: passes only when the inner predicate cannot be matched", () => {
    const step: Step = { id: "not", instruction: "no capacitor", expect: { not: hasCap } };
    expect(pass(step, afterStep2())).toBe(true); // no capacitor present
    const withCap = sch([{ instanceId: "C1", componentId: "cmp_capacitor_generic" }], []);
    expect(pass(step, withCap)).toBe(false);
  });

  it("count: enforces a cardinality bound on matching instances", () => {
    const twoResistors: Step = {
      id: "count",
      instruction: "two resistors",
      expect: { component: { of: "cmp_resistor_generic", count: { min: 2 } } },
    };
    expect(pass(twoResistors, afterStep2())).toBe(false); // only one
    const twoR = sch(
      [
        { instanceId: "Ra", componentId: "cmp_resistor_generic" },
        { instanceId: "Rb", componentId: "cmp_resistor_generic" },
      ],
      [],
    );
    expect(pass(twoResistors, twoR)).toBe(true);
  });
});

describe("evaluateStep — robustness & ERC feed", () => {
  it("an unresolved component yields passed:false, never a throw", () => {
    const resolveNothing = () => undefined;
    let result;
    expect(() => {
      result = evaluateStep(step1, afterStep1(), resolveNothing);
    }).not.toThrow();
    expect(result!.passed).toBe(false);
  });

  it("surfaces ERC warnings without failing a structurally-passing step", () => {
    // afterStep2 passes step 2 structurally, but the display's other segments
    // (b–g, dp) and the source's neg pin are still floating — ERC warns.
    const result = evaluateStep(step2, afterStep2(), getComponent, checkSchematic);
    expect(result.passed).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("not wired"))).toBe(true);
  });

  it("omitting the ERC feed yields no warnings", () => {
    const result = evaluateStep(step1, afterStep1(), getComponent);
    expect(result.warnings).toEqual([]);
  });
});
