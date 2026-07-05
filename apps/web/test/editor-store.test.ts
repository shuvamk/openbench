import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";

const resistorGeneric = getComponent("cmp_resistor_generic")!;
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";

function rcLowpassSchematic(): Schematic {
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
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_gnd",
        connections: [
          { instanceId: "V1", pinId: "neg" },
          { instanceId: "C1", pinId: "p2" },
          { instanceId: "GND1", pinId: "gnd" },
        ],
      },
    ],
    layout: {
      instances: {
        V1: { x: 100, y: 200 },
        R1: { x: 240, y: 120 },
        C1: { x: 380, y: 200 },
        GND1: { x: 100, y: 320 },
      },
    },
    provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
  };
}

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
    schematic: rcLowpassSchematic(),
  };
}

function makeFakeStore() {
  const bundles = new Map([["proj_rc_lowpass", makeBundle()]]);
  const store: ProjectStoreLike = {
    load: vi.fn(async (projectId: string) =>
      bundles.get(projectId === "demo" ? "proj_rc_lowpass" : projectId),
    ),
    save: vi.fn(async () => {}),
  };
  const ensureSeeded = vi.fn(async () => {});
  __setProjectStoreModuleLoaderForTests(async () => ({
    getProjectStore: () => store,
    ensureSeeded,
  }));
  return { store, ensureSeeded };
}

