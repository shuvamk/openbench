// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { createFromTemplate } from "../lib/templates";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { LessonPanel } from "../components/lesson/LessonPanel";

/**
 * Issue #163 — mounting the teaching panels into the editor chrome. The
 * LessonPanel self-gates on the editor store's `teachingOpen` flag (like
 * ErcPanel/SimPanel self-hide) so the editor page mounts it unconditionally,
 * and exposes both the author (LessonAuthorPanel) and student
 * (StudentRunnerPanel) views against the live editor store, toggled in place.
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
const sch = (instances: Schematic["instances"]): Schematic => ({
  irVersion: IR_VERSION,
  kind: "schematic",
  id: "sch_lp",
  projectId: "proj_lp",
  instances,
  nets: [],
  provenance: { source: "test", at: AT },
});

const V1 = { instanceId: "V1", componentId: "cmp_vsource_dc" } as const;

/** Seed a live editor build with a little history so steps derive. */
function seedBuild() {
  resetEditorState();
  const bundle = createFromTemplate("rc-lowpass", "Teaching demo");
  useEditorStore.setState({
    bundle: { ...bundle, schematic: sch([V1]) },
    past: [sch([])],
  });
}

function withTheme(node: React.ReactElement) {
  return <Theme theme={neutralTheme}>{node}</Theme>;
}

describe("LessonPanel (editor teaching chrome)", () => {
  beforeEach(seedBuild);
  afterEach(cleanup);

  it("renders nothing while the teaching panel is closed", () => {
    useEditorStore.setState({ teachingOpen: false });
    const { container } = render(withTheme(<LessonPanel />));
    expect(container.querySelector("[data-testid='lesson-author']")).toBeNull();
    expect(container.querySelector("[data-lesson-runner]")).toBeNull();
  });

  it("shows the author panel by default when opened", () => {
    useEditorStore.setState({ teachingOpen: true });
    const { container } = render(withTheme(<LessonPanel />));
    expect(container.querySelector("[data-testid='lesson-author']")).not.toBeNull();
    expect(container.querySelector("[data-lesson-runner]")).toBeNull();
  });

  it("toggles to the student runner and back, against the live editor store", () => {
    useEditorStore.setState({ teachingOpen: true });
    const { container } = render(withTheme(<LessonPanel />));

    fireEvent.click(screen.getByRole("button", { name: /student/i }));
    expect(container.querySelector("[data-lesson-runner]")).not.toBeNull();
    expect(container.querySelector("[data-testid='lesson-author']")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /author/i }));
    expect(container.querySelector("[data-testid='lesson-author']")).not.toBeNull();
    expect(container.querySelector("[data-lesson-runner]")).toBeNull();
  });
});
