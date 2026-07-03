import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockBackend } from "@openbench/mcp-sim-ngspice";
import { createFromTemplate } from "../lib/templates";
import type { ProjectBundle } from "../lib/project-store/types";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { __setSimBackendFactoryForTests } from "../lib/sim/run";
import { resetSimState, useSimStore } from "../lib/sim/store";
import {
  INTERACT_RERUN_DEBOUNCE_MS,
  liveWindowSeconds,
  resetLiveState,
  useLiveStore,
} from "../lib/live/store";

/** Issue #25 acceptance — live-mode store semantics (no DOM). */

function seedEditor(): ProjectBundle {
  const bundle = createFromTemplate("playground", "Playground");
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
  return bundle;
}

beforeEach(() => {
  resetEditorState();
  resetSimState();
  resetLiveState();
  __setSimBackendFactoryForTests(() => new MockBackend());
});

afterEach(() => {
  vi.useRealTimers();
  __setSimBackendFactoryForTests(null);
});

describe("live store", () => {
  it("enterLive runs a simulation when none exists, then exposes the window", async () => {
    seedEditor();
    expect(useEditorStore.getState().bundle?.simulationRuns?.length ?? 0).toBe(0);

    await useLiveStore.getState().enterLive();

    const live = useLiveStore.getState();
    expect(live.mode).toBe("live");
    expect(live.playing).toBe(true);
    const bundle = useEditorStore.getState().bundle!;
    expect(bundle.simulationRuns!.length).toBe(1);
    expect(liveWindowSeconds(bundle)).toBeGreaterThan(0);
  });

  it("exitLive returns to design and stops playback", async () => {
    seedEditor();
    await useLiveStore.getState().enterLive();
    useLiveStore.getState().exitLive();
    expect(useLiveStore.getState().mode).toBe("design");
    expect(useLiveStore.getState().playing).toBe(false);
  });

  it("setLiveTime clamps into the simulation window and never reruns", async () => {
    seedEditor();
    await useLiveStore.getState().enterLive();
    const runsBefore = useEditorStore.getState().bundle!.simulationRuns!.length;
    const window = liveWindowSeconds(useEditorStore.getState().bundle!);

    useLiveStore.getState().setLiveTime(window * 2);
    expect(useLiveStore.getState().liveTime).toBeCloseTo(window, 9);
    useLiveStore.getState().setLiveTime(-1);
    expect(useLiveStore.getState().liveTime).toBe(0);

    expect(useEditorStore.getState().bundle!.simulationRuns!.length).toBe(runsBefore);
  });

  it("interact sets the override and schedules exactly one debounced rerun", async () => {
    vi.useFakeTimers();
    seedEditor();
    await useLiveStore.getState().enterLive();
    const runsBefore = useEditorStore.getState().bundle!.simulationRuns!.length;

    // momentary press + release inside the debounce window
    useLiveStore.getState().interact("BTN1", "pressed", 1);
    const pressed = useEditorStore
      .getState()
      .bundle!.schematic.instances.find((i) => i.instanceId === "BTN1")!.parameterOverrides;
    expect(pressed?.pressed).toBe(1);
    expect(useLiveStore.getState().simulating).toBe(true);

    useLiveStore.getState().interact("BTN1", "pressed", 0);
    await vi.advanceTimersByTimeAsync(INTERACT_RERUN_DEBOUNCE_MS + 50);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    // allow the (real) async run kicked off by the debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const runsAfter = useEditorStore.getState().bundle!.simulationRuns!.length;
    expect(runsAfter).toBe(runsBefore + 1);
    expect(useLiveStore.getState().simulating).toBe(false);
    // previous waveforms stayed available throughout (bundle keeps history)
    expect(runsAfter).toBeGreaterThan(0);
  });

  it("playback speed and loop toggles update state", () => {
    useLiveStore.getState().setPlaybackSpeed(4);
    expect(useLiveStore.getState().playbackSpeed).toBe(4);
    const loop = useLiveStore.getState().loop;
    useLiveStore.getState().toggleLoop();
    expect(useLiveStore.getState().loop).toBe(!loop);
  });
});