describe("editor store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetEditorState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no bundle, select tool, empty selection, not dirty", () => {
    const s = useEditorStore.getState();
    expect(s.bundle).toBeNull();
    expect(s.tool).toBe("select");
    expect(s.selection).toEqual([]);
    expect(s.dirty).toBe(false);
  });

  it("loadProject seeds the store, resolves the bundle, and clears dirty", async () => {
    const { store, ensureSeeded } = makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    expect(ensureSeeded).toHaveBeenCalled();
    expect(store.load).toHaveBeenCalledWith("proj_rc_lowpass");
    expect(useEditorStore.getState().bundle?.project.id).toBe("proj_rc_lowpass");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("applySchematic commits an externally-computed schematic, recording history", async () => {
    const { store } = makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    const before = useEditorStore.getState().bundle!.schematic;
    const pastLen = useEditorStore.getState().past.length;

    const next: Schematic = {
      ...before,
      instances: [...before.instances, { instanceId: "R99", componentId: "cmp_resistor_generic" }],
    };
    useEditorStore.getState().applySchematic(next);

    expect(useEditorStore.getState().bundle!.schematic).toBe(next);
    expect(useEditorStore.getState().dirty).toBe(true);
    // The pre-mutation schematic went onto the undo stack.
    expect(useEditorStore.getState().past.length).toBe(pastLen + 1);
    expect(useEditorStore.getState().past.at(-1)).toBe(before);
    // Undo restores it.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().bundle!.schematic).toBe(before);
  });

  it("applySchematic is a no-op on the identical schematic and respects read-only", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    const before = useEditorStore.getState().bundle!.schematic;
    useEditorStore.getState().applySchematic(before);
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useEditorStore.getState().past.length).toBe(0);

    // Read-only bundles ignore the mutation entirely.
    useEditorStore.setState({ readOnly: true });
    const changed: Schematic = { ...before, instances: [] };
    useEditorStore.getState().applySchematic(changed);
    expect(useEditorStore.getState().bundle!.schematic).toBe(before);
  });

  it("loadProject passes the demo alias straight through to the project store", async () => {
    const { store } = makeFakeStore();
    await useEditorStore.getState().loadProject("demo");
    expect(store.load).toHaveBeenCalledWith("demo");
    expect(useEditorStore.getState().bundle?.project.id).toBe("proj_rc_lowpass");
  });

  it("mutations mark dirty and autosave once ~800ms later with the latest bundle", async () => {
    const { store } = makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");

    useEditorStore.getState().place(resistorGeneric, { x: 40, y: 40 });
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(store.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    useEditorStore.getState().move("R1", { x: 300, y: 130 });
    await vi.advanceTimersByTimeAsync(400);
    // debounce restarted -- still nothing saved
    expect(store.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(store.save).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(store.save).mock.calls[0]![0];
    expect(saved.schematic.instances.map((i) => i.instanceId)).toContain("R2");
    expect(saved.schematic.layout?.instances["R1"]).toMatchObject({ x: 300, y: 130 });
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("place selects the new instance and returns to the select tool", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    useEditorStore.getState().setTool("place", "cmp_resistor_generic");
    expect(useEditorStore.getState().tool).toBe("place");
    expect(useEditorStore.getState().placingComponentId).toBe("cmp_resistor_generic");
    useEditorStore.getState().place(resistorGeneric, { x: 0, y: 0 });
    expect(useEditorStore.getState().selection).toEqual(["R2"]);
  });

  it("connect commits a wire and clears the wire draft", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    useEditorStore.getState().startWire({ instanceId: "R1", pinId: "p2" });
    expect(useEditorStore.getState().wireDraft?.from).toEqual({ instanceId: "R1", pinId: "p2" });
    useEditorStore.getState().moveWireCursor({ x: 10, y: 20 });
    expect(useEditorStore.getState().wireDraft?.cursor).toEqual({ x: 10, y: 20 });
    useEditorStore.getState().connect(
      { instanceId: "R1", pinId: "p2" },
      { instanceId: "C1", pinId: "p1" },
    );
    expect(useEditorStore.getState().wireDraft).toBeUndefined();
    const nets = useEditorStore.getState().bundle!.schematic.nets;
    expect(
      nets.some(
        (n) =>
          n.connections.some((c) => c.instanceId === "R1" && c.pinId === "p2") &&
          n.connections.some((c) => c.instanceId === "C1" && c.pinId === "p1"),
      ),
    ).toBe(true);
  });

  it("removeSelection deletes the selected instances and clears selection", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    useEditorStore.getState().setSelection(["C1"]);
    useEditorStore.getState().removeSelection();
    const s = useEditorStore.getState();
    expect(s.selection).toEqual([]);
    expect(s.bundle!.schematic.instances.some((i) => i.instanceId === "C1")).toBe(false);
  });

  it("setParameter writes a parameter override into the IR", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    useEditorStore.getState().setParameter("R1", "resistance", 220);
    const r1 = useEditorStore
      .getState()
      .bundle!.schematic.instances.find((i) => i.instanceId === "R1");
    expect(r1?.parameterOverrides).toEqual({ resistance: 220 });
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("addToSelection toggles shift-selection", async () => {
    makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    useEditorStore.getState().setSelection(["R1"]);
    useEditorStore.getState().addToSelection("C1");
    expect(useEditorStore.getState().selection).toEqual(["R1", "C1"]);
    useEditorStore.getState().addToSelection("C1");
    expect(useEditorStore.getState().selection).toEqual(["R1"]);
  });

  it("renameProject updates the project name and autosaves", async () => {
    const { store } = makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    useEditorStore.getState().renameProject("Filter playground");
    expect(useEditorStore.getState().bundle!.project.name).toBe("Filter playground");
    await vi.advanceTimersByTimeAsync(900);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.save).mock.calls[0]![0].project.name).toBe("Filter playground");
  });

  it("loads the seeded demo project through the REAL project-store module", async () => {
    __setProjectStoreModuleLoaderForTests(async () => import("../lib/project-store"));
    await useEditorStore.getState().loadProject("demo");
    const bundle = useEditorStore.getState().bundle;
    expect(bundle?.project.id).toBe("proj_demo");
    expect(bundle?.schematic.instances.length).toBeGreaterThan(0);
  });

  it("zoom is clamped to 0.25..4", () => {
    resetEditorState();
    useEditorStore.getState().setZoom(10);
    expect(useEditorStore.getState().zoom).toBe(4);
    useEditorStore.getState().setZoom(0.01);
    expect(useEditorStore.getState().zoom).toBe(0.25);
  });
});
