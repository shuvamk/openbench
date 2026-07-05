// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type ProjectBundle } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { BomButton } from "../components/editor/BomButton";

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
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function makeBundle(): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_bom",
      name: "BOM demo",
      schematicId: "sch_bom",
      collaborators: [],
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
    schematic: {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_bom",
      projectId: "proj_bom",
      instances: [
        { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
        { instanceId: "R2", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 4700 } },
      ],
      nets: [],
      layout: { instances: {} },
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
  };
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("BomButton", () => {
  beforeEach(() => {
    resetEditorState();
    useEditorStore.setState({ bundle: makeBundle() });
  });
  afterEach(() => {
    cleanup();
    resetEditorState();
  });

  it("opens a dialog showing the BOM table when clicked", () => {
    render(withTheme(<BomButton />));
    const dialog = screen.getByRole("dialog", { hidden: true });
    // Closed initially — the modal dialog keeps children mounted but not shown.
    expect(dialog.hasAttribute("open")).toBe(false);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /bill of materials/i }));
    });

    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("4.7k")).toBeTruthy();
  });
});
