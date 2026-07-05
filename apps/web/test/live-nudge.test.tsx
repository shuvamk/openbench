// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getComponent } from "@openbench/registry";
import { MockBackend } from "@openbench/mcp-sim-ngspice";
import type { SimulationRun } from "@openbench/ir-schema";
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
import { resetLiveState, useLiveStore } from "../lib/live/store";
import { hasLiveVisual } from "../lib/live/derive";
import { LiveNudge } from "../components/editor/LiveNudge";

/**
 * Issue #73 acceptance — after a successful Design-mode Run, nudge the beginner
 * toward Live so the "watch it glow" payoff is discoverable, but only when the
 * schematic actually contains something live-visualizable.
 */

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

function seedEditor(kind: "playground" | "rc-lowpass"): ProjectBundle {
  const bundle = createFromTemplate(kind, kind);
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

/** A completed run, as the sim store would surface after a successful ▶ Run. */
function completedRun(): SimulationRun {
  const runs = useEditorStore.getState().bundle?.simulationRuns ?? [];
  return (
    runs.find((r) => r.status === "completed") ??
    ({ status: "completed", id: "sim_nudge_fixture" } as SimulationRun)
  );
}

beforeEach(() => {
  resetEditorState();
  resetSimState();
  resetLiveState();
  __setSimBackendFactoryForTests(() => new MockBackend());
});

afterEach(() => {
  cleanup();
  __setSimBackendFactoryForTests(null);
});

describe("hasLiveVisual", () => {
  it("is true for a schematic containing an LED", () => {
    const bundle = createFromTemplate("esp32-blink", "blink");
    expect(hasLiveVisual(bundle.schematic, getComponent)).toBe(true);
  });

  it("is false for an RC low-pass (R/C/V/GND only)", () => {
    const bundle = createFromTemplate("rc-lowpass", "rc");
    expect(hasLiveVisual(bundle.schematic, getComponent)).toBe(false);
  });
});

describe("LiveNudge", () => {
  it("renders the affordance after a successful run when a live visual is present", async () => {
    await act(async () => {
      seedEditor("playground");
    });
    render(<LiveNudge />);
    // No nudge before a run completes.
    expect(screen.queryByTestId("ob-live-nudge")).toBeNull();

    // Simulate the sim store reaching a completed run in Design mode.
    await act(async () => {
      useSimStore.setState({ status: "completed", run: completedRun() });
    });

    expect(screen.getByTestId("ob-live-nudge")).toBeTruthy();
  });

  it("does not render for an RC-only schematic after a successful run", async () => {
    await act(async () => {
      seedEditor("rc-lowpass");
    });
    render(<LiveNudge />);

    await act(async () => {
      useSimStore.setState({ status: "completed", run: completedRun() });
    });

    expect(screen.queryByTestId("ob-live-nudge")).toBeNull();
  });

  it("entering Live clears the nudge state", async () => {
    await act(async () => {
      seedEditor("playground");
    });
    act(() => {
      useLiveStore.getState().showNudge();
    });
    expect(useLiveStore.getState().nudge).toBe(true);

    await act(async () => {
      await useLiveStore.getState().enterLive();
    });

    expect(useLiveStore.getState().mode).toBe("live");
    expect(useLiveStore.getState().nudge).toBe(false);
  });

  it("dismiss hides the affordance without entering Live", async () => {
    await act(async () => {
      seedEditor("playground");
    });
    render(<LiveNudge />);
    await act(async () => {
      useSimStore.setState({ status: "completed", run: completedRun() });
    });
    expect(screen.getByTestId("ob-live-nudge")).toBeTruthy();

    act(() => {
      useLiveStore.getState().dismissNudge();
    });
    expect(screen.queryByTestId("ob-live-nudge")).toBeNull();
    expect(useLiveStore.getState().mode).toBe("design");
  });
});
