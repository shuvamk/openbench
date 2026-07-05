// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { Inspector } from "../components/editor/Inspector";
import { SchematicCanvas } from "../components/editor/SchematicCanvas";

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

/** LED + source with no ground and a dangling cathode → mixed error + warning. */
function brokenSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_erc_ui",
    projectId: "proj_erc_ui",
    instances: [
      { instanceId: "V1", componentId: "cmp_vsource_dc" },
      { instanceId: "D1", componentId: "cmp_led_generic" },
    ],
    nets: [
      {
        netId: "net_a",
        name: "A",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "D1", pinId: "anode" },
        ],
      },
    ],
    layout: {
      instances: {
        V1: { x: 120, y: 160 },
        D1: { x: 300, y: 160 },
      },
    },
    provenance: { source: "frontend", at: AT },
  };
}

function seedStore(schematic: Schematic) {
  resetEditorState();
  useEditorStore.setState({
    bundle: {
      project: {
        irVersion: IR_VERSION,
        kind: "project",
        id: schematic.projectId,
        name: "ERC demo",
        schematicId: schematic.id,
        collaborators: [],
        provenance: { source: "frontend", at: AT },
      },
      schematic,
    },
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("Inspector ERC panel", () => {
  beforeEach(() => seedStore(brokenSchematic()));
  afterEach(cleanup);

  it("renders one human-readable row per violation, none containing a raw ERC_ code", () => {
    const { container } = render(withTheme(<Inspector />));
    const rows = container.querySelectorAll("[data-erc-issue]");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.textContent ?? "").not.toMatch(/ERC_[A-Z_]+/);
      expect((row.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("clicking an issue row selects the offending instance in the editor store", () => {
    const { container } = render(withTheme(<Inspector />));
    // The floating-pin issue implicates D1 — find its row and click it.
    const row = Array.from(container.querySelectorAll("[data-erc-issue]")).find(
      (el) => el.getAttribute("data-erc-instance") === "D1",
    );
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(useEditorStore.getState().selection).toEqual(["D1"]);
  });

  it("shows no ERC_ machine code anywhere in the rendered Inspector DOM", () => {
    const { container } = render(withTheme(<Inspector />));
    expect(container.textContent ?? "").not.toMatch(/ERC_[A-Z_]+/);
  });

  it("renders an empty, clean state when there are no violations", () => {
    // Re-seed with a fully-wired, grounded circuit.
    seedStore({
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_clean",
      projectId: "proj_clean",
      instances: [
        { instanceId: "V1", componentId: "cmp_vsource_dc" },
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        {
          netId: "net_a",
          name: "A",
          connections: [
            { instanceId: "V1", pinId: "pos" },
            { instanceId: "R1", pinId: "p1" },
          ],
        },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "V1", pinId: "neg" },
            { instanceId: "R1", pinId: "p2" },
            { instanceId: "GND1", pinId: "gnd" },
          ],
        },
      ],
      provenance: { source: "frontend", at: AT },
    });
    const { container } = render(withTheme(<Inspector />));
    expect(container.querySelectorAll("[data-erc-issue]").length).toBe(0);
  });
});

describe("SchematicCanvas ERC badges", () => {
  beforeEach(() => seedStore(brokenSchematic()));
  afterEach(cleanup);

  it("marks instances implicated by a violation with an ERC badge", () => {
    const { container } = render(withTheme(<SchematicCanvas />));
    const badge = container.querySelector('[data-erc-badge="D1"]');
    expect(badge).not.toBeNull();
    // The badge carries its severity so the canvas can color it via tokens.
    expect(badge!.getAttribute("data-erc-severity")).toMatch(/error|warning/);
  });

  it("does not badge instances on a clean circuit", () => {
    seedStore({
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_clean",
      projectId: "proj_clean",
      instances: [
        { instanceId: "V1", componentId: "cmp_vsource_dc" },
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      nets: [
        {
          netId: "net_a",
          name: "A",
          connections: [
            { instanceId: "V1", pinId: "pos" },
            { instanceId: "R1", pinId: "p1" },
          ],
        },
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "V1", pinId: "neg" },
            { instanceId: "R1", pinId: "p2" },
            { instanceId: "GND1", pinId: "gnd" },
          ],
        },
      ],
      layout: { instances: { V1: { x: 1, y: 1 }, R1: { x: 2, y: 2 }, GND1: { x: 3, y: 3 } } },
      provenance: { source: "frontend", at: AT },
    });
    const { container } = render(withTheme(<SchematicCanvas />));
    expect(container.querySelector("[data-erc-badge]")).toBeNull();
  });
});
