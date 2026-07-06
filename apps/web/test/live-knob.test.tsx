// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type SimulationRun } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { MockBackend, encodeSamples } from "@openbench/mcp-sim-ngspice";
import { createFromTemplate } from "../lib/templates";
import type { ProjectBundle } from "../lib/project-store";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { resetLearnPrefs, useLearnPrefs } from "../lib/editor/learn-prefs";
import { __setSimBackendFactoryForTests } from "../lib/sim/run";
import { resetSimState } from "../lib/sim/store";
import { resetLiveState, useLiveStore } from "../lib/live/store";
import { LiveKnob } from "../components/editor/LiveKnob";

/**
 * Issue #81 — the live "try it" knob rendered in the Inspector's Learn area.
 * Self-gating like {@link LearnPanel}/{@link ErcPanel}: it shows only when the
 * selected part has an `interactiveHint` AND the circuit actually simulated.
 */

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const AT = "2026-07-06T00:00:00Z";
const N = 8;

function ledRun(ledAnodeVolts: number): SimulationRun {
  return {
    irVersion: IR_VERSION,
    kind: "simulationRun",
    id: "sim_knob_dom",
    netlistId: "net_knob_dom",
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

function seed(bundle: ProjectBundle, selection: string[]): void {
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
  useEditorStore.setState({ bundle, selection });
}

function ledBundle(withRun = true): ProjectBundle {
  const bundle = createFromTemplate("basic-led", "LED demo");
  return withRun ? { ...bundle, simulationRuns: [ledRun(1.45)] } : bundle;
}

function renderKnob() {
  return render(
    <Theme theme={neutralTheme}>
      <LiveKnob />
    </Theme>,
  );
}

beforeEach(() => {
  resetEditorState();
  resetSimState();
  resetLiveState();
  resetLearnPrefs();
  __setSimBackendFactoryForTests(() => new MockBackend());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __setSimBackendFactoryForTests(null);
});

describe("LiveKnob", () => {
  it("renders a slider + prompt for a simulatable part with an interactiveHint", () => {
    seed(ledBundle(), ["D1"]);
    renderKnob();
    expect(screen.getByTestId("live-knob")).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();
    // the authored prompt frames the experiment
    expect(screen.getByTestId("live-knob").textContent).toMatch(/resistor/i);
  });

  it("is absent when the selected part has no interactiveHint", () => {
    seed(ledBundle(), ["V1"]);
    renderKnob();
    expect(screen.queryByTestId("live-knob")).toBeNull();
  });

  it("is absent when the circuit can't simulate (no run to read)", () => {
    seed(ledBundle(false), ["D1"]);
    renderKnob();
    expect(screen.queryByTestId("live-knob")).toBeNull();
  });

  it("is absent when the user has opted out of Learn tips", () => {
    seed(ledBundle(), ["D1"]);
    act(() => useLearnPrefs.getState().setEnabled(false));
    renderKnob();
    expect(screen.queryByTestId("live-knob")).toBeNull();
  });

  it("dragging the slider overrides the series resistor and schedules a rerun", () => {
    seed(ledBundle(), ["D1"]);
    renderKnob();
    const slider = screen.getByRole("slider");
    act(() => {
      slider.focus();
    });
    // one keyboard step is a "drag tick" — it must write an override + schedule a run
    fireEvent.keyDown(slider, { key: "ArrowRight" });

    const r1 = useEditorStore
      .getState()
      .bundle!.schematic.instances.find((i) => i.instanceId === "R1")!;
    expect(typeof r1.parameterOverrides?.resistance).toBe("number");
    expect(useLiveStore.getState().simulating).toBe(true);
  });
});
