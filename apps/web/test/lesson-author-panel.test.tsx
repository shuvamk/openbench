// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { createFromTemplate } from "../lib/templates";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { LessonAuthorPanel } from "../components/lesson/LessonAuthorPanel";

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

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

const AT = "2026-07-05T00:00:00Z";
const sch = (instances: Schematic["instances"], nets: Schematic["nets"]): Schematic => ({
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_7seg",
  projectId: "proj_7seg",
  instances,
  nets,
  provenance: { source: "test", at: AT },
});

const V1 = { instanceId: "V1", componentId: "cmp_vsource_dc" } as const;
const DISP1 = { instanceId: "U1", componentId: "cmp_7segment_display" } as const;
const R1 = {
  instanceId: "Ra",
  componentId: "cmp_resistor_generic",
  parameterOverrides: { resistance: 330 },
} as const;
const netVpos = {
  netId: "net_vpos",
  name: "VCC",
  connections: [
    { instanceId: "V1", pinId: "pos" },
    { instanceId: "Ra", pinId: "p1" },
  ],
};
const netSegA = {
  netId: "net_seg_a",
  connections: [
    { instanceId: "Ra", pinId: "p2" },
    { instanceId: "U1", pinId: "a" },
  ],
};

const S0 = sch([], []);
const S1 = sch([V1, DISP1], []);
const S2 = sch([V1, DISP1, R1], [netVpos, netSegA]);

/** Seed the editor store with a built schematic (current = S2) + its history. */
function seedBuild() {
  const bundle = createFromTemplate("rc-lowpass", "Author demo");
  useEditorStore.setState({ bundle: { ...bundle, schematic: S2 }, past: [S0, S1] });
}

beforeEach(() => {
  resetEditorState();
});
afterEach(() => cleanup());

describe("LessonAuthorPanel", () => {
  it("derives candidate steps from the editor undo-history on demand", () => {
    seedBuild();
    render(withTheme(<LessonAuthorPanel />));
    // Nothing derived yet.
    expect(screen.queryAllByTestId("author-step")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /derive steps/i }));
    // Two structural batches (place parts, add resistor + wires) → two steps.
    expect(screen.getAllByTestId("author-step")).toHaveLength(2);
  });

  it("previews each derived step's pass/fail against the live schematic", () => {
    seedBuild();
    render(withTheme(<LessonAuthorPanel />));
    fireEvent.click(screen.getByRole("button", { name: /derive steps/i }));
    // Every derived step passes against the schematic it was built from.
    for (const row of screen.getAllByTestId("author-step")) {
      expect(row.getAttribute("data-passed")).toBe("true");
    }
  });

  it("lets the author edit a step's instruction", () => {
    seedBuild();
    render(withTheme(<LessonAuthorPanel />));
    fireEvent.click(screen.getByRole("button", { name: /derive steps/i }));
    const firstRow = screen.getAllByTestId("author-step")[0]!;
    const input = within(firstRow).getByLabelText(/instruction/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Place the display and supply" } });
    expect(
      (within(firstRow).getByLabelText(/instruction/i) as HTMLInputElement).value,
    ).toBe("Place the display and supply");
  });

  it("splits a multi-clause step into more steps that still pass", () => {
    seedBuild();
    render(withTheme(<LessonAuthorPanel />));
    fireEvent.click(screen.getByRole("button", { name: /derive steps/i }));
    const before = screen.getAllByTestId("author-step").length;
    // The second step (resistor + two nets) has multiple clauses.
    const resistorRow = screen.getAllByTestId("author-step")[1]!;
    fireEvent.click(within(resistorRow).getByRole("button", { name: /split/i }));
    expect(screen.getAllByTestId("author-step").length).toBeGreaterThan(before);
    for (const row of screen.getAllByTestId("author-step")) {
      expect(row.getAttribute("data-passed")).toBe("true");
    }
  });

  it("merges two selected steps into one", () => {
    seedBuild();
    render(withTheme(<LessonAuthorPanel />));
    fireEvent.click(screen.getByRole("button", { name: /derive steps/i }));
    const rows = screen.getAllByTestId("author-step");
    fireEvent.click(within(rows[0]!).getByLabelText(/select step/i));
    fireEvent.click(within(rows[1]!).getByLabelText(/select step/i));
    fireEvent.click(screen.getByRole("button", { name: /merge selected/i }));
    expect(screen.getAllByTestId("author-step")).toHaveLength(1);
  });
});
