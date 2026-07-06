// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { resetLiveState } from "../lib/live/store";
import { EditorTopBar } from "../components/editor/EditorTopBar";

/** Issue #163 — the editor chrome exposes a Teaching toggle wired to the store. */

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

const AT = "2026-07-05T00:00:00Z";

function seedBundle() {
  resetEditorState();
  resetLiveState();
  useEditorStore.setState({
    bundle: {
      project: {
        irVersion: IR_VERSION,
        kind: "project",
        id: "proj_topbar",
        name: "Topbar demo",
        schematicId: "sch_topbar",
        collaborators: [],
        provenance: { source: "frontend", at: AT },
      },
      schematic: {
        irVersion: IR_VERSION,
        kind: "schematic",
        id: "sch_topbar",
        projectId: "proj_topbar",
        instances: [],
        nets: [],
        provenance: { source: "frontend", at: AT },
      },
    },
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("EditorTopBar teaching toggle", () => {
  beforeEach(seedBundle);
  afterEach(cleanup);

  it("toggles teachingOpen in the editor store when clicked", () => {
    render(withTheme(<EditorTopBar />));
    expect(useEditorStore.getState().teachingOpen).toBe(false);

    const teachBtn = screen.getByRole("button", { name: /teaching/i });
    fireEvent.click(teachBtn);
    expect(useEditorStore.getState().teachingOpen).toBe(true);

    fireEvent.click(teachBtn);
    expect(useEditorStore.getState().teachingOpen).toBe(false);
  });
});
