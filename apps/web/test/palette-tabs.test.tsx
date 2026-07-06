// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { Palette } from "../components/editor/Palette";

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

function renderPalette() {
  return render(
    <Theme theme={neutralTheme}>
      <Palette />
    </Theme>,
  );
}

beforeEach(() => {
  resetEditorState();
});

afterEach(() => {
  cleanup();
});

describe("Palette tabs (Components | Instruments)", () => {
  it("renders Components and Instruments as tabs, not a flat list", () => {
    renderPalette();
    expect(screen.getByRole("button", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Instruments" })).toBeTruthy();
  });

  it("defaults to the Components tab: parts and search visible, instruments hidden", () => {
    renderPalette();
    expect(screen.getByText("Resistor")).toBeTruthy();
    expect(screen.getByLabelText("Search components")).toBeTruthy();
    expect(screen.queryByText(/Scope probe/)).toBeNull();
  });

  it("switching to Instruments shows the scope probe and hides the part list", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: "Instruments" }));
    expect(screen.getByText(/Scope probe/)).toBeTruthy();
    expect(screen.queryByText("Resistor")).toBeNull();
    expect(screen.queryByLabelText("Search components")).toBeNull();
  });

  it("arming the scope probe still works from the Instruments tab", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: "Instruments" }));
    fireEvent.click(screen.getByText(/Scope probe/));
    expect(useEditorStore.getState().tool).toBe("probe");
  });

  it("switching back to Components restores the part list", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: "Instruments" }));
    fireEvent.click(screen.getByRole("button", { name: "Components" }));
    expect(screen.getByText("Resistor")).toBeTruthy();
    expect(screen.queryByText(/Scope probe/)).toBeNull();
  });
});
