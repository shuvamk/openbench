// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { IR_VERSION, type ProjectBundle } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { resetSimState, useSimStore } from "../lib/sim/store";
import { resetLiveState, useLiveStore } from "../lib/live/store";
import { CommandPalette } from "../components/editor/CommandPalette";

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
// jsdom implements neither <dialog>.showModal/close nor scrollIntoView.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  Element.prototype.scrollIntoView = vi.fn();
});

function makeBundle(): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_cmd",
      name: "Command palette demo",
      schematicId: "sch_cmd",
      collaborators: [],
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
    schematic: {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_cmd",
      projectId: "proj_cmd",
      instances: [],
      nets: [],
      layout: { instances: {} },
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
  };
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

function seed() {
  resetEditorState();
  resetSimState();
  resetLiveState();
  useEditorStore.setState({ bundle: makeBundle() });
}

/** The modal <dialog> gets the `open` attribute only while visible. */
function isPaletteOpen(): boolean {
  return screen.getByRole("dialog", { hidden: true }).hasAttribute("open");
}

function pressCmdK() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    seed();
  });
  afterEach(() => {
    cleanup();
    resetEditorState();
    resetSimState();
    resetLiveState();
  });

  it("Cmd+K toggles the palette open and closed", () => {
    render(withTheme(<CommandPalette />));
    expect(isPaletteOpen()).toBe(false);

    act(() => pressCmdK());
    expect(isPaletteOpen()).toBe(true);

    act(() => pressCmdK());
    expect(isPaletteOpen()).toBe(false);
  });

  it("typing filters commands; 'run' surfaces Run simulation", async () => {
    render(withTheme(<CommandPalette />));
    act(() => pressCmdK());

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "run" } });

    expect(await screen.findByText("Run simulation")).toBeInTheDocument();
    expect(screen.queryByText("Add Resistor")).not.toBeInTheDocument();
  });

  it("arrow keys move selection and Enter invokes the highlighted command", async () => {
    const runSimulation = vi.fn();
    useSimStore.setState({ runSimulation });

    render(withTheme(<CommandPalette />));
    act(() => pressCmdK());

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "run" } });
    await screen.findByText("Run simulation");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(runSimulation).toHaveBeenCalledTimes(1);
    expect(isPaletteOpen()).toBe(false);
  });

  it("Escape closes the palette", () => {
    render(withTheme(<CommandPalette />));
    act(() => pressCmdK());
    expect(isPaletteOpen()).toBe(true);

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(isPaletteOpen()).toBe(false);
  });
});
