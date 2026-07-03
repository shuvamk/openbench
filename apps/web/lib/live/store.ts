import { create } from "zustand";
import type { SimulationRun } from "@openbench/ir-schema";
import { decodeSamples } from "@openbench/mcp-sim-ngspice";
import type { ProjectBundle } from "../project-store";
import { useEditorStore } from "../editor/store";
import { useSimStore } from "../sim/store";

/**
 * Live mode (issue #25): playback + interaction state on top of the editor
 * and sim stores. Interactions mutate IR parameter overrides and re-run the
 * simulation debounced; the previous run stays in the bundle (newest first)
 * so waveforms/overlays never blank out while a re-run is in flight.
 */

export type EditorMode = "design" | "live";

export const INTERACT_RERUN_DEBOUNCE_MS = 300;
export const PLAYBACK_SPEEDS = [0.25, 1, 4] as const;

/** Latest completed run in the bundle (the sim store prepends). */
export function latestRun(bundle: ProjectBundle | null): SimulationRun | undefined {
  return bundle?.simulationRuns?.find((run) => run.status === "completed");
}

/** Length of the live playback window in seconds (last time sample). */
export function liveWindowSeconds(bundle: ProjectBundle | null): number {
  const run = latestRun(bundle);
  const timeSignal = run?.results?.signals.find((signal) => signal.netId === "time");
  if (!timeSignal) return 0;
  try {
    const time = decodeSamples(timeSignal.samples);
    return time.length > 0 ? time[time.length - 1]! : 0;
  } catch {
    return 0;
  }
}

export interface LiveState {
  mode: EditorMode;
  liveTime: number;
  playing: boolean;
  playbackSpeed: number;
  loop: boolean;
  /** A live-triggered re-run is in flight (subtle shimmer in the UI). */
  simulating: boolean;
  /** Pot/LDR instance whose value slider popover is open. */
  sliderFor: string | null;

  setSliderFor(instanceId: string | null): void;
  enterLive(): Promise<void>;
  exitLive(): void;
  setLiveTime(time: number): void;
  setPlaying(playing: boolean): void;
  setPlaybackSpeed(speed: number): void;
  toggleLoop(): void;
  /** Interactive part changed (button/switch/pot/LDR). */
  interact(instanceId: string, parameterName: string, value: number): void;
}

const initialState = {
  mode: "design" as EditorMode,
  liveTime: 0,
  playing: false,
  playbackSpeed: 1,
  loop: true,
  simulating: false,
  sliderFor: null as string | null,
};

let rerunTimer: ReturnType<typeof setTimeout> | null = null;

function clearRerunTimer(): void {
  if (rerunTimer !== null) {
    clearTimeout(rerunTimer);
    rerunTimer = null;
  }
}

export const useLiveStore = create<LiveState>((set, get) => {
  async function rerunNow(): Promise<void> {
    // The sim store prepends successful runs to the bundle, so the previous
    // run keeps driving overlays until the new one lands.
    await useSimStore.getState().runSimulation();
    set({ simulating: false });
  }

  function scheduleRerun(): void {
    set({ simulating: true });
    clearRerunTimer();
    rerunTimer = setTimeout(() => {
      rerunTimer = null;
      void rerunNow();
    }, INTERACT_RERUN_DEBOUNCE_MS);
  }

  return {
    ...initialState,

    setSliderFor(instanceId) {
      set({ sliderFor: instanceId });
    },

    async enterLive() {
      const editor = useEditorStore.getState();
      if (!editor.bundle) return;
      if (!latestRun(editor.bundle)) {
        set({ simulating: true });
        await useSimStore.getState().runSimulation();
        set({ simulating: false });
      }
      // Live mode is a viewer/actuator: no half-drawn wires or armed tools.
      editor.cancelWire();
      useEditorStore.getState().setTool("select");
      set({ mode: "live", liveTime: 0, playing: true });
    },

    exitLive() {
      clearRerunTimer();
      set({ mode: "design", playing: false, simulating: false, sliderFor: null });
    },

    setLiveTime(time) {
      const window = liveWindowSeconds(useEditorStore.getState().bundle);
      const clamped = Math.min(Math.max(time, 0), window > 0 ? window : 0);
      set({ liveTime: clamped });
    },

    setPlaying(playing) {
      set({ playing });
    },

    setPlaybackSpeed(speed) {
      set({ playbackSpeed: speed });
    },

    toggleLoop() {
      set({ loop: !get().loop });
    },

    interact(instanceId, parameterName, value) {
      useEditorStore.getState().setParameter(instanceId, parameterName, value);
      scheduleRerun();
    },
  };
});

/** Reset the singleton between tests / project switches. */
export function resetLiveState(): void {
  clearRerunTimer();
  useLiveStore.setState({ ...initialState });
}
