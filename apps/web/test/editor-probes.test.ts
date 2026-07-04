import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, validateSchematic, type Schematic } from "@openbench/ir-schema";
import {
  activeProbeNetIds,
  addProbe,
  removeProbe,
} from "../lib/editor/probes";
import { deleteSelection, moveInstance, placeInstance } from "../lib/editor/mutations";
import { getComponent } from "@openbench/registry";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";

const resistorGeneric = getComponent("cmp_resistor_generic")!;

/** Seeded rc-lowpass-style schematic (nets: net_in, net_out, net_gnd). */
function rcLowpass(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_rc_lowpass",
    projectId: "proj_rc_lowpass",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic" },
      { instanceId: "C1", componentId: "cmp_capacitor_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_in",
        name: "IN",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_out",
        name: "OUT",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "C1", pinId: "p1" },
        ],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "V1", pinId: "neg" },
          { instanceId: "C1", pinId: "p2" },
          { instanceId: "GND1", pinId: "gnd" },
        ],
      },
    ],
    layout: {
      instances: {
        V1: { x: 100, y: 200, rotation: 0 },
        R1: { x: 240, y: 120, rotation: 0 },
        C1: { x: 380, y: 200, rotation: 90 },
        GND1: { x: 100, y: 320, rotation: 0 },
      },
    },
    provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
  };
}

function expectValid(schematic: Schematic): void {
  const result = validateSchematic(schematic);
  expect(result.errors).toEqual([]);
  expect(result.valid).toBe(true);
}

describe("addProbe", () => {
  it("adds a probe on a declared net and lists it as an active signal", () => {
    const next = addProbe(rcLowpass(), "net_out", { x: 200, y: 120 });
    expect(activeProbeNetIds(next)).toContain("net_out");
    expect(next.layout?.probes?.[0]).toMatchObject({ netId: "net_out", probeId: "prb_1" });
    expectValid(next);
  });

  it("snaps the marker to the 10px grid", () => {
    const next = addProbe(rcLowpass(), "net_out", { x: 204, y: 126 });
    expect(next.layout?.probes?.[0]).toMatchObject({ x: 200, y: 130 });
  });

  it("generates sequential probe ids across drops on distinct nets", () => {
    let sch = rcLowpass();
    sch = addProbe(sch, "net_in", { x: 0, y: 0 });
    sch = addProbe(sch, "net_out", { x: 10, y: 10 });
    expect(sch.layout?.probes?.map((p) => p.probeId)).toEqual(["prb_1", "prb_2"]);
    expectValid(sch);
  });

  it("is a no-op when the net is already probed (active signals stay a set)", () => {
    const once = addProbe(rcLowpass(), "net_out", { x: 0, y: 0 });
    const twice = addProbe(once, "net_out", { x: 40, y: 40 });
    expect(twice).toBe(once);
    expect(twice.layout?.probes).toHaveLength(1);
  });

  it("is a no-op for an undeclared net (keeps the schematic valid)", () => {
    const before = rcLowpass();
    const after = addProbe(before, "net_ghost", { x: 0, y: 0 });
    expect(after).toBe(before);
    expect(activeProbeNetIds(after)).toEqual([]);
  });

  it("does not mutate the input schematic", () => {
    const before = rcLowpass();
    const snapshot = JSON.parse(JSON.stringify(before));
    addProbe(before, "net_out", { x: 0, y: 0 });
    expect(before).toEqual(snapshot);
  });

  it("pins a color when provided", () => {
    const next = addProbe(rcLowpass(), "net_out", { x: 0, y: 0 }, "var(--ob-net-highlight)");
    expect(next.layout?.probes?.[0]?.color).toBe("var(--ob-net-highlight)");
  });
});

describe("removeProbe", () => {
  it("removes the trace for that probe", () => {
    const withProbe = addProbe(rcLowpass(), "net_out", { x: 0, y: 0 });
    const probeId = withProbe.layout!.probes![0]!.probeId;
    const removed = removeProbe(withProbe, probeId);
    expect(activeProbeNetIds(removed)).not.toContain("net_out");
    expect(removed.layout?.probes).toEqual([]);
    expectValid(removed);
  });

  it("is a no-op for an unknown probe id", () => {
    const withProbe = addProbe(rcLowpass(), "net_out", { x: 0, y: 0 });
    expect(removeProbe(withProbe, "prb_999")).toBe(withProbe);
  });
});

describe("probes survive instance mutations", () => {
  it("placeInstance keeps existing probes", () => {
    const withProbe = addProbe(rcLowpass(), "net_out", { x: 0, y: 0 });
    const { schematic } = placeInstance(withProbe, resistorGeneric, { x: 500, y: 500 });
    expect(activeProbeNetIds(schematic)).toContain("net_out");
  });

  it("moveInstance keeps existing probes", () => {
    const withProbe = addProbe(rcLowpass(), "net_out", { x: 0, y: 0 });
    const moved = moveInstance(withProbe, "R1", { x: 300, y: 130 });
    expect(activeProbeNetIds(moved)).toContain("net_out");
  });

  it("deleteSelection prunes probes whose net disappears but keeps the rest", () => {
    // Probe net_in (survives) and net_gnd; deleting GND1 alone keeps net_gnd
    // (still has V1/C1), so both probes survive. Deleting the components that
    // empty a net drops that net's probe.
    let sch = addProbe(rcLowpass(), "net_in", { x: 0, y: 0 });
    sch = addProbe(sch, "net_out", { x: 10, y: 10 });
    // Remove R1 and C1 -> net_out loses all connections and is dropped.
    const pruned = deleteSelection(sch, ["R1", "C1"]);
    expect(pruned.nets.some((n) => n.netId === "net_out")).toBe(false);
    expect(activeProbeNetIds(pruned)).toContain("net_in");
    expect(activeProbeNetIds(pruned)).not.toContain("net_out");
    expectValid(pruned);
  });
});

describe("editor store probe actions", () => {
  function makeBundle() {
    return {
      project: {
        irVersion: IR_VERSION,
        kind: "project" as const,
        id: "proj_rc_lowpass",
        name: "RC low-pass demo",
        schematicId: "sch_rc_lowpass",
        collaborators: [],
        provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
      },
      schematic: rcLowpass(),
    };
  }

  function makeFakeStore() {
    const bundles = new Map([["proj_rc_lowpass", makeBundle()]]);
    const store: ProjectStoreLike = {
      load: vi.fn(async (projectId: string) => bundles.get(projectId)),
      save: vi.fn(async () => {}),
    };
    __setProjectStoreModuleLoaderForTests(async () => ({
      getProjectStore: () => store,
      ensureSeeded: vi.fn(async () => {}),
    }));
    return { store };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetEditorState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("addProbe/removeProbe mutate the bundle, mark dirty, and are undoable", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");

    useEditorStore.getState().addProbe("net_out", { x: 200, y: 120 });
    expect(useEditorStore.getState().dirty).toBe(true);
    let probes = useEditorStore.getState().bundle!.schematic.layout?.probes ?? [];
    expect(probes.map((p) => p.netId)).toEqual(["net_out"]);

    const probeId = probes[0]!.probeId;
    useEditorStore.getState().removeProbe(probeId);
    expect(useEditorStore.getState().bundle!.schematic.layout?.probes ?? []).toEqual([]);

    // Undo the removal, then the placement.
    useEditorStore.getState().undo();
    expect(
      (useEditorStore.getState().bundle!.schematic.layout?.probes ?? []).map((p) => p.netId),
    ).toEqual(["net_out"]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().bundle!.schematic.layout?.probes ?? []).toEqual([]);
  });
});
