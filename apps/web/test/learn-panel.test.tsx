// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type Component, type Schematic } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { resetLearnPrefs, useLearnPrefs } from "../lib/editor/learn-prefs";
import { LearnPanel } from "../components/editor/LearnPanel";

/**
 * Issue #80 — the generic Inspector "Learn" panel. Renders the selected
 * component's `education` block (summary/gotchas/keyFormula/paramNotes) purely
 * from the data: no per-part branching. Progressive (starts collapsed) and
 * opt-out (a pro who turns it off never sees it).
 */

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

function schWith(componentId: string): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_learn",
    projectId: "proj_learn",
    instances: [{ instanceId: "X1", componentId }],
    nets: [],
    provenance: { source: "test", at: AT },
  };
}

/** Seed a single-instance selection referencing `componentId`. */
function seedSelection(componentId: string): void {
  resetEditorState();
  resetLearnPrefs();
  useEditorStore.setState({
    bundle: {
      project: {
        irVersion: IR_VERSION,
        kind: "project",
        id: "proj_learn",
        name: "Learn demo",
        schematicId: "sch_learn",
        collaborators: [],
        provenance: { source: "frontend", at: AT },
      },
      schematic: schWith(componentId),
    },
    selection: ["X1"],
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

/** A fixture component with novel content values, to prove generic rendering. */
const FIXTURE_MARKER = "ZZ_fixture_only_gotcha_marker";
const fixtureComponent: Component = {
  irVersion: IR_VERSION,
  kind: "component",
  id: "cmp_fixture_widget",
  name: "Fixture Widget",
  category: "other",
  pins: [{ id: "p1", name: "1", electricalType: "passive" }],
  parameters: [{ name: "gain", unit: "x", default: 2, type: "number" }],
  education: {
    summary: "A made-up part used only to prove the renderer is data-driven.",
    gotchas: [FIXTURE_MARKER],
    keyFormula: { display: "y = gain × x", variables: { y: "output", x: "input" } },
    paramNotes: { gain: "ZZ_fixture_param_note_marker" },
  },
  provenance: { source: "test", at: AT },
};

describe("LearnPanel (issue #80)", () => {
  beforeEach(() => seedSelection("cmp_resistor_generic"));
  afterEach(cleanup);

  it("renders the selected component's summary + gotchas, starting collapsed", () => {
    const { container } = render(withTheme(<LearnPanel />));

    // Panel present for a part that has an education block.
    expect(container.querySelector("[data-testid='learn-panel']")).not.toBeNull();

    // Resistor education (authored in #79) shows up.
    expect(screen.getByText(/no polarity/i)).toBeTruthy(); // a resistor gotcha
    expect(screen.getByText(/limits how much current flows/i)).toBeTruthy(); // summary

    // Progressive disclosure: the collapsible content starts collapsed.
    const trigger = container.querySelector("[data-testid='learn-panel'] button[aria-expanded]");
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");

    // Expanding flips aria-expanded.
    fireEvent.click(trigger as Element);
    expect(
      container
        .querySelector("[data-testid='learn-panel'] button[aria-expanded]")!
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("renders nothing for a component without an education block", () => {
    seedSelection("cmp_ground"); // ground carries no education block
    const { container } = render(withTheme(<LearnPanel />));
    expect(container.querySelector("[data-testid='learn-panel']")).toBeNull();
  });

  it("renders content generically from the data (fixture component, no per-part code)", () => {
    seedSelection("cmp_fixture_widget");
    const { container } = render(
      withTheme(<LearnPanel resolveComponent={(id) => (id === "cmp_fixture_widget" ? fixtureComponent : undefined)} />),
    );
    expect(container.querySelector("[data-testid='learn-panel']")).not.toBeNull();
    // Novel field values render without any component-specific branching.
    expect(screen.getByText(new RegExp(FIXTURE_MARKER))).toBeTruthy();
    expect(screen.getByText(/ZZ_fixture_param_note_marker/)).toBeTruthy();
    expect(screen.getByText(/y = gain × x/)).toBeTruthy();
  });

  it("respects the opt-out: a user who turned Learn off sees nothing", () => {
    useLearnPrefs.setState({ enabled: false });
    const { container } = render(withTheme(<LearnPanel />));
    expect(container.querySelector("[data-testid='learn-panel']")).toBeNull();
  });

  it("the in-panel dismiss control turns Learn off and hides the panel", () => {
    const { container, rerender } = render(withTheme(<LearnPanel />));
    expect(container.querySelector("[data-testid='learn-panel']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /hide|don.t show|turn off/i }));
    expect(useLearnPrefs.getState().enabled).toBe(false);

    rerender(withTheme(<LearnPanel />));
    expect(container.querySelector("[data-testid='learn-panel']")).toBeNull();
  });
});
