import { create } from "zustand";
import type { SimulationRun } from "@openbench/ir-schema";
import type { ProjectBundle } from "../project-store";
import { useEditorStore } from "../editor/store";
import {
  DEFAULT_DURATION,
  DEFAULT_STEP,
  runProjectSimulation,
  type ConsoleEntry,
} from "./run";

export type SimStatus = "idle" | "queued" | "running" | "completed" | "failed";

export interface SimState {
  status: SimStatus;
  duration: string;
  step: string;
  /** Probed netIds; null = adapter default (every non-ground net). */
  probes: string[] | null;
  /** Legend visibility toggles (netIds hidden from the plot). */
  hiddenTraceIds: string[];
  consoleEntries: ConsoleEntry[];
  warnings: string[];
  deck?: string;
  /** The latest run of this session (also persisted into the bundle). */
  run?: SimulationRun;

  setDuration(duration: string): void;
  setStep(step: string): void;
  setProbes(netIds: string[] | null): void;
  toggleTrace(netId: string): void;
  runSimulation(): Promise<void>;
}

const initialState = {
  status: "idle" as SimStatus,
  duration: DEFAULT_DURATION,
  step: DEFAULT_STEP,
  probes: null as string[] | null,
  hiddenTraceIds: [] as string[],
  consoleEntries: [] as ConsoleEntry[],
  warnings: [] as string[],
  deck: undefined as string | undefined,
  run: undefined as SimulationRun | undefined,
};

export const useSimStore = create<SimState>((set, get) => ({
  ...initialState,

  setDuration(duration) {
    set({ duration });
  },

  setStep(step) {
    set({ step });
  },

  setProbes(netIds) {
    set({ probes: netIds });
  },

  toggleTrace(netId) {
    const hidden = get().hiddenTraceIds;
    set({
      hiddenTraceIds: hidden.includes(netId)
        ? hidden.filter((id) => id !== netId)
        : [...hidden, netId],
    });
  },

  async runSimulation() {
    const { status, duration, step, probes } = get();
    if (status === "queued" || status === "running") return;

    const bundle = useEditorStore.getState().bundle;
    if (!bundle) return;

    set({
      status: "queued",
      consoleEntries: [],
      warnings: [],
      deck: undefined,
      run: undefined,
    });
    // Yield once so subscribers observe queued before running (and the run
    // itself stays off the click handler's synchronous path).
    await Promise.resolve();
    set({ status: "running" });

    const result = await runProjectSimulation(bundle, {
      duration,
      step,
      probes: probes ?? undefined,
    });

    if (result.run !== undefined) {
      // Store the run in the IR bundle (latest first) and persist.
      const current = useEditorStore.getState().bundle;
      if (current !== null && current.project.id === bundle.project.id) {
        const nextBundle: ProjectBundle = {
          ...current,
          project: { ...current.project, latestSimulationRunId: result.run.id },
          simulationRuns: [result.run, ...(current.simulationRuns ?? [])],
        };
        useEditorStore.setState({ bundle: nextBundle, dirty: true });
        await useEditorStore.getState().flushSave();
      }
    }

    set({
      status:
        result.run !== undefined && result.run.status === "completed" ? "completed" : "failed",
      run: result.run,
      deck: result.deck,
      warnings: result.warnings,
      consoleEntries: result.consoleEntries,
    });
  },
}));

/** Reset the singleton store between tests / project switches. */
export function resetSimState(): void {
  useSimStore.setState({ ...initialState });
}
