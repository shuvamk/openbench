// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { IR_VERSION, type ProjectBundle } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { encodeShare } from "../lib/share";
import { EmbedSimulator } from "../components/embed/EmbedSimulator";

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
      id: "proj_shared",
      name: "Shared RC filter",
      schematicId: "sch_shared",
      collaborators: [],
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
    schematic: {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_shared",
      projectId: "proj_shared",
      instances: [
        { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 1000 } },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [],
      layout: { instances: { R1: { x: 100, y: 100 }, GND1: { x: 100, y: 220 } } },
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
  };
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("EmbedSimulator", () => {
  beforeEach(() => resetEditorState());
  afterEach(() => {
    cleanup();
    resetEditorState();
  });

  it("hydrates the shared bundle read-only and renders minimal chrome", async () => {
    const payload = (await encodeShare(makeBundle())) as string;
    const { container } = render(withTheme(<EmbedSimulator payload={payload} />));

    // The project name confirms the payload was decoded and loaded.
    expect(await screen.findByText("Shared RC filter")).toBeTruthy();
    // The store is read-only (mutation entry points disabled).
    expect(useEditorStore.getState().readOnly).toBe(true);
    // The schematic canvas (bespoke SVG) is present.
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("shows a friendly message when the payload can't be decoded", async () => {
    render(withTheme(<EmbedSimulator payload="not-a-valid-payload!!!" />));
    expect(await screen.findByText(/couldn.?t be opened/i)).toBeTruthy();
  });
});
