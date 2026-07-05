// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  resetEditorState,
  useEditorStore,
} from "../lib/editor/store";
import { useLiveStore } from "../lib/live/store";
import { ZoomControls } from "../components/editor/ZoomControls";
import { SchematicCanvas } from "../components/editor/SchematicCanvas";

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

function twoInstanceSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_x",
    projectId: "proj_x",
    instances: [
      { instanceId: "R1", componentId: "cmp_resistor_generic" },
      { instanceId: "C1", componentId: "cmp_capacitor_generic" },
    ],
    nets: [],
    layout: {
      instances: {
        R1: { x: 40, y: 40 },
        C1: { x: 600, y: 400 },
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
        id: "proj_x",
        name: "X",
        schematicId: "sch_x",
        collaborators: [],
        provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
      },
      schematic: twoInstanceSchematic(),
    },
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("ZoomControls", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("shows the current zoom as a percentage readout", () => {
    useEditorStore.setState({ zoom: 1.5 });
    const { getByText } = render(withTheme(<ZoomControls />));
    expect(getByText("150%")).toBeTruthy();
  });

  it("the + button steps zoom up by a fixed factor, clamped to MAX_ZOOM", () => {
    useEditorStore.setState({ zoom: 1 });
    const { getByRole } = render(withTheme(<ZoomControls />));
    fireEvent.click(getByRole("button", { name: /zoom in/i }));
    expect(useEditorStore.getState().zoom).toBeGreaterThan(1);

    useEditorStore.setState({ zoom: MAX_ZOOM });
    fireEvent.click(getByRole("button", { name: /zoom in/i }));
    expect(useEditorStore.getState().zoom).toBe(MAX_ZOOM);
  });

  it("the - button steps zoom down by a fixed factor, clamped to MIN_ZOOM", () => {
    useEditorStore.setState({ zoom: 1 });
    const { getByRole } = render(withTheme(<ZoomControls />));
    fireEvent.click(getByRole("button", { name: /zoom out/i }));
    expect(useEditorStore.getState().zoom).toBeLessThan(1);

    useEditorStore.setState({ zoom: MIN_ZOOM });
    fireEvent.click(getByRole("button", { name: /zoom out/i }));
    expect(useEditorStore.getState().zoom).toBe(MIN_ZOOM);
  });

  it("clicking the percentage readout resets zoom to 100%", () => {
    useEditorStore.setState({ zoom: 2.4 });
    const { getByText } = render(withTheme(<ZoomControls />));
    fireEvent.click(getByText("240%"));
    expect(useEditorStore.getState().zoom).toBe(1);
  });

  it("zoom-to-fit applies fitToContent to the store (zoom + pan change)", () => {
    useEditorStore.setState({ zoom: 4, pan: { x: 0, y: 0 } });
    const { getByRole } = render(withTheme(<ZoomControls />));
    fireEvent.click(getByRole("button", { name: /fit/i }));
    const state = useEditorStore.getState();
    // Content spans a wide area; fit must zoom out below the starting 4x.
    expect(state.zoom).toBeLessThan(4);
    expect(state.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(Number.isNaN(state.pan.x)).toBe(false);
    expect(Number.isNaN(state.pan.y)).toBe(false);
  });
});

// jsdom has no PointerEvent constructor; MouseEvent-based synthetic pointer
// events preserve button/shiftKey/clientX/clientY (mirrors editor-canvas.test).
function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  props: { button?: number; shiftKey?: boolean; clientX?: number; clientY?: number },
) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...props });
}

