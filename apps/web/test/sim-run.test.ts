import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockBackend, decodeSamples } from "@openbench/mcp-sim-ngspice";
import { validateSimulationRun } from "@openbench/ir-schema";
import { createFromTemplate } from "../lib/templates";
import type { ProjectBundle } from "../lib/project-store/types";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import {
  DEFAULT_DURATION,
  DEFAULT_STEP,
  __setSimBackendFactoryForTests,
  createFallbackBackend,
  runProjectSimulation,
  type ConsoleEntry,
} from "../lib/sim/run";
import { resetSimState, useSimStore, type SimStatus } from "../lib/sim/store";

function makeFakeStore(bundle: ProjectBundle) {
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
  return store;
}

describe("runProjectSimulation", () => {
  it("compiles the rc-lowpass template and completes a transient run on the mock backend", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    const result = await runProjectSimulation(bundle, { backend: new MockBackend() });

    expect(result.run).toBeDefined();
    const run = result.run!;
    expect(run.status).toBe("completed");
    expect(run.mode).toBe("transient");
    expect(run.config).toMatchObject({ duration: DEFAULT_DURATION, step: DEFAULT_STEP });
    expect(validateSimulationRun(run).valid).toBe(true);

    // Deck reflects the default transient config and the compiled cards.
    expect(result.deck).toContain(`.tran ${DEFAULT_STEP} ${DEFAULT_DURATION}`);
    expect(result.deck).toContain("R1");

    // The ground symbol has no simModel — surfaces as a warning, not an error.
    expect(result.warnings.some((w) => w.includes("GND1"))).toBe(true);
    expect(result.consoleEntries.some((e) => e.level === "error")).toBe(false);

    // Signals decode back into Float64Arrays, including the time base.
    const signals = run.results!.signals;
    const netIds = signals.map((s) => s.netId);
    expect(netIds).toContain("time");
    expect(netIds).toContain("net_vin");
    expect(netIds).toContain("net_vout");
    for (const signal of signals) {
      const samples = decodeSamples(signal.samples);
      expect(samples.length).toBeGreaterThan(0);
    }
  });

  it("honours explicit duration/step/probes", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    const result = await runProjectSimulation(bundle, {
      backend: new MockBackend(),
      duration: "5ms",
      step: "1us",
      probes: ["net_vout"],
    });
    expect(result.run?.status).toBe("completed");
    expect(result.deck).toContain(".tran 1us 5ms");
    const netIds = result.run!.results!.signals.map((s) => s.netId);
    expect(netIds).toContain("net_vout");
    expect(netIds).not.toContain("net_vin");
  });

  it("returns compile errors as console entries without throwing", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    bundle.schematic.instances.push({
      instanceId: "X1",
      componentId: "cmp_does_not_exist",
    });
    const result = await runProjectSimulation(bundle, { backend: new MockBackend() });
    expect(result.run).toBeUndefined();
    const errors = result.consoleEntries.filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.text.includes("cmp_does_not_exist"))).toBe(true);
  });

  it("returns invalid transient config as console entries without throwing", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    const result = await runProjectSimulation(bundle, {
      backend: new MockBackend(),
      duration: "banana",
    });
    expect(result.run).toBeUndefined();
    expect(result.consoleEntries.some((e) => e.level === "error" && e.text.includes("banana"))).toBe(
      true,
    );
  });
});

describe("createFallbackBackend", () => {
  it("falls back to the secondary backend on failure and logs a console entry", async () => {
    const entries: ConsoleEntry[] = [];
    const backend = createFallbackBackend(
      new MockBackend({ fail: "wasm exploded" }),
      new MockBackend(),
      (entry) => entries.push(entry),
    );
    const { time, signals } = await backend.run("* t\nR1 1 0 1k\n.tran 10us 10ms\n.end\n", [
      "v(1)",
    ]);
    expect(time.length).toBeGreaterThan(0);
    expect(signals["v(1)"]).toBeDefined();
    expect(
      entries.some((e) => e.level === "warn" && /falling back/i.test(e.text) && /mock/i.test(e.text)),
    ).toBe(true);
  });

  it("does not log or fall back when the primary succeeds", async () => {
    const entries: ConsoleEntry[] = [];
    const backend = createFallbackBackend(new MockBackend(), new MockBackend(), (entry) =>
      entries.push(entry),
    );
    await backend.run("* t\nR1 1 0 1k\n.tran 10us 10ms\n.end\n", ["v(1)"]);
    expect(entries).toEqual([]);
  });
});

describe("sim store orchestration", () => {
  beforeEach(() => {
    resetEditorState();
    resetSimState();
    __setSimBackendFactoryForTests(() => new MockBackend());
  });

  afterEach(() => {
    __setSimBackendFactoryForTests(null);
  });

  it("transitions queued → running → completed and persists the run latest-first", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    const store = makeFakeStore(bundle);
    await useEditorStore.getState().loadProject(bundle.project.id);

    const statuses: SimStatus[] = [];
    const unsubscribe = useSimStore.subscribe((state, previous) => {
      if (state.status !== previous.status) statuses.push(state.status);
    });

    await useSimStore.getState().runSimulation();
    unsubscribe();

    expect(statuses).toEqual(["queued", "running", "completed"]);

    const simState = useSimStore.getState();
    expect(simState.run?.status).toBe("completed");
    expect(simState.deck).toContain(".tran");

    // Run is stored in the editor bundle, latest first, and linked from the project.
    const editorBundle = useEditorStore.getState().bundle!;
    expect(editorBundle.simulationRuns?.[0]?.id).toBe(simState.run!.id);
    expect(editorBundle.project.latestSimulationRunId).toBe(simState.run!.id);

    // Persisted through the project store.
    expect(store.save).toHaveBeenCalled();
    const savedCalls = vi.mocked(store.save).mock.calls;
    const lastSaved = savedCalls[savedCalls.length - 1]![0];
    expect(lastSaved.simulationRuns?.[0]?.id).toBe(simState.run!.id);

    // Signals decode.
    for (const signal of simState.run!.results!.signals) {
      expect(decodeSamples(signal.samples).length).toBeGreaterThan(0);
    }
  });

  it("stacks a second run in front of the first", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    makeFakeStore(bundle);
    await useEditorStore.getState().loadProject(bundle.project.id);

    await useSimStore.getState().runSimulation();
    const firstId = useSimStore.getState().run!.id;
    await useSimStore.getState().runSimulation();
    const secondId = useSimStore.getState().run!.id;

    const runs = useEditorStore.getState().bundle!.simulationRuns!;
    expect(runs.map((r) => r.id)).toEqual([secondId, firstId]);
  });

  it("compile errors surface as console entries and a failed status, storing no run", async () => {
    const bundle = createFromTemplate("rc-lowpass", "RC");
    bundle.schematic.instances.push({
      instanceId: "X1",
      componentId: "cmp_does_not_exist",
    });
    makeFakeStore(bundle);
    await useEditorStore.getState().loadProject(bundle.project.id);

    await useSimStore.getState().runSimulation();

    const simState = useSimStore.getState();
    expect(simState.status).toBe("failed");
    expect(simState.run).toBeUndefined();
    expect(simState.consoleEntries.some((e) => e.level === "error")).toBe(true);
    expect(useEditorStore.getState().bundle!.simulationRuns ?? []).toEqual([]);
  });

  it("is a no-op without a loaded project", async () => {
    await useSimStore.getState().runSimulation();
    expect(useSimStore.getState().status).toBe("idle");
  });
});
