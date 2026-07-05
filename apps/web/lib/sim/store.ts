import { create } from "zustand";
import type { SimulationRun } from "@openbench/ir-schema";
import type { ProjectBundle } from "../project-store";
import { useEditorStore } from "../editor/store";
import {
  DEFAULT_DURATION,
  DEFAULT_STEP,
  runProjectSimulation,
  type ConsoleEntry,
  type FallbackKind,
} from "./run";

export type SimStatus = "idle" | "queued" | "running" | "completed" | "failed";

/**
 * Human-facing phase of a run, surfaced on the Run button while it is in
 * flight (issue #130): idle → compiling → simulating → done | failed.
 */
export type SimPhase = "idle" | "compiling" | "simulating" | "done" | "failed";

export interface SimState {
  status: SimStatus;
  /** Where the current run is in its lifecycle (drives the Run-button text). */
  phase: SimPhase;
  /** Name of the backend that produced the latest run ("eecircuit" | "mock"). */
  backendUsed?: string;
  /** True when the latest run silently fell back to the mock backend. */
  usedMockFallback: boolean;
  /** The primary backend's failure message when the latest run fell back (#143). */
  fallbackReason?: string;
  /** Whether that fallback was an engine problem or a circuit problem (#143). */
  fallbackKind?: FallbackKind;
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
  phase: "idle" as SimPhase,
  backendUsed: undefined as string | undefined,
  usedMockFallback: false,
  fallbackReason: undefined as string | undefined,
  fallbackKind: undefined as FallbackKind | undefined,
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
      phase: "idle",
      backendUsed: undefined,
      usedMockFallback: false,
      fallbackReason: undefined,
      fallbackKind: undefined,
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
      onPhase: (phase) => set({ phase }),
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

    const succeeded = result.run !== undefined && result.run.status === "completed";
    set({
      status: succeeded ? "completed" : "failed",
      phase: succeeded ? "done" : "failed",
      backendUsed: result.backendUsed,
      usedMockFallback: result.usedMockFallback,
      fallbackReason: result.fallbackReason,
      fallbackKind: result.fallbackKind,
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
