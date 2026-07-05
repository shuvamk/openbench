// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { IR_VERSION, type ProjectBundle, type Schematic } from "@openbench/ir-schema";
import type { Lesson } from "@openbench/lesson";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { StudentRunnerPanel } from "../components/lesson/StudentRunnerPanel";

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

/** The §4 "7-Segment LED Display" lesson — first three authored steps. */
function sevenSegLesson(): Lesson {
  return {
    lessonFormat: "0.1.0",
    id: "les_7seg",
    title: "7-Segment LED Display",
    description: "Light segment **a** of a common-cathode 7-segment display.",
    difficulty: "beginner",
    targetBundle: {} as Lesson["targetBundle"],
    steps: [
      {
        id: "s1-parts",
        instruction: "Drag a **7-Segment Display** and a **5 V DC source** onto the canvas.",
        expect: {
          all: [
            { component: { of: "cmp_7segment_display", as: "DISP" } },
            {
              component: {
                of: "cmp_vsource_dc",
                as: "V",
                where: [{ param: "voltage", approx: { value: 5, tolerancePct: 5 } }],
              },
            },
          ],
        },
        hint: "The display is under Outputs; the DC source under Sources.",
      },
      {
        id: "s2-resistor-a",
        instruction: "Wire a **330 Ω** resistor between the supply and segment **a**.",
        expect: {
          all: [
            {
              component: {
                of: "cmp_resistor_generic",
                as: "R",
                where: [{ param: "resistance", approx: { value: 330, tolerancePct: 10 } }],
              },
            },
            { connected: { pins: [{ role: "R", pin: "p1" }, { role: "V", pin: "pos" }] } },
            { connected: { pins: [{ role: "R", pin: "p2" }, { role: "DISP", pin: "a" }] } },
          ],
        },
        hint: "One resistor pin to the +5 V node, the other to the display's a pin.",
        allowAutoPlace: true,
      },
      {
        id: "s3-ground",
        instruction: "Connect the display's **COM** to **Ground**.",
        expect: {
          all: [
            { component: { of: "cmp_ground", as: "GND" } },
            { connected: { pins: [{ role: "DISP", pin: "com" }, { role: "GND", pin: "gnd" }] } },
          ],
        },
        hint: "Add a Ground symbol and wire it to COM.",
      },
    ],
  };
}

function emptySchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_7seg",
    projectId: "proj_7seg",
    instances: [],
    nets: [],
    provenance: { source: "frontend", at: AT },
  };
}

function bundleOf(schematic: Schematic): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: schematic.projectId,
      name: "Lesson",
      schematicId: schematic.id,
      collaborators: [],
      provenance: { source: "frontend", at: AT },
    },
    schematic,
  };
}

function seed(schematic: Schematic) {
  act(() => {
    resetEditorState();
    useEditorStore.setState({ bundle: bundleOf(schematic) });
  });
}

function setSchematic(schematic: Schematic) {
  act(() => {
    useEditorStore.setState({ bundle: bundleOf(schematic) });
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

/** Step-1 satisfying instances. */
const DISPLAY = { instanceId: "DISP1", componentId: "cmp_7segment_display" };
const SOURCE = { instanceId: "V1", componentId: "cmp_vsource_dc" };

function withResistor(resistance: number): Schematic {
  return {
    ...emptySchematic(),
    instances: [
      DISPLAY,
      SOURCE,
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance } },
    ],
    nets: [
      {
        netId: "net_supply",
        name: "SUPPLY",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_seg_a",
        name: "SEG_A",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "DISP1", pinId: "a" },
        ],
      },
    ],
  };
}

function activeStepId(container: HTMLElement): string | null {
  return container.querySelector("[data-lesson-runner]")?.getAttribute("data-active-step") ?? null;
}

/** The finished reference circuit — the lesson's targetBundle for "do it for me". */
function sevenSegTarget(): Schematic {
  return {
    ...emptySchematic(),
    instances: [
      { instanceId: "DISP1", componentId: "cmp_7segment_display" },
      { instanceId: "V1", componentId: "cmp_vsource_dc", parameterOverrides: { voltage: 5 } },
      { instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 330 } },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_supply",
        name: "SUPPLY",
        connections: [
          { instanceId: "V1", pinId: "pos" },
          { instanceId: "R1", pinId: "p1" },
        ],
      },
      {
        netId: "net_seg_a",
        connections: [
          { instanceId: "R1", pinId: "p2" },
          { instanceId: "DISP1", pinId: "a" },
        ],
      },
    ],
  };
}

function sevenSegLessonWithTarget(): Lesson {
  return { ...sevenSegLesson(), targetBundle: bundleOf(sevenSegTarget()) };
}

