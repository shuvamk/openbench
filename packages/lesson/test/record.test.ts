import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import {
  deriveStepsFromRecording,
  loosenConstraints,
  mergeSteps,
  splitStep,
  evaluateStep,
  type ParamConstraint,
  type Step,
} from "../src/index";

/**
 * Author-by-recording (issue #90, design/teaching-mode.md §5): turning an
 * editor mutation recording into a Step[] whose `expect` predicates are each
 * satisfiable *by the exact schematic that was built* — no drift. The recording
 * is a sequence of cumulative schematic snapshots (one per undo-history batch);
 * each batch's diff (instances added → component clauses, nets formed →
 * connected clauses) becomes one candidate step.
 *
 * Fixture: the §4 "7-Segment LED Display" single-segment build.
 */

const AT = "2026-07-05T00:00:00Z";
const sch = (instances: Schematic["instances"], nets: Schematic["nets"]): Schematic => ({
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_7seg",
  projectId: "proj_7seg",
  instances,
  nets,
  provenance: { source: "test", at: AT },
});

const V1 = { instanceId: "V1", componentId: "cmp_vsource_dc" } as const;
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

// The recording: one cumulative snapshot per completed authoring batch.
const recording = [
  { schematic: sch([V1, DISP1], []), label: "place display + supply" },
  { schematic: sch([V1, DISP1, R1], [netVpos, netSegA]), label: "add 330Ω to seg a" },
  { schematic: sch([V1, DISP1, R1, GND1], [netVpos, netSegA, netCom]), label: "ground COM" },
];
const finalSchematic = recording[recording.length - 1]!.schematic;
const passes = (step: Step, against: Schematic = finalSchematic): boolean =>
  evaluateStep(step, against, getComponent).passed;

describe("deriveStepsFromRecording", () => {
  it("derives one step per batch that added structure", () => {
    const steps = deriveStepsFromRecording(recording);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.id)).toEqual(["step-1", "step-2", "step-3"]);
  });

  it("every derived step's predicate passes against the final schematic", () => {
    const steps = deriveStepsFromRecording(recording);
    for (const step of steps) {
      expect(passes(step)).toBe(true);
    }
  });

  it("adds component clauses for new instances and connected clauses for new nets", () => {
    const steps = deriveStepsFromRecording(recording);
    // step 1: two parts, no wiring
    const s1 = JSON.stringify(steps[0]!.expect);
    expect(s1).toContain("cmp_vsource_dc");
    expect(s1).toContain("cmp_7segment_display");
    expect(s1).not.toContain("connected");
    // step 2: a resistor + two connections
    const s2 = JSON.stringify(steps[1]!.expect);
    expect(s2).toContain("cmp_resistor_generic");
    expect(s2).toContain("connected");
  });

  it("seeds a `where` constraint from a new instance's parameter overrides", () => {
    const steps = deriveStepsFromRecording(recording);
    const resistorClause = JSON.stringify(steps[1]!.expect);
    // exact eq:330 by default (author loosens later)
    expect(resistorClause).toContain('"resistance"');
    expect(resistorClause).toContain("330");
  });

  it("ignores a batch that only moves parts (no structural diff)", () => {
    const moved = { ...V1 };
    const withMove = [...recording, { schematic: sch([moved, DISP1, R1, GND1], [netVpos, netSegA, netCom]) }];
    expect(deriveStepsFromRecording(withMove)).toHaveLength(3);
  });

  it("treats startSchematic parts as baseline, not steps", () => {
    const steps = deriveStepsFromRecording(recording, { startSchematic: sch([V1, DISP1], []) });
    // step 1's parts pre-exist → first derived step is the resistor batch
    expect(steps).toHaveLength(2);
    expect(JSON.stringify(steps[0]!.expect)).toContain("cmp_resistor_generic");
  });
});

describe("loosenConstraints", () => {
  it("turns an exact eq:330 into approx ±10% and still passes", () => {
    const steps = deriveStepsFromRecording(recording);
    const loosened = loosenConstraints(steps[1]!, 10);
    // the constraint is now approx, not eq
    const constraints: ParamConstraint[] = [];
    JSON.stringify(loosened.expect, (k, v) => {
      if (k === "approx") constraints.push(v);
      return v;
    });
    expect(constraints.some((c) => (c as unknown as { value: number }).value === 330)).toBe(true);
    expect(passes(loosened)).toBe(true);
  });
});

describe("splitStep / mergeSteps preserve satisfiability", () => {
  it("splitting a multi-clause step yields per-clause steps that each pass", () => {
    const steps = deriveStepsFromRecording(recording);
    const parts = splitStep(steps[1]!); // resistor + 2 connections
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const part of parts) expect(passes(part)).toBe(true);
  });

  it("merging two steps yields one step that still passes", () => {
    const steps = deriveStepsFromRecording(recording);
    const merged = mergeSteps(steps[0]!, steps[1]!);
    expect(passes(merged)).toBe(true);
    // merged predicate is the union of both steps' clauses
    const merizedS = JSON.stringify(merged.expect);
    expect(merizedS).toContain("cmp_vsource_dc");
    expect(merizedS).toContain("cmp_resistor_generic");
  });
});
