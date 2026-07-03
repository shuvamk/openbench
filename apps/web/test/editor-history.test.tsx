// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import {
  __setProjectStoreModuleLoaderForTests,
  HISTORY_LIMIT,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { EditorTopBar } from "../components/editor/EditorTopBar";

const resistorGeneric = getComponent("cmp_resistor_generic")!;

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
    load: vi.fn(async (projectId: string) => bundles.get(projectId)),
    save: vi.fn(async () => {}),
  };
  const ensureSeeded = vi.fn(async () => {});
  __setProjectStoreModuleLoaderForTests(async () => ({
    getProjectStore: () => store,
    ensureSeeded,
  }));
  return { store, ensureSeeded };
}

function seedStore() {
  resetEditorState();
  useEditorStore.setState({ bundle: makeBundle() });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

/** Astryx buttons with a tooltip render disabled state as aria-disabled. */
function isDisabledButton(el: HTMLElement): boolean {
  return el.matches('[disabled], [aria-disabled="true"]');
}

describe("editor history (store)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetEditorState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty past/future and undo/redo are no-ops", () => {
    seedStore();
    const before = useEditorStore.getState().bundle!.schematic;
    expect(useEditorStore.getState().past).toEqual([]);
    expect(useEditorStore.getState().future).toEqual([]);
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().bundle!.schematic).toBe(before);
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("every committed mutation pushes the prior schematic onto past and clears future", () => {
    seedStore();
    const original = useEditorStore.getState().bundle!.schematic;

    useEditorStore.getState().move("R1", { x: 300, y: 130 });
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(useEditorStore.getState().past[0]).toBe(original);

    useEditorStore.getState().setSelection(["R1"]);
    useEditorStore.getState().rotateSelection();
    expect(useEditorStore.getState().past).toHaveLength(2);

    useEditorStore.getState().setParameter("R1", "resistance", 220);
    expect(useEditorStore.getState().past).toHaveLength(3);

    useEditorStore.getState().place(resistorGeneric, { x: 40, y: 40 });
    expect(useEditorStore.getState().past).toHaveLength(4);

    useEditorStore.getState().connect(
      { instanceId: "R1", pinId: "p2" },
      { instanceId: "C1", pinId: "p1" },
    );
    expect(useEditorStore.getState().past).toHaveLength(5);

    useEditorStore.getState().setSelection(["C1"]);
    useEditorStore.getState().removeSelection();
    expect(useEditorStore.getState().past).toHaveLength(6);

    // Undo once, then a fresh mutation clears future (no redo branch survives).
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().future).toHaveLength(1);
    useEditorStore.getState().move("R1", { x: 0, y: 0 });
    expect(useEditorStore.getState().future).toEqual([]);
  });

  it("no-op mutations do not create history entries", () => {
    seedStore();
    useEditorStore.getState().move("NOPE", { x: 10, y: 10 });
    // connecting two pins already on the same net is a no-op
    useEditorStore.getState().connect(
      { instanceId: "V1", pinId: "pos" },
      { instanceId: "R1", pinId: "p1" },
    );
    expect(useEditorStore.getState().past).toEqual([]);
  });

  it("history is bounded to HISTORY_LIMIT entries (oldest dropped)", () => {
    seedStore();
    expect(HISTORY_LIMIT).toBe(100);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) {
      useEditorStore.getState().move("R1", { x: i * 10, y: 0 });
    }
    expect(useEditorStore.getState().past).toHaveLength(HISTORY_LIMIT);
    // Oldest surviving snapshot is from move #20 (snapshots 1..20 dropped).
    const oldest = useEditorStore.getState().past[0]!;
    expect(oldest.layout?.instances["R1"]?.x).toBe(200);
  });

  it("beginGesture/endGesture coalesces a continuous drag into ONE history entry", () => {
    seedStore();
    useEditorStore.getState().beginGesture();
    useEditorStore.getState().move("R1", { x: 250, y: 120 });
    useEditorStore.getState().move("R1", { x: 260, y: 130 });
    useEditorStore.getState().move("R1", { x: 300, y: 200 });
    useEditorStore.getState().endGesture();
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 300, y: 200 });

    // One undo restores the pre-drag position.
    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 240, y: 120 });

    // A second, separate gesture is its own entry.
    useEditorStore.getState().redo();
    useEditorStore.getState().beginGesture();
    useEditorStore.getState().move("R1", { x: 400, y: 400 });
    useEditorStore.getState().endGesture();
    expect(useEditorStore.getState().past).toHaveLength(2);
  });

  it("undo/redo swap snapshots and round-trip the schematic", () => {
    seedStore();
    const original = useEditorStore.getState().bundle!.schematic;
    useEditorStore.getState().move("R1", { x: 300, y: 130 });
    const moved = useEditorStore.getState().bundle!.schematic;

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().bundle!.schematic).toBe(original);
    expect(useEditorStore.getState().past).toEqual([]);
    expect(useEditorStore.getState().future).toEqual([moved]);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().bundle!.schematic).toBe(moved);
    expect(useEditorStore.getState().past).toEqual([original]);
    expect(useEditorStore.getState().future).toEqual([]);
  });

  it("undo drops selections of instances that no longer exist", () => {
    seedStore();
    useEditorStore.getState().place(resistorGeneric, { x: 40, y: 40 });
    // place() selects the new instance (R2)
    expect(useEditorStore.getState().selection).toEqual(["R2"]);
    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().bundle!.schematic.instances.some((i) => i.instanceId === "R2"),
    ).toBe(false);
    expect(useEditorStore.getState().selection).toEqual([]);
  });

  it("redo keeps selection sane too (surviving instances stay selected)", () => {
    seedStore();
    useEditorStore.getState().setSelection(["C1", "R1"]);
    useEditorStore.getState().removeSelection();
    useEditorStore.getState().undo(); // C1 and R1 are back
    useEditorStore.getState().setSelection(["C1", "V1"]);
    useEditorStore.getState().redo(); // C1 and R1 deleted again
    expect(useEditorStore.getState().selection).toEqual(["V1"]);
  });

  it("undo marks dirty and schedules an autosave of the restored snapshot", async () => {
    const { store } = makeFakeStore();
    await useEditorStore.getState().loadProject("proj_rc_lowpass");

    useEditorStore.getState().move("R1", { x: 300, y: 130 });
    await vi.advanceTimersByTimeAsync(900);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().dirty).toBe(false);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect(store.save).toHaveBeenCalledTimes(2);
    const saved = vi.mocked(store.save).mock.calls[1]![0];
    expect(saved.schematic.layout?.instances["R1"]).toMatchObject({ x: 240, y: 120 });
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("loadProject resets history", async () => {
    makeFakeStore();
    seedStore();
    useEditorStore.getState().move("R1", { x: 300, y: 130 });
    expect(useEditorStore.getState().past).toHaveLength(1);
    await useEditorStore.getState().loadProject("proj_rc_lowpass");
    expect(useEditorStore.getState().past).toEqual([]);
    expect(useEditorStore.getState().future).toEqual([]);
  });
});

