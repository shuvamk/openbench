import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, type SimulationRun } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { MockBackend, encodeSamples } from "@openbench/mcp-sim-ngspice";
import { createFromTemplate } from "../lib/templates";
import type { ProjectBundle } from "../lib/project-store";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { __setSimBackendFactoryForTests } from "../lib/sim/run";
import { resetSimState } from "../lib/sim/store";
import { INTERACT_RERUN_DEBOUNCE_MS, resetLiveState, useLiveStore } from "../lib/live/store";
import { knobReadout, resolveInteractiveKnob } from "../lib/live/interactive-knob";

/**
 * Issue #81 — the live "try it" knob. Pure resolution (which instance/param the
 * knob drives) + readout (the derived series it watches) + the store wiring that
 * actually re-runs the sim. The component's DOM behaviour is in live-knob.test.tsx.
 *
 * The canonical demo is the LED: its `interactiveHint` addresses the *series
 * resistor* (`targetComponentId: cmp_resistor_generic`) and watches the LED's own
 * derived series. That asymmetry — knob lives on a neighbour, readout on the
 * subject — is the case that pins the generalization down (spike #77).
 */

const AT = "2026-07-06T00:00:00Z";
const N = 8;

/** A completed transient run whose only meaningful signal is the LED-anode net. */
function ledRun(ledAnodeVolts: number): SimulationRun {
  return {
    irVersion: IR_VERSION,
    kind: "simulationRun",
    id: "sim_knob_fixture",
    netlistId: "net_knob_fixture",
    engine: "ngspice",
    mode: "transient",
    status: "completed",
    results: {
      format: "waveform-v1",
      signals: [
        { netId: "time", unit: "s", samples: encodeSamples(new Float64Array(N).map((_, i) => i * 1e-3)) },
        { netId: "net_led_a", unit: "V", samples: encodeSamples(new Float64Array(N).fill(ledAnodeVolts)) },
      ],
    },
    provenance: { source: "test", at: AT },
  };
}

/** basic-led bundle (V1 → R1(330Ω) → D1 LED → GND) with an attached run. */
function ledBundle(ledAnodeVolts = 1.45): ProjectBundle {
  const bundle = createFromTemplate("basic-led", "LED demo");
  return { ...bundle, simulationRuns: [ledRun(ledAnodeVolts)] };
}

function seedEditorForInteract(bundle: ProjectBundle): void {
  const bundles = new Map([[bundle.project.id, bundle]]);
  const store: ProjectStoreLike = {
    load: vi.fn(async (projectId: string) => bundles.get(projectId)),
    save: vi.fn(async (saved: ProjectBundle) => {
      bundles.set(saved.project.id, saved);
    }),
  };
  __setProjectStoreModuleLoaderForTests(async () => ({
    getProjectStore: () => store,
    ensureSeeded: async () => {},
  }));
  useEditorStore.setState({ bundle });
}

beforeEach(() => {
  resetEditorState();
  resetSimState();
  resetLiveState();
});

afterEach(() => {
  vi.useRealTimers();
  __setSimBackendFactoryForTests(null);
});