describe("StudentRunnerPanel", () => {
  beforeEach(() => seed(emptySchematic()));
  afterEach(cleanup);

  it("offers 'do it for me' on an allowAutoPlace step and applies the target mutation to advance", async () => {
    const { container } = render(
      withTheme(<StudentRunnerPanel lesson={sevenSegLessonWithTarget()} debounceMs={0} />),
    );
    // Student has done step 1 (display + source) → step 2 is active + unsatisfied.
    setSchematic({ ...emptySchematic(), instances: [DISPLAY, SOURCE] });
    await waitFor(() => expect(activeStepId(container)).toBe("s2-resistor-a"));

    const host = container.querySelector("[data-lesson-autoplace]");
    expect(host).not.toBeNull();
    const button = (host!.querySelector("button") ?? host) as HTMLElement;
    act(() => button.click());

    // The minimal target mutation was applied → step 2 passes, runner advances.
    await waitFor(() => expect(activeStepId(container)).toBe("s3-ground"));
    const placed = useEditorStore.getState().bundle!.schematic.instances;
    expect(placed.some((i) => i.componentId === "cmp_resistor_generic")).toBe(true);
  });

  it("does not offer 'do it for me' on a step without allowAutoPlace", async () => {
    const { container } = render(
      withTheme(<StudentRunnerPanel lesson={sevenSegLessonWithTarget()} debounceMs={0} />),
    );
    // Step 1 is active and is NOT allowAutoPlace.
    await waitFor(() => expect(activeStepId(container)).toBe("s1-parts"));
    expect(container.querySelector("[data-lesson-autoplace]")).toBeNull();
  });

  it("wiring the 7-seg circuit step-by-step lights each step green in order", async () => {
    const { container } = render(withTheme(<StudentRunnerPanel lesson={sevenSegLesson()} debounceMs={0} />));

    // Start on step 1.
    await waitFor(() => expect(activeStepId(container)).toBe("s1-parts"));

    // Place display + 5 V source → step 1 passes, advances to step 2.
    setSchematic({ ...emptySchematic(), instances: [DISPLAY, SOURCE] });
    await waitFor(() => expect(activeStepId(container)).toBe("s2-resistor-a"));
    expect(
      container
        .querySelector('[data-lesson-step="s1-parts"]')
        ?.getAttribute("data-step-status"),
    ).toBe("passed");

    // Add a correctly-valued, wired resistor → step 2 passes, advances to step 3.
    setSchematic(withResistor(330));
    await waitFor(() => expect(activeStepId(container)).toBe("s3-ground"));

    // Ground the common cathode → step 3 passes, lesson complete.
    setSchematic({
      ...withResistor(330),
      instances: [...withResistor(330).instances, { instanceId: "GND1", componentId: "cmp_ground" }],
      nets: [
        ...withResistor(330).nets,
        {
          netId: "net_gnd",
          name: "GND",
          connections: [
            { instanceId: "DISP1", pinId: "com" },
            { instanceId: "GND1", pinId: "gnd" },
          ],
        },
      ],
    });
    await waitFor(() =>
      expect(
        container.querySelector("[data-lesson-runner]")?.getAttribute("data-complete"),
      ).toBe("true"),
    );
  });

  it("a wrong resistor value keeps the step red with its hint", async () => {
    const { container } = render(withTheme(<StudentRunnerPanel lesson={sevenSegLesson()} debounceMs={0} />));

    // 1 kΩ resistor (default is 1000Ω anyway) → step 2 active but its value clause fails.
    setSchematic(withResistor(1000));
    await waitFor(() => expect(activeStepId(container)).toBe("s2-resistor-a"));

    // The step is not complete and shows an unsatisfied clause + its hint.
    expect(container.querySelector("[data-lesson-runner]")?.getAttribute("data-complete")).toBe("false");
    const unsatisfied = container.querySelectorAll('[data-clause][data-clause-satisfied="false"]');
    expect(unsatisfied.length).toBeGreaterThan(0);
    const hint = container.querySelector("[data-step-hint]");
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? "").toContain("resistor pin");
  });

  it("shows an ERC floating-pin issue as a non-blocking warning", async () => {
    const { container } = render(withTheme(<StudentRunnerPanel lesson={sevenSegLesson()} debounceMs={0} />));

    // Resistor correct → step 2 passes, but display segments b–g dangle → ERC warning.
    setSchematic(withResistor(330));
    await waitFor(() => expect(activeStepId(container)).toBe("s3-ground"));

    // Step 2 passed (advanced) even though the display still has floating pins…
    const step2 = container.querySelector('[data-lesson-step="s2-resistor-a"]');
    expect(step2?.getAttribute("data-step-status")).toBe("passed");
    // …and the floating-pin issue is surfaced as an inline, non-blocking warning.
    const warnings = container.querySelectorAll("[data-step-warning]");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not render step controls in the plain instruction text markup as ERC codes", async () => {
    const { container } = render(withTheme(<StudentRunnerPanel lesson={sevenSegLesson()} debounceMs={0} />));
    setSchematic(withResistor(1000));
    await waitFor(() => expect(activeStepId(container)).toBe("s2-resistor-a"));
    // No raw ERC_ machine codes ever leak into the student-facing panel.
    expect(container.textContent ?? "").not.toMatch(/ERC_[A-Z_]+/);
  });
});