describe("editor history (top bar + keyboard)", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("renders undo/redo buttons, disabled while history is empty", () => {
    render(withTheme(<EditorTopBar />));
    expect(isDisabledButton(screen.getByRole("button", { name: /undo/i }))).toBe(true);
    expect(isDisabledButton(screen.getByRole("button", { name: /redo/i }))).toBe(true);
  });

  it("undo/redo buttons drive the store and enable/disable with history state", () => {
    render(withTheme(<EditorTopBar />));

    act(() => useEditorStore.getState().move("R1", { x: 300, y: 130 }));
    const undoButton = screen.getByRole("button", { name: /undo/i });
    expect(isDisabledButton(undoButton)).toBe(false);

    fireEvent.click(undoButton);
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 240, y: 120 });
    expect(isDisabledButton(screen.getByRole("button", { name: /undo/i }))).toBe(true);

    const redoButton = screen.getByRole("button", { name: /redo/i });
    expect(isDisabledButton(redoButton)).toBe(false);
    fireEvent.click(redoButton);
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 300, y: 130 });
    expect(isDisabledButton(screen.getByRole("button", { name: /redo/i }))).toBe(true);
  });

  it("Cmd/Ctrl+Z undoes and Cmd/Ctrl+Shift+Z redoes", () => {
    render(withTheme(<EditorTopBar />));
    act(() => useEditorStore.getState().move("R1", { x: 300, y: 130 }));

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 240, y: 120 });

    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 300, y: 130 });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 240, y: 120 });

    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 300, y: 130 });
  });

  it("plain Z (no modifier) and Cmd+Z inside a text input do nothing", () => {
    render(withTheme(<EditorTopBar />));
    act(() => useEditorStore.getState().move("R1", { x: 300, y: 130 }));

    fireEvent.keyDown(window, { key: "z" });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 300, y: 130 });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "z", metaKey: true });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"],
    ).toMatchObject({ x: 300, y: 130 });
    input.remove();
  });

  it("keeps the #ob-run-slot mount intact", () => {
    const { container } = render(withTheme(<EditorTopBar />));
    expect(container.querySelector("#ob-run-slot")).not.toBeNull();
  });
});
