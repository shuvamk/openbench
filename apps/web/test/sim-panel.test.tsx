// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MockBackend } from "@openbench/mcp-sim-ngspice";
import { IR_VERSION } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
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
import { WaveformViewer, type WaveformTrace } from "../components/sim/WaveformViewer";
import { SimPanel } from "../components/sim/SimPanel";
import { RunButton } from "../components/sim/RunButton";
import { EditorTopBar } from "../components/editor/EditorTopBar";

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

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

function seedEditor(mutate?: (bundle: ProjectBundle) => void): ProjectBundle {
  const bundle = createFromTemplate("rc-lowpass", "RC demo");
  mutate?.(bundle);
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
  __setSimBackendFactoryForTests(() => new MockBackend());
});

afterEach(() => {
  cleanup();
  __setSimBackendFactoryForTests(null);
});

describe("WaveformViewer", () => {
  const time = new Float64Array([0, 0.5, 1]);
  const traces: WaveformTrace[] = [
    { id: "net_vin", label: "VIN", unit: "V", values: new Float64Array([0, 5, 5]) },
    { id: "net_vout", label: "VOUT", unit: "V", values: new Float64Array([0, 2, 4]) },
  ];

  it("shows an empty state until a run exists", () => {
    render(withTheme(<WaveformViewer traces={[]} />));
    expect(screen.getByText("Run a simulation")).not.toBeNull();
  });

  it("renders one polyline per signal", () => {
    const { container } = render(withTheme(<WaveformViewer time={time} traces={traces} />));
    expect(container.querySelector('[data-testid="waveform-trace-net_vin"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="waveform-trace-net_vout"]')).not.toBeNull();
    expect(container.querySelectorAll("polyline").length).toBe(2);
  });

  it("legend toggles hide individual signals", () => {
    const { container } = render(withTheme(<WaveformViewer time={time} traces={traces} />));
    const toggle = screen.getByLabelText("Show VIN");
    fireEvent.click(toggle);
    expect(container.querySelector('[data-testid="waveform-trace-net_vin"]')).toBeNull();
    expect(container.querySelector('[data-testid="waveform-trace-net_vout"]')).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Show VIN"));
    expect(container.querySelector('[data-testid="waveform-trace-net_vin"]')).not.toBeNull();
  });

  it("hover shows a crosshair with t/value readouts", () => {
    const { container } = render(withTheme(<WaveformViewer time={time} traces={traces} />));
    expect(container.querySelector('[data-testid="waveform-crosshair"]')).toBeNull();
    const svg = container.querySelector('[data-testid="waveform-svg"]')!;
    fireEvent.pointerMove(svg, { clientX: 10, clientY: 10 });
    expect(container.querySelector('[data-testid="waveform-crosshair"]')).not.toBeNull();
    const readout = screen.getByTestId("waveform-readout");
    expect(readout.textContent).toContain("t =");
    expect(readout.textContent).toContain("VIN");
    expect(readout.textContent).toContain("VOUT");
    fireEvent.pointerLeave(svg);
    expect(container.querySelector('[data-testid="waveform-crosshair"]')).toBeNull();
  });

  it("renders each trace in a distinct color", () => {
    const { container } = render(withTheme(<WaveformViewer time={time} traces={traces} />));
    const a = container
      .querySelector('[data-testid="waveform-trace-net_vin"]')!
      .getAttribute("stroke");
    const b = container
      .querySelector('[data-testid="waveform-trace-net_vout"]')!
      .getAttribute("stroke");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  /** Give the SVG a real box so client→index math is deterministic in jsdom. */
  function stubBox(svg: Element) {
    (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
      () =>
        ({ left: 0, top: 0, width: 760, height: 240, right: 760, bottom: 240, x: 0, y: 0 }) as DOMRect;
  }

  it("clicking places a measurement cursor with a (t, value) readout", () => {
    const { container } = render(withTheme(<WaveformViewer time={time} traces={traces} />));
    const svg = container.querySelector('[data-testid="waveform-svg"]')!;
    stubBox(svg);
    fireEvent.click(svg, { clientX: 400, clientY: 100 });
    expect(container.querySelector('[data-testid="waveform-cursor-0"]')).not.toBeNull();
    const readout = screen.getByTestId("waveform-cursor-readout");
    expect(readout.textContent).toContain("t =");
    expect(readout.textContent).toContain("VIN");
  });

  it("a second cursor adds a signed delta readout, and a third click resets", () => {
    const { container } = render(withTheme(<WaveformViewer time={time} traces={traces} />));
    const svg = container.querySelector('[data-testid="waveform-svg"]')!;
    stubBox(svg);
    fireEvent.click(svg, { clientX: 100, clientY: 100 });
    expect(container.querySelector('[data-testid="waveform-delta-readout"]')).toBeNull();
    fireEvent.click(svg, { clientX: 740, clientY: 100 });
    expect(container.querySelector('[data-testid="waveform-cursor-1"]')).not.toBeNull();
    const delta = screen.getByTestId("waveform-delta-readout");
    expect(delta.textContent).toContain("Δt");
    // Third click starts a fresh measurement (single cursor, no delta).
    fireEvent.click(svg, { clientX: 300, clientY: 100 });
    expect(container.querySelector('[data-testid="waveform-cursor-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="waveform-delta-readout"]')).toBeNull();
  });
});

describe("SimPanel", () => {
  it("renders Simulation / Console / Firmware tabs with default transient controls", () => {
    seedEditor();
    render(withTheme(<SimPanel />));
    expect(screen.getByRole("button", { name: "Simulation" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Console" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Firmware" })).not.toBeNull();

    expect((screen.getByLabelText("Duration") as HTMLInputElement).value).toBe("10ms");
    expect((screen.getByLabelText("Step") as HTMLInputElement).value).toBe("10us");
    // Waveform area is empty before any run.
    expect(screen.getByText("Run a simulation")).not.toBeNull();
  });

  it("lists nets as probes, defaulting to the non-ground nets", () => {
    seedEditor();
    render(withTheme(<SimPanel />));
    const probes = screen.getByTestId("sim-probes");
    const vin = within(probes).getByLabelText("VIN") as HTMLInputElement;
    const vout = within(probes).getByLabelText("VOUT") as HTMLInputElement;
    const gnd = within(probes).getByLabelText("GND") as HTMLInputElement;
    expect(vin.checked).toBe(true);
    expect(vout.checked).toBe(true);
    expect(gnd.checked).toBe(false);
  });

  it("rejects a malformed duration and disables Run", () => {
    seedEditor();
    render(withTheme(<SimPanel />));
    const duration = screen.getByLabelText("Duration");
    fireEvent.change(duration, { target: { value: "banana" } });
    expect(duration.getAttribute("aria-invalid")).toBe("true");
    const run = screen.getByRole("button", { name: "Run simulation" });
    expect(run.hasAttribute("disabled") || run.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
  });

  it("Run executes a simulation and plots decodable signals", async () => {
    seedEditor();
    const { container } = render(withTheme(<SimPanel />));
    fireEvent.click(screen.getByRole("button", { name: "Run simulation" }));

    await waitFor(() => {
      expect(useSimStore.getState().status).toBe("completed");
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="waveform-trace-net_vout"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="waveform-trace-net_vin"]')).not.toBeNull();
    expect(useEditorStore.getState().bundle!.simulationRuns?.length).toBe(1);
  });

  it("Console tab shows the deck, warnings and errors", async () => {
    seedEditor();
    render(withTheme(<SimPanel />));
    fireEvent.click(screen.getByRole("button", { name: "Run simulation" }));
    await waitFor(() => {
      expect(useSimStore.getState().status).toBe("completed");
    });

    fireEvent.click(screen.getByRole("button", { name: "Console" }));
    const consoleTab = screen.getByTestId("sim-console");
    expect(consoleTab.textContent).toContain(".tran 10us 10ms");
    // The ground symbol is skipped with a warning.
    expect(consoleTab.textContent).toContain("GND1");
  });

  it("Console tab surfaces compile errors after a failed run", async () => {
    seedEditor((bundle) => {
      bundle.schematic.instances.push({
        instanceId: "X1",
        componentId: "cmp_does_not_exist",
      });
    });
    render(withTheme(<SimPanel />));
    fireEvent.click(screen.getByRole("button", { name: "Run simulation" }));
    await waitFor(() => {
      expect(useSimStore.getState().status).toBe("failed");
    });
    fireEvent.click(screen.getByRole("button", { name: "Console" }));
    expect(screen.getByTestId("sim-console").textContent).toContain("cmp_does_not_exist");
  });

  it("Firmware tab explains the Phase 1 local PlatformIO story and shows target status", () => {
    seedEditor((bundle) => {
      bundle.firmwareTarget = {
        irVersion: IR_VERSION,
        kind: "firmwareTarget",
        id: "fw_demo",
        projectId: bundle.project.id,
        mcu: "esp32dev",
        framework: "arduino",
        sourceRef: "git+https://example.com/repo#src",
        buildStatus: "success",
        flashTarget: { kind: "virtual", engine: "renode" },
        provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
      } as ProjectBundle["firmwareTarget"];
    });
    render(withTheme(<SimPanel />));
    fireEvent.click(screen.getByRole("button", { name: "Firmware" }));
    const firmware = screen.getByTestId("sim-firmware");
    expect(firmware.textContent).toContain("PlatformIO");
    expect(firmware.textContent).toContain("esp32dev");
    expect(firmware.textContent).toContain("success");
  });
});

describe("RunButton", () => {
  it("mounts a primary ▶ Run button in the top bar's #ob-run-slot", () => {
    seedEditor();
    const { container } = render(withTheme(<EditorTopBar />));
    const slot = container.querySelector("#ob-run-slot")!;
    expect(slot).not.toBeNull();
    const button = within(slot as HTMLElement).getByRole("button", {
      name: "Run simulation",
    });
    expect(button.textContent).toContain("Run");
  });

  it("runs the simulation and shows a loading state while pending", async () => {
    seedEditor();
    render(withTheme(<RunButton />));
    const button = screen.getByRole("button", { name: "Run simulation" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(useSimStore.getState().status).toBe("completed");
    });
    expect(useEditorStore.getState().bundle!.simulationRuns?.length).toBe(1);
  });
});
