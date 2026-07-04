// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { SchematicCanvas } from "../components/editor/SchematicCanvas";
import { Palette } from "../components/editor/Palette";
import { Inspector } from "../components/editor/Inspector";
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

function rcLowpassSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_rc_lowpass",
    projectId: "proj_rc_lowpass",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
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
        V1: { x: 100, y: 200 },
        R1: { x: 240, y: 120 },
        C1: { x: 380, y: 200 },
        GND1: { x: 100, y: 320 },
      },
    },
    provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
  };
}

function seedStore() {
  resetEditorState();
  useEditorStore.setState({
    bundle: {
      project: {
        irVersion: IR_VERSION,
        kind: "project",
        id: "proj_rc_lowpass",
        name: "RC low-pass demo",
        schematicId: "sch_rc_lowpass",
        collaborators: [],
        provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
      },
      schematic: rcLowpassSchematic(),
    },
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("SchematicCanvas", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("renders every seeded rc-lowpass instance on the canvas", () => {
    const { container } = render(<SchematicCanvas />);
    for (const id of ["V1", "R1", "C1", "GND1"]) {
      expect(container.querySelector(`[data-instance-id="${id}"]`)).not.toBeNull();
    }
  });

  it("renders the dotted grid and wires for the nets", () => {
    const { container } = render(<SchematicCanvas />);
    expect(container.querySelector("pattern")).not.toBeNull();
    const wires = container.querySelectorAll("[data-net-id]");
    expect(wires.length).toBeGreaterThan(0);
  });

  it("renders pin dots for the instances", () => {
    const { container } = render(<SchematicCanvas />);
    expect(container.querySelector('[data-pin="R1:p1"]')).not.toBeNull();
    expect(container.querySelector('[data-pin="V1:pos"]')).not.toBeNull();
  });

  it("click selects an instance, shift-click adds to the selection", () => {
    const { container } = render(<SchematicCanvas />);
    const r1 = container.querySelector('[data-instance-id="R1"]')!;
    fireEvent.pointerDown(r1, { button: 0, clientX: 240, clientY: 120 });
    fireEvent.pointerUp(r1, { button: 0, clientX: 240, clientY: 120 });
    expect(useEditorStore.getState().selection).toEqual(["R1"]);
    const c1 = container.querySelector('[data-instance-id="C1"]')!;
    // jsdom has no PointerEvent constructor; a MouseEvent-based pointerdown
    // keeps shiftKey/button intact.
    fireEvent(
      c1,
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
        clientX: 380,
        clientY: 200,
      }),
    );
    fireEvent(
      c1,
      new MouseEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
        clientX: 380,
        clientY: 200,
      }),
    );
    expect(useEditorStore.getState().selection).toEqual(["R1", "C1"]);
  });

  it("Delete removes the selection, Escape cancels a wire draft", () => {
    render(<SchematicCanvas />);
    act(() => useEditorStore.getState().setSelection(["C1"]));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(
      useEditorStore.getState().bundle!.schematic.instances.some((i) => i.instanceId === "C1"),
    ).toBe(false);

    act(() => useEditorStore.getState().startWire({ instanceId: "R1", pinId: "p2" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useEditorStore.getState().wireDraft).toBeUndefined();
  });

  it("R rotates the selected instance", () => {
    render(<SchematicCanvas />);
    act(() => useEditorStore.getState().setSelection(["R1"]));
    fireEvent.keyDown(window, { key: "r" });
    expect(
      useEditorStore.getState().bundle!.schematic.layout?.instances["R1"]?.rotation,
    ).toBe(90);
  });
});

