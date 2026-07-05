import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { MockBackend, type SimBackend } from "@openbench/mcp-sim-ngspice";
import { createFromTemplate } from "../lib/templates";
import type { ProjectBundle } from "../lib/project-store/types";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { __setSimBackendFactoryForTests } from "../lib/sim/run";
import { resetSimState } from "../lib/sim/store";
import { latestRun, liveWindowSeconds, resetLiveState, useLiveStore } from "../lib/live/store";

/**
 * Issue #72 acceptance — entering Live must never present a dead, frozen view.
 * When the auto-run produces no usable completed run (compile failure, empty
 * window), enterLive stays in Design and surfaces a plain-language reason.
 */

const AT = "2026-07-05T00:00:00Z";

function installBundle(bundle: ProjectBundle): void {
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

/** Valid, grounded playground circuit → a real transient run under the mock. */
function seedValid(): ProjectBundle {
  const bundle = createFromTemplate("playground", "Playground");
  installBundle(bundle);
  return bundle;
}

/**
 * LED + source with no ground and a dangling cathode: the netlist compiler
 * fails on the unconnected pin, so runProjectSimulation returns no run — the
 * exact "beginner forgot ground" case from the issue.
 */
function brokenSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_broken_live",
    projectId: "proj_broken_live",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "D1", componentId: "cmp_led_generic" },
    ],
    nets: [
      {
        netId: "net_a",
        name: "A",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "D1", pinId: "anode" },
        ],
      },
    ],
    provenance: { source: "frontend", at: AT },
  };
}

function seedBroken(): ProjectBundle {
  const bundle: ProjectBundle = {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_broken_live",
      name: "Broken",
      schematicId: "sch_broken_live",
      collaborators: [],
      provenance: { source: "frontend", at: AT },
    },
    schematic: brokenSchematic(),
  };
  installBundle(bundle);
  return bundle;
}

/** A backend that "completes" but returns an empty time base (zero window). */
const emptyWindowBackend: SimBackend = {
  name: "empty-window",
  async run(_deck, probes) {
    const signals: Record<string, Float64Array> = {};
    for (const probe of probes) signals[probe] = new Float64Array(0);
    return { time: new Float64Array(0), signals };
  },
};

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

describe("enterLive failure surfacing (issue #72)", () => {
  it("stays in Design when the schematic fails to compile (no completed run)", async () => {
    seedBroken();

    await useLiveStore.getState().enterLive();

    const live = useLiveStore.getState();
    expect(live.mode).toBe("design");
    expect(live.playing).toBe(false);
    // No completed run was produced.
    expect(latestRun(useEditorStore.getState().bundle)).toBeUndefined();
  });

  it("sets a non-empty, de-jargoned error state on compile failure", async () => {
    seedBroken();

    await useLiveStore.getState().enterLive();

    const message = useLiveStore.getState().enterError ?? "";
    expect(message.trim().length).toBeGreaterThan(0);
    // Plain language — never a raw ERC_ machine code or SPICE deck jargon.
    expect(message).not.toMatch(/ERC_[A-Z_]+/);
  });

  it("still enters Live (playing) for a valid, grounded schematic — no regression", async () => {
    seedValid();

    await useLiveStore.getState().enterLive();

    const live = useLiveStore.getState();
    expect(live.mode).toBe("live");
    expect(live.playing).toBe(true);
    expect(live.enterError).toBeNull();
    expect(liveWindowSeconds(useEditorStore.getState().bundle)).toBeGreaterThan(0);
  });

  it("does not enter Live when a completed run has a zero-length time window", async () => {
    seedValid();
    __setSimBackendFactoryForTests(() => emptyWindowBackend);

    await useLiveStore.getState().enterLive();

    const live = useLiveStore.getState();
    expect(live.mode).toBe("design");
    // The run completed but its window is empty — treat it as "nothing to play".
    expect(liveWindowSeconds(useEditorStore.getState().bundle)).toBe(0);
    expect((live.enterError ?? "").trim().length).toBeGreaterThan(0);
  });

  it("clears any prior enterError once Live starts successfully", async () => {
    seedBroken();
    await useLiveStore.getState().enterLive();
    expect(useLiveStore.getState().enterError).not.toBeNull();

    // Switch to a valid project and enter Live — the stale error must clear.
    resetSimState();
    seedValid();
    await useLiveStore.getState().enterLive();
    expect(useLiveStore.getState().enterError).toBeNull();
    expect(useLiveStore.getState().mode).toBe("live");
  });
});
