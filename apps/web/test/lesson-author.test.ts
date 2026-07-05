import { describe, expect, it } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { evaluateStep } from "@openbench/lesson";
import {
  deriveStepsFromHistory,
  editStepInList,
  loosenStepInList,
  mergeStepsInList,
  previewSteps,
  recordingBatchesFromHistory,
  splitStepInList,
} from "../lib/lesson/author";

/**
 * Teaching-author mode (issue 151): the editor's undo-history (a stack of
 * cumulative schematic snapshots) is grouped into RecordingBatch[] and fed to
 * deriveStepsFromRecording, then the author edits / splits / merges / loosens
 * and previews each step's pass/fail against the live schematic.
 *
 * Fixture mirrors packages/lesson §4 "7-Segment" build, but shaped like the
 * editor store's `past` (pre-mutation snapshots, oldest first) + the current
 * schematic: past = [S0, S1, S2], current = S3.
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

const S0 = sch([], []);
const S1 = sch([V1, DISP1], []);
const S2 = sch([V1, DISP1, R1], [netVpos, netSegA]);
const S3 = sch([V1, DISP1, R1, GND1], [netVpos, netSegA, netCom]);
const past = [S0, S1, S2];
const current = S3;

const passes = (step: { expect: unknown; id: string; instruction: string }, against: Schematic) =>
  evaluateStep(step as never, against, getComponent).passed;

describe("recordingBatchesFromHistory", () => {
  it("uses the oldest snapshot as the baseline and each later snapshot as a batch", () => {
    const { startSchematic, batches } = recordingBatchesFromHistory(past, current);
    expect(startSchematic).toBe(S0);
    expect(batches.map((b) => b.schematic)).toEqual([S1, S2, S3]);
  });

  it("yields no batches when nothing was built yet (empty history)", () => {
    const { startSchematic, batches } = recordingBatchesFromHistory([], S0);
    expect(startSchematic).toBe(S0);
    expect(batches).toEqual([]);
  });
});

describe("deriveStepsFromHistory", () => {
  it("groups the undo-history into one candidate step per structural batch", () => {
    const steps = deriveStepsFromHistory(past, current);
    expect(steps).toHaveLength(3);
  });

  it("every derived step passes against the final (live) schematic", () => {
    const steps = deriveStepsFromHistory(past, current);
    for (const step of steps) expect(passes(step, current)).toBe(true);
  });

  it("returns no steps for an empty build", () => {
    expect(deriveStepsFromHistory([], S0)).toEqual([]);
  });
});

describe("author step-list edits", () => {
  it("editStepInList updates instruction/hint on the target step only", () => {
    const steps = deriveStepsFromHistory(past, current);
    const targetId = steps[1]!.id;
    const edited = editStepInList(steps, targetId, {
      instruction: "Wire the 330Ω resistor",
      hint: "one pin to +5V",
    });
    const hit = edited.find((s) => s.id === targetId)!;
    expect(hit.instruction).toBe("Wire the 330Ω resistor");
    expect(hit.hint).toBe("one pin to +5V");
    // Untouched steps are unchanged.
    expect(edited[0]!.instruction).toBe(steps[0]!.instruction);
  });

  it("splitStepInList replaces a multi-clause step with its parts in place, still passing", () => {
    const steps = deriveStepsFromHistory(past, current);
    const target = steps[1]!; // the resistor+2-nets batch → multiple clauses
    const split = splitStepInList(steps, target.id);
    expect(split.length).toBeGreaterThan(steps.length);
    // The split parts occupy the original position (step 0 still first).
    expect(split[0]!.id).toBe(steps[0]!.id);
    for (const step of split) expect(passes(step, current)).toBe(true);
  });

  it("mergeStepsInList merges the named steps into one at the first's position, still passing", () => {
    const steps = deriveStepsFromHistory(past, current);
    const merged = mergeStepsInList(steps, [steps[0]!.id, steps[1]!.id]);
    expect(merged).toHaveLength(steps.length - 1);
    // Merged step sits where step 0 was; step 2 survives after it.
    expect(merged[merged.length - 1]!.id).toBe(steps[2]!.id);
    for (const step of merged) expect(passes(step, current)).toBe(true);
  });

  it("loosenStepInList turns an exact resistance into a tolerance band a near value passes", () => {
    const steps = deriveStepsFromHistory(past, current);
    // step 2 (index 1) carries a where: resistance eq 330 seeded from the override.
    const resistorStepId = steps[1]!.id;
    // A build with a 315Ω resistor (within ±10% of 330) — fails exact, passes loose.
    const near = sch(
      [V1, DISP1, { ...R1, parameterOverrides: { resistance: 315 } }, GND1],
      [netVpos, netSegA, netCom],
    );
    expect(passes(steps[1]!, near)).toBe(false);
    const loosened = loosenStepInList(steps, resistorStepId, 10);
    const loosenedStep = loosened.find((s) => s.id === resistorStepId)!;
    expect(passes(loosenedStep, near)).toBe(true);
  });
});

describe("previewSteps", () => {
  it("evaluates each candidate step against the live schematic (pass/fail)", () => {
    const steps = deriveStepsFromHistory(past, current);
    // Against S1 only the first batch (place parts) is satisfied.
    const previews = previewSteps(steps, S1, getComponent);
    expect(previews).toHaveLength(3);
    expect(previews[0]!.result.passed).toBe(true);
    expect(previews[1]!.result.passed).toBe(false);
    expect(previews[2]!.result.passed).toBe(false);
    // Against the final schematic every step passes.
    const finalPreviews = previewSteps(steps, current, getComponent);
    expect(finalPreviews.every((p) => p.result.passed)).toBe(true);
  });
});