describe("resolveInteractiveKnob", () => {
  it("resolves the LED's knob to the series resistor, watching the LED's own series", () => {
    const bundle = ledBundle();
    const knob = resolveInteractiveKnob(bundle, "D1", getComponent);
    expect(knob).not.toBeNull();
    expect(knob!.subjectInstanceId).toBe("D1");
    // knob edits the neighbouring resistor, not the LED (LED has no params)
    expect(knob!.targetInstanceId).toBe("R1");
    expect(knob!.targetParam).toBe("resistance");
    expect(knob!.observe).toBe("brightness");
    // current value comes from R1's override (330), range brackets the R default (1000)
    expect(knob!.value).toBe(330);
    expect(knob!.min).toBeLessThan(330);
    expect(knob!.max).toBeGreaterThan(330);
    expect(knob!.min).toBeLessThan(knob!.max);
  });

  it("resolves the resistor's own knob to itself (targetComponentId omitted)", () => {
    const bundle = ledBundle();
    const knob = resolveInteractiveKnob(bundle, "R1", getComponent);
    expect(knob).not.toBeNull();
    expect(knob!.subjectInstanceId).toBe("R1");
    expect(knob!.targetInstanceId).toBe("R1");
    expect(knob!.targetParam).toBe("resistance");
    expect(knob!.observe).toBe("current");
  });

  it("returns null when the selected component has no interactiveHint", () => {
    const bundle = ledBundle();
    // V1 (voltage source) carries no education block at all.
    expect(resolveInteractiveKnob(bundle, "V1", getComponent)).toBeNull();
  });

  it("returns null when no instance is selected or it does not exist", () => {
    const bundle = ledBundle();
    expect(resolveInteractiveKnob(bundle, undefined, getComponent)).toBeNull();
    expect(resolveInteractiveKnob(bundle, "NOPE", getComponent)).toBeNull();
    expect(resolveInteractiveKnob(null, "D1", getComponent)).toBeNull();
  });
});

describe("knobReadout", () => {
  it("reports the observed series' magnitude for the subject", () => {
    const bundle = ledBundle(1.45);
    const readout = knobReadout(bundle, "D1", "current", getComponent);
    expect(readout).not.toBeNull();
    expect(readout!.observe).toBe("current");
    expect(readout!.value).toBeGreaterThan(0);
  });

  it("larger series resistance yields a smaller LED current (monotonic direction)", () => {
    // Physically, a bigger series R drops more of the 5V supply and settles the
    // LED at a lower forward voltage → less current. These anode voltages are what
    // a solver reports for the repo's Shockley model (Is=1e-14, n=2): 1.45V≈15mA,
    // 1.38V≈4mA — the same "what a real sim would report" style as live-derive.
    const bright = knobReadout(ledBundle(1.45), "D1", "current", getComponent)!;
    const dim = knobReadout(ledBundle(1.38), "D1", "current", getComponent)!;
    expect(dim.value).toBeLessThan(bright.value);
  });

  it("returns null when the circuit produced no run to read (composes with #72)", () => {
    const bundle = createFromTemplate("basic-led", "no run yet");
    expect(bundle.simulationRuns ?? []).toHaveLength(0);
    expect(knobReadout(bundle, "D1", "current", getComponent)).toBeNull();
  });
});

describe("knob → live store wiring", () => {
  it("driving the resolved knob overrides the target param and schedules one rerun", async () => {
    vi.useFakeTimers();
    __setSimBackendFactoryForTests(() => new MockBackend());
    seedEditorForInteract(ledBundle());

    const knob = resolveInteractiveKnob(useEditorStore.getState().bundle, "D1", getComponent)!;

    // Rapid drags inside the debounce window (what a slider emits per tick).
    useLiveStore.getState().interact(knob.targetInstanceId, knob.targetParam, 470);
    useLiveStore.getState().interact(knob.targetInstanceId, knob.targetParam, 680);
    useLiveStore.getState().interact(knob.targetInstanceId, knob.targetParam, 1000);

    const r1 = useEditorStore
      .getState()
      .bundle!.schematic.instances.find((i) => i.instanceId === "R1")!;
    expect(r1.parameterOverrides?.resistance).toBe(1000);
    expect(useLiveStore.getState().simulating).toBe(true);

    const runsBefore = useEditorStore.getState().bundle!.simulationRuns!.length;
    await vi.advanceTimersByTimeAsync(INTERACT_RERUN_DEBOUNCE_MS + 50);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Three drags, exactly one rerun — no thrash.
    const runsAfter = useEditorStore.getState().bundle!.simulationRuns!.length;
    expect(runsAfter).toBe(runsBefore + 1);
    expect(useLiveStore.getState().simulating).toBe(false);
  });
});
