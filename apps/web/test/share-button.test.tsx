// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IR_VERSION, type ProjectBundle } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { ShareButton } from "../components/editor/ShareButton";

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
      id: "proj_share",
      name: "Shareable",
      schematicId: "sch_share",
      collaborators: [],
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
    schematic: {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_share",
      projectId: "proj_share",
      instances: [
        { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 1000 } },
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

describe("ShareButton", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetEditorState();
    useEditorStore.setState({ bundle: makeBundle() });
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });
  afterEach(() => {
    cleanup();
    resetEditorState();
  });

  it("copies an /embed/<payload> link to the clipboard when clicked", async () => {
    render(withTheme(<ShareButton />));
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.calls[0]![0] as string;
    expect(url).toContain("/embed/");
    // The payload is URL-safe.
    expect(url.split("/embed/")[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    // A confirmation is surfaced.
    expect(await screen.findByText(/copied/i)).toBeTruthy();
  });
});