describe("SchematicCanvas — scope probes (issue #37)", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("dropping a probe with the probe tool marks the net and renders a marker", () => {
    const { container } = render(<SchematicCanvas />);
    act(() => useEditorStore.getState().setTool("probe"));
    const netWire = container.querySelector('[data-net-id="net_out"] polyline')!;
    expect(netWire).not.toBeNull();
    fireEvent.click(netWire);
    const probes = useEditorStore.getState().bundle!.schematic.layout?.probes ?? [];
    expect(probes.map((p) => p.netId)).toContain("net_out");
    expect(container.querySelector("[data-probe-id]")).not.toBeNull();
  });

  it("does not drop a probe when the probe tool is not armed", () => {
    const { container } = render(<SchematicCanvas />);
    // Default tool is "select".
    fireEvent.click(container.querySelector('[data-net-id="net_out"] polyline')!);
    expect(useEditorStore.getState().bundle!.schematic.layout?.probes ?? []).toEqual([]);
  });

  it("clicking an existing probe marker removes it", () => {
    act(() =>
      useEditorStore.getState().addProbe("net_out", { x: 200, y: 120 }),
    );
    const { container } = render(<SchematicCanvas />);
    const marker = container.querySelector("[data-probe-id]")!;
    expect(marker).not.toBeNull();
    fireEvent.click(marker);
    expect(useEditorStore.getState().bundle!.schematic.layout?.probes ?? []).toEqual([]);
  });
});

describe("Palette", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("lists the registry components and arms the place tool on click", () => {
    render(withTheme(<Palette />));
    for (const name of ["Resistor", "Capacitor", "LED", "DC Voltage Source", "Ground", "ESP32 DevKitC"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole("button", { name: /Resistor/ }));
    expect(useEditorStore.getState().tool).toBe("place");
    expect(useEditorStore.getState().placingComponentId).toBe("cmp_resistor_generic");
  });

  it("arms the scope-probe tool when the probe button is clicked", () => {
    render(withTheme(<Palette />));
    fireEvent.click(screen.getByRole("button", { name: /Scope probe/ }));
    expect(useEditorStore.getState().tool).toBe("probe");
  });

  it("filters the parts list as the user types in the search box", () => {
    render(withTheme(<Palette />));
    const search = screen.getByPlaceholderText(/search parts/i);
    fireEvent.change(search, { target: { value: "inductor" } });
    // matching part stays…
    expect(screen.getAllByText("Inductor").length).toBeGreaterThan(0);
    // …non-matching parts are filtered out
    expect(screen.queryByText("Capacitor")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ground$/ })).toBeNull();
  });

  it("shows an empty state when nothing matches the query", () => {
    render(withTheme(<Palette />));
    const search = screen.getByPlaceholderText(/search parts/i);
    fireEvent.change(search, { target: { value: "zzzznotathing" } });
    expect(screen.getByText(/No parts match/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Resistor/ })).toBeNull();
  });
});

describe("Inspector", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("shows the selected instance, its component, parameters, and nets", () => {
    useEditorStore.getState().setSelection(["R1"]);
    render(withTheme(<Inspector />));
    expect(screen.getAllByText("R1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resistor").length).toBeGreaterThan(0);
    // parameter input seeded with the override value
    const input = screen.getByLabelText(/resistance/i) as HTMLInputElement;
    expect(input.value).toContain("4700");
    // nets touching R1
    expect(screen.getAllByText(/IN/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OUT/).length).toBeGreaterThan(0);
  });

  it("editing a parameter writes an override through the store", () => {
    useEditorStore.getState().setSelection(["R1"]);
    render(withTheme(<Inspector />));
    const input = screen.getByLabelText(/resistance/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "220" } });
    const r1 = useEditorStore
      .getState()
      .bundle!.schematic.instances.find((i) => i.instanceId === "R1");
    expect(r1?.parameterOverrides?.["resistance"]).toBe(220);
  });
});

describe("EditorTopBar", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("shows the project name, a save-state dot, zoom controls, and the run slot", () => {
    const { container } = render(withTheme(<EditorTopBar />));
    expect(screen.getAllByText("RC low-pass demo").length).toBeGreaterThan(0);
    expect(container.querySelector("#ob-run-slot")).not.toBeNull();
    // zoom controls drive the store
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(useEditorStore.getState().zoom).toBeGreaterThan(1);
  });
});
