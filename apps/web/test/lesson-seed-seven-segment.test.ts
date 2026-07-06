import { describe, expect, it } from "vitest";
import {
  IR_VERSION,
  validateProject,
  validateSchematic,
  type Schematic,
} from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import {
  evaluateStep,
  validateLesson,
  sevenSegmentLesson,
  seedLessons,
} from "@openbench/lesson";
import { compileNetlist } from "@openbench/netlist-compiler";
import {
  EECircuitBackend,
  decodeSamples,
  runSimulation,
} from "@openbench/mcp-sim-ngspice";
import { autoPlaceStep } from "../lib/lesson/autoplace";

/**
 * Acceptance tests for issue #54 — the seeded "7-Segment LED Display" demo
 * lesson, the concrete college practical that motivated teaching mode. It drives
 * a common-cathode digit (all segments a–g lit → "8") from a 5 V rail through
 * seven 330 Ω current-limiting resistors, cathode tied to ground.
 *
 * The criteria (issue #54) are checked end-to-end: the seed passes
 * `validateLesson` (#50); playing every step with "do it for me" (#153)
 * reconstructs the exact target; the target compiles + runs a real transient
 * with every segment forward-biased (lit); each step is a real, non-vacuous gate
 * satisfied by exactly its intended mutation; and it uses the real
 * `cmp_7segment_display` registry part (#44).
 */

const SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"] as const;

const emptySchematic = (): Schematic => ({
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_seven_segment_student",
  projectId: "proj_seven_segment",
  instances: [],
  nets: [],
  provenance: { source: "test", at: "2026-07-06T00:00:00Z" },
});

/**
 * Canonical, order-independent connectivity: for each net, the sorted set of
 * `instanceId.pinId` it joins; nets themselves sorted. Two schematics with the
 * same partition are electrically identical regardless of net ids/names.
 */
const connectivity = (s: Schematic): string[] =>
  s.nets
    .map((n) => n.connections.map((c) => `${c.instanceId}.${c.pinId}`).sort().join("|"))
    .sort();

/** Canonical instance multiset: `instanceId:componentId` + sorted param overrides. */
const instanceSummary = (s: Schematic): string[] =>
  s.instances
    .map((i) => {
      const params = Object.entries(i.parameterOverrides ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      return `${i.instanceId}:${i.componentId}{${params}}`;
    })
    .sort();

/** Fold "do it for me" across steps[0..n) starting from an empty schematic. */
const playThrough = (n: number): Schematic => {
  let s = emptySchematic();
  for (let i = 0; i < n; i++) {
    s = autoPlaceStep(sevenSegmentLesson, sevenSegmentLesson.steps[i]!, s, getComponent);
  }
  return s;
};

describe("seed lesson: 7-Segment LED Display — structure", () => {
  it("is registered in the seed lesson catalog", () => {
    expect(seedLessons).toContain(sevenSegmentLesson);
    expect(sevenSegmentLesson.id).toMatch(/^les_/);
    expect(sevenSegmentLesson.lessonFormat).toBe("0.1.0");
  });

  it("uses the real cmp_7segment_display registry part (#44)", () => {
    const display = sevenSegmentLesson.targetBundle.schematic.instances.find(
      (i) => i.componentId === "cmp_7segment_display",
    );
    expect(display).toBeDefined();
    expect(getComponent("cmp_7segment_display")).toBeDefined();
  });

  it("carries a valid target project + schematic (IR-valid)", () => {
    const { project, schematic } = sevenSegmentLesson.targetBundle;
    expect(validateProject(project).ok).toBe(true);
    expect(validateSchematic(schematic).ok).toBe(true);
  });

  it("has a reasonable step count for a college practical (6–8)", () => {
    expect(sevenSegmentLesson.steps.length).toBeGreaterThanOrEqual(6);
    expect(sevenSegmentLesson.steps.length).toBeLessThanOrEqual(8);
    for (const step of sevenSegmentLesson.steps) {
      expect(step.instruction.length).toBeGreaterThan(0);
    }
  });
});

describe("seed lesson: 7-Segment LED Display — self-consistency (#50)", () => {
  it("passes validateLesson against the registry resolver", () => {
    const result = validateLesson(sevenSegmentLesson, getComponent);
    expect(result).toEqual({ ok: true });
  });
});

describe("seed lesson: 7-Segment LED Display — each step is an exact gate", () => {
  // Criterion: each step's predicate is satisfiable by exactly the intended
  // mutation — non-vacuous (fails on the state BEFORE its mutation) and reached
  // by its own play (passes on the state AFTER). No ambiguous/unsatisfiable steps.
  sevenSegmentLesson.steps.forEach((step, i) => {
    it(`step ${i + 1} "${step.id}" — unsatisfied before, satisfied after its mutation`, () => {
      const before = playThrough(i);
      const after = playThrough(i + 1);
      expect(evaluateStep(step, before, getComponent).passed).toBe(false);
      expect(evaluateStep(step, after, getComponent).passed).toBe(true);
    });
  });
});

describe("seed lesson: 7-Segment LED Display — playable to the target (#153)", () => {
  it("playing every step with 'do it for me' reconstructs the target electrically", () => {
    const played = playThrough(sevenSegmentLesson.steps.length);
    const target = sevenSegmentLesson.targetBundle.schematic;
    expect(instanceSummary(played)).toEqual(instanceSummary(target));
    expect(connectivity(played)).toEqual(connectivity(target));
  });

  it("the fully-played schematic satisfies every step", () => {
    const played = playThrough(sevenSegmentLesson.steps.length);
    for (const step of sevenSegmentLesson.steps) {
      expect(evaluateStep(step, played, getComponent).passed).toBe(true);
    }
  });
});

describe("seed lesson: 7-Segment LED Display — golden simulation (#9)", () => {
  it("target compiles and runs a real transient with every segment lit", async () => {
    const target = sevenSegmentLesson.targetBundle.schematic;
    const compiled = compileNetlist(target, getComponent);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const run = await runSimulation(
      compiled.netlist,
      { mode: "transient", duration: "1m", step: "20u" },
      new EECircuitBackend(),
    );
    expect(run.status).toBe("completed");
    expect(run.results?.format).toBe("waveform-v1");

    const finalV = (netId: string): number => {
      const sig = run.results!.signals.find((s) => s.netId === netId && s.unit === "V");
      expect(sig, `voltage signal for ${netId}`).toBeDefined();
      const samples = decodeSamples(sig!.samples);
      return samples[samples.length - 1]!;
    };

    // The 5 V rail holds.
    expect(finalV("net_vcc")).toBeCloseTo(5, 1);

    // Every segment a–g is forward-biased and conducting: its node sits at the
    // diode drop (well above ground, well below the rail), so real current flows
    // segment → common → ground. That IS the segment being lit.
    for (const seg of SEGMENTS) {
      const v = finalV(`net_seg_${seg}`);
      expect(v, `segment ${seg} node voltage`).toBeGreaterThan(0.4);
      expect(v, `segment ${seg} node voltage`).toBeLessThan(3);
      const current = (5 - v) / 330;
      expect(current, `segment ${seg} drive current`).toBeGreaterThan(0.001);
    }
  }, 60000);
});
