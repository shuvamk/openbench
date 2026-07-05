// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type ProjectBundle } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { BomPanel } from "../components/editor/BomPanel";

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
        { instanceId: "V1", componentId: "cmp_vsource_dc" },
        { instanceId: "X1", componentId: "cmp_mystery_widget" },
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

describe("BomPanel", () => {
  beforeEach(() => {
    resetEditorState();
    useEditorStore.setState({ bundle: makeBundle() });
  });
  afterEach(() => {
    cleanup();
    resetEditorState();
  });

  it("renders an Astryx table with the grouped BOM (4.7k ×2)", () => {
    render(withTheme(<BomPanel />));
    // Purchasable BOM + a virtual section, both Astryx tables.
    expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("4.7k")).toBeTruthy();
    expect(screen.getByText("R1;R2")).toBeTruthy();
  });

  it("marks registry-unknown parts with a ⚠ unknown marker rather than dropping them", () => {
    render(withTheme(<BomPanel />));
    expect(screen.getByText(/unknown/i)).toBeTruthy();
    expect(screen.getByText("X1")).toBeTruthy();
  });

  it("Export CSV triggers a download of the bill of materials", () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(withTheme(<BomPanel />));
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