describe("SchematicCanvas — Figma-style drag-pan", () => {
  beforeEach(seedStore);
  afterEach(cleanup);

  it("left-drag on empty canvas background pans the view", () => {
    const { container } = render(<SchematicCanvas />);
    const svg = container.querySelector('[data-testid="schematic-canvas"]')!;
    const panBefore = { ...useEditorStore.getState().pan };
    fireEvent(svg, pointer("pointerdown", { button: 0, clientX: 200, clientY: 200 }));
    fireEvent(svg, pointer("pointermove", { button: 0, clientX: 260, clientY: 240 }));
    const panAfter = useEditorStore.getState().pan;
    expect(panAfter.x).toBe(panBefore.x + 60);
    expect(panAfter.y).toBe(panBefore.y + 40);
    fireEvent(svg, pointer("pointerup", { button: 0, clientX: 260, clientY: 240 }));
  });

  it("left-drag on a component moves it and does NOT pan", () => {
    const { container } = render(<SchematicCanvas />);
    const svg = container.querySelector('[data-testid="schematic-canvas"]')!;
    const r1 = container.querySelector('[data-instance-id="R1"]')!;
    const panBefore = { ...useEditorStore.getState().pan };
    fireEvent(r1, pointer("pointerdown", { button: 0, clientX: 40, clientY: 40 }));
    fireEvent(svg, pointer("pointermove", { button: 0, clientX: 120, clientY: 90 }));
    // The instance moved…
    const placement = useEditorStore.getState().bundle!.schematic.layout!.instances["R1"]!;
    expect(placement.x).not.toBe(40);
    // …and the pan did not change.
    expect(useEditorStore.getState().pan).toEqual(panBefore);
    fireEvent(svg, pointer("pointerup", { button: 0, clientX: 120, clientY: 90 }));
  });

  it("shift + left-drag on empty background box-selects instead of panning", () => {
    const { container } = render(<SchematicCanvas />);
    const svg = container.querySelector('[data-testid="schematic-canvas"]')!;
    const panBefore = { ...useEditorStore.getState().pan };
    fireEvent(svg, pointer("pointerdown", { button: 0, shiftKey: true, clientX: 0, clientY: 0 }));
    fireEvent(svg, pointer("pointermove", { button: 0, shiftKey: true, clientX: 700, clientY: 500 }));
    // A marquee rectangle should be present during a box-select drag…
    expect(container.querySelector("[data-marquee]")).not.toBeNull();
    // …and shift-drag must not pan.
    expect(useEditorStore.getState().pan).toEqual(panBefore);
    fireEvent(svg, pointer("pointerup", { button: 0, shiftKey: true, clientX: 700, clientY: 500 }));
  });
});

describe("SchematicCanvas — space/live drag-pan is tool-agnostic (issue 135)", () => {
  beforeEach(seedStore);
  afterEach(() => {
    // Release space and reset live mode so state never leaks between tests.
    fireEvent.keyUp(window, { key: " " });
    useLiveStore.setState({ mode: "design" });
    cleanup();
  });

  it("space-hold + left-drag on empty background pans even with a non-select tool active", () => {
    useEditorStore.setState({ tool: "wire" });
    const { container } = render(<SchematicCanvas />);
    const svg = container.querySelector('[data-testid="schematic-canvas"]')!;
    const panBefore = { ...useEditorStore.getState().pan };
    // Space is held via a real window keydown, matching the component's listener.
    fireEvent.keyDown(window, { key: " " });
    fireEvent(svg, pointer("pointerdown", { button: 0, clientX: 200, clientY: 200 }));
    fireEvent(svg, pointer("pointermove", { button: 0, clientX: 260, clientY: 240 }));
    const panAfter = useEditorStore.getState().pan;
    expect(panAfter.x).toBe(panBefore.x + 60);
    expect(panAfter.y).toBe(panBefore.y + 40);
    fireEvent(svg, pointer("pointerup", { button: 0, clientX: 260, clientY: 240 }));
  });

  it("live-mode background drag pans even with a non-select tool active", () => {
    useEditorStore.setState({ tool: "place" });
    useLiveStore.setState({ mode: "live" });
    const { container } = render(<SchematicCanvas />);
    const svg = container.querySelector('[data-testid="schematic-canvas"]')!;
    const panBefore = { ...useEditorStore.getState().pan };
    fireEvent(svg, pointer("pointerdown", { button: 0, clientX: 200, clientY: 200 }));
    fireEvent(svg, pointer("pointermove", { button: 0, clientX: 250, clientY: 210 }));
    const panAfter = useEditorStore.getState().pan;
    expect(panAfter.x).toBe(panBefore.x + 50);
    expect(panAfter.y).toBe(panBefore.y + 10);
    fireEvent(svg, pointer("pointerup", { button: 0, clientX: 250, clientY: 210 }));
  });

  it("plain (no-space, no-shift) left-drag pan STILL requires the select tool", () => {
    useEditorStore.setState({ tool: "wire" });
    const { container } = render(<SchematicCanvas />);
    const svg = container.querySelector('[data-testid="schematic-canvas"]')!;
    const panBefore = { ...useEditorStore.getState().pan };
    fireEvent(svg, pointer("pointerdown", { button: 0, clientX: 200, clientY: 200 }));
    fireEvent(svg, pointer("pointermove", { button: 0, clientX: 260, clientY: 240 }));
    // Non-select tool + no chord must NOT pan.
    expect(useEditorStore.getState().pan).toEqual(panBefore);
    fireEvent(svg, pointer("pointerup", { button: 0, clientX: 260, clientY: 240 }));
  });
});
