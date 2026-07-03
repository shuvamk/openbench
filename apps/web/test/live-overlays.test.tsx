// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { IR_VERSION } from "@openbench/ir-schema";
import { encodeSamples } from "@openbench/mcp-sim-ngspice";
import type { SimulationRun } from "@openbench/ir-schema";
import { createFromTemplate } from "../lib/templates";
import type { ProjectBundle } from "../lib/project-store/types";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { resetLiveState, useLiveStore } from "../lib/live/store";
import { LiveOverlays } from "../components/editor/LiveOverlays";

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

/** Issue #25 acceptance: the LED halo's opacity follows derived brightness. */

const N = 4;
const constant = (value: number) => encodeSamples(new Float64Array(N).fill(value));

function fakeRun(anodeNetId: string, volts: number): SimulationRun {
  return {
    irVersion: IR_VERSION,
    kind: "simulationRun",
    id: "sim_overlay_fixture",
    netlistId: "net_overlay_fixture",
    engine: "ngspice",
    mode: "transient",
    status: "completed",
    results: {
      format: "waveform-v1",
      signals: [
        { netId: "time", unit: "s", samples: encodeSamples(new Float64Array(N).map((_, i) => i * 1e-3)) },
        { netId: anodeNetId, unit: "V", samples: constant(volts) },
      ],
    },
    provenance: { source: "test", at: "2026-07-02T00:00:00Z" },
  };
}

function seedPlaygroundWithRun(volts: number): { ledNetId: string } {
  const bundle: ProjectBundle = createFromTemplate("playground", "Playground");
  // The LED's anode net in the playground template:
  const led = bundle.schematic.instances.find((i) => i.componentId === "cmp_led_generic")!;
  const anodeNet = bundle.schematic.nets.find((net) =>
    net.connections.some((c) => c.instanceId === led.instanceId && c.pinId === "anode"),
  )!;
  bundle.simulationRuns = [fakeRun(anodeNet.netId, volts)];
  const store: ProjectStoreLike = { load: vi.fn(async () => bundle), save: vi.fn(async () => {}) };
  __setProjectStoreModuleLoaderForTests(async () => ({
    getProjectStore: () => store,
    ensureSeeded: async () => {},
  }));
  useEditorStore.setState({ bundle });
  return { ledNetId: anodeNet.netId };
}

beforeEach(() => {
  resetEditorState();
  resetLiveState();
});

afterEach(() => {
  cleanup();
});

describe("LiveOverlays", () => {
  it("LED halo opacity follows brightness at the current liveTime", () => {
    seedPlaygroundWithRun(1.45); // ~full indicator brightness
    useLiveStore.setState({ mode: "live", liveTime: 0 });
    const { container } = render(
      <svg>
        <LiveOverlays />
      </svg>,
    );
    const halos = [...container.querySelectorAll("circle[filter]")];
    expect(halos.length).toBeGreaterThan(0);
    const opacity = Number(halos[0]!.getAttribute("opacity"));
    expect(opacity).toBeGreaterThan(0.5);
  });

  it("a dark LED renders no halo", () => {
    seedPlaygroundWithRun(0);
    useLiveStore.setState({ mode: "live", liveTime: 0 });
    const { container } = render(
      <svg>
        <LiveOverlays />
      </svg>,
    );
    expect(container.querySelectorAll("circle[filter]").length).toBe(0);
  });

  it("interactive parts expose hit surfaces", () => {
    seedPlaygroundWithRun(1.45);
    useLiveStore.setState({ mode: "live", liveTime: 0 });
    const { container } = render(
      <svg>
        <LiveOverlays />
      </svg>,
    );
    const hits = [...container.querySelectorAll("[data-live-hit]")].map((el) =>
      el.getAttribute("data-live-hit"),
    );
    // playground has a pushbutton, a switch, and a pot
    expect(hits.some((id) => id?.startsWith("BTN"))).toBe(true);
    expect(hits.some((id) => id?.startsWith("SW"))).toBe(true);
    expect(hits.some((id) => id?.startsWith("RV") || id?.startsWith("POT"))).toBe(true);
  });
});
