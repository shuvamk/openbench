// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { IR_VERSION } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { resetLiveState, useLiveStore } from "../lib/live/store";
import { EditorTopBar } from "../components/editor/EditorTopBar";

/** Issue #72 — the blocked-Live reason must be visible in the editor chrome. */

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

describe("EditorTopBar blocked-Live banner", () => {
  beforeEach(seedBundle);
  afterEach(cleanup);

  it("renders the enterError reason when Live was blocked", () => {
    useLiveStore.setState({ enterError: "This circuit has no ground — add a ground symbol." });
    const { container } = render(withTheme(<EditorTopBar />));
    expect(container.textContent ?? "").toContain("This circuit has no ground");
  });

  it("shows no banner when there is no enterError", () => {
    useLiveStore.setState({ enterError: null });
    const { container } = render(withTheme(<EditorTopBar />));
    expect(container.querySelector("[data-live-error]")).toBeNull();
  });

  it("dismissing the banner clears the error from the store", () => {
    useLiveStore.setState({ enterError: "This circuit has no ground — add a ground symbol." });
    const { container } = render(withTheme(<EditorTopBar />));
    const banner = container.querySelector("[data-live-error]");
    expect(banner).not.toBeNull();
    const dismiss = banner!.querySelector("button");
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss!);
    expect(useLiveStore.getState().enterError).toBeNull();
  });
});
