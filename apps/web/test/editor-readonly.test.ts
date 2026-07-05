import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getComponent } from "@openbench/registry";
import { resetEditorState, useEditorStore } from "../lib/editor/store";
import { createFromTemplate } from "../lib/templates";

const resistor = getComponent("cmp_resistor_generic")!;

describe("editor read-only mode (share / embed)", () => {
  beforeEach(() => resetEditorState());
  afterEach(() => resetEditorState());

  it("defaults to editable (readOnly false)", () => {
    expect(useEditorStore.getState().readOnly).toBe(false);
    useEditorStore.setState({ bundle: createFromTemplate("basic-led", "Editable") });
    const before = useEditorStore.getState().bundle!.schematic;
    useEditorStore.getState().place(resistor, { x: 40, y: 40 });
    expect(useEditorStore.getState().bundle!.schematic).not.toBe(before);
  });

  it("loadShared hydrates a read-only bundle and disables mutation entry points", () => {
    const bundle = createFromTemplate("basic-led", "Shared");
    useEditorStore.getState().loadShared(bundle);
    expect(useEditorStore.getState().readOnly).toBe(true);
    expect(useEditorStore.getState().bundle).not.toBeNull();

    const before = useEditorStore.getState().bundle!.schematic;
    // Every mutation entry point is a no-op on the IR while read-only.
    useEditorStore.getState().place(resistor, { x: 40, y: 40 });
    useEditorStore.getState().setSelection(["R1"]);
    useEditorStore.getState().rotateSelection();
    useEditorStore.getState().setParameter("R1", "resistance", 999);
    useEditorStore.getState().removeSelection();
    useEditorStore.getState().renameProject("Hacked");

    const after = useEditorStore.getState().bundle!.schematic;
    expect(after).toBe(before);
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useEditorStore.getState().bundle!.project.name).toBe("Shared");
  });
});
