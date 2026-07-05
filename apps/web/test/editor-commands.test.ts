import { afterEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, type ProjectBundle } from "@openbench/ir-schema";
import { getComponent, registryComponents } from "@openbench/registry";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import {
  ADD_COMPONENT_GROUP,
  buildEditorCommands,
  commandSearchItems,
  type EditorCommandDeps,
} from "../lib/editor/commands";

const resistor = getComponent("cmp_resistor_generic")!;

/** A deps object whose actions are all no-op spies; individual tests override. */
function noopDeps(): EditorCommandDeps {
  return {
    place: vi.fn(),
    runSimulation: vi.fn(),
    toggleLive: vi.fn(),
    checkErc: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    exportProject: vi.fn(),
    importProject: vi.fn(),
    openProjects: vi.fn(),
  };
}

function makeBundle(): ProjectBundle {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project",
      id: "proj_cmd",
      name: "Command palette demo",
      schematicId: "sch_cmd",
      collaborators: [],
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
    schematic: {
      irVersion: IR_VERSION,
      kind: "schematic",
      id: "sch_cmd",
      projectId: "proj_cmd",
      instances: [],
      nets: [],
      layout: { instances: {} },
      provenance: { source: "frontend", at: "2026-07-05T00:00:00Z" },
    },
  };
}

describe("editor commands (model)", () => {
  afterEach(() => {
    resetEditorState();
    vi.restoreAllMocks();
  });

  it("generates exactly one add-component command per registry component", () => {
    const commands = buildEditorCommands(noopDeps());
    const addCommands = commands.filter((c) => c.group === ADD_COMPONENT_GROUP);

    // New parts appear automatically: the count tracks the registry length.
    expect(addCommands).toHaveLength(registryComponents.length);

    const targeted = new Set(addCommands.map((c) => c.componentId));
    for (const component of registryComponents) {
      expect(targeted.has(component.id)).toBe(true);
    }
  });

  it("exposes a 'Run simulation' action discoverable by typing 'run'", () => {
    const commands = buildEditorCommands(noopDeps());
    expect(commands.some((c) => c.label === "Run simulation")).toBe(true);

    // Fuzzy/substring search the way the palette filters (Astryx static source).
    const source = createStaticSource(commandSearchItems(commands), {
      keywords: (item) =>
        (item.auxiliaryData as { keywords?: string[] }).keywords ?? [],
    });
    const hits = source.search("run").map((item) => item.label);
    expect(hits).toContain("Run simulation");
    // A component isn't surfaced by "run".
    expect(hits.some((label) => label.startsWith("Add "))).toBe(false);
  });

  it("invoking Add Resistor dispatches the same IR mutation as the palette-less place path", () => {
    // Palette path: the add-component command routes through deps.place, which
    // the wrapper binds to store.place — identical to clicking a part + placing.
    resetEditorState();
    useEditorStore.setState({ bundle: makeBundle() });
    const drop = { x: 200, y: 160 };
    const deps: EditorCommandDeps = {
      ...noopDeps(),
      place: (component) => useEditorStore.getState().place(component, drop),
    };
    const commands = buildEditorCommands(deps);
    const addResistor = commands.find((c) => c.componentId === resistor.id);
    expect(addResistor).toBeDefined();
    addResistor!.run();
    const viaPalette = useEditorStore.getState().bundle!.schematic;

    // Reference path: place the same part at the same point directly.
    resetEditorState();
    useEditorStore.setState({ bundle: makeBundle() });
    useEditorStore.getState().place(resistor, drop);
    const viaDirect = useEditorStore.getState().bundle!.schematic;

    expect(viaPalette.instances).toEqual(viaDirect.instances);
    expect(viaPalette.layout).toEqual(viaDirect.layout);
    expect(viaPalette.instances).toHaveLength(1);
    expect(viaPalette.instances[0]!.componentId).toBe(resistor.id);
  });

  it("calls the injected action when an action command runs", () => {
    const deps = noopDeps();
    const commands = buildEditorCommands(deps);
    commands.find((c) => c.label === "Run simulation")!.run();
    expect(deps.runSimulation).toHaveBeenCalledTimes(1);
  });
});
