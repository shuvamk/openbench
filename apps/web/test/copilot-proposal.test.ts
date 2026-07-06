import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IR_VERSION, type Schematic } from "@openbench/ir-schema";
import {
  __setProjectStoreModuleLoaderForTests,
  resetEditorState,
  useEditorStore,
  type ProjectStoreLike,
} from "../lib/editor/store";
import { createCopilot } from "../lib/copilot/engine";

/**
 * Issue #43 acceptance — a proposed copilot change is shown as a diff and is
 * NOT applied until accepted. Rejecting leaves the document unchanged; accepting
 * flows through the normal editor mutation stack and pushes exactly ONE undo
 * entry (undo reverts it).
 */

const AT = "2026-07-06T00:00:00Z";

function seedSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_prop",
    projectId: "proj_prop",
    instances: [{ instanceId: "V1", componentId: "cmp_vsource_dc" }],
    nets: [],
    provenance: { source: "frontend", at: AT },
  };
}

function makeBundle() {
  return {
    project: {
      irVersion: IR_VERSION,
      kind: "project" as const,
      id: "proj_prop",
      name: "Copilot proposal demo",
      schematicId: "sch_prop",
      collaborators: [],
      provenance: { source: "frontend", at: AT },
    },
    schematic: seedSchematic(),
  };
}

function installFakeStore() {
  const bundles = new Map([["proj_prop", makeBundle()]]);
  const store: ProjectStoreLike = {
    load: vi.fn(async (id: string) => bundles.get(id)),
    save: vi.fn(async () => {}),
  };
  __setProjectStoreModuleLoaderForTests(async () => ({
    getProjectStore: () => store,
    ensureSeeded: vi.fn(async () => {}),
  }));
}

describe("copilot proposal → editor mutation + undo stack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetEditorState();
    installFakeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("proposing does not touch the document; only accepting applies it", async () => {
    await useEditorStore.getState().loadProject("proj_prop");
    const before = useEditorStore.getState().bundle!.schematic;

    const copilot = createCopilot();
    const proposal = copilot.propose(before, "add a resistor")!;

    // Proposal computed, but the live document is untouched.
    expect(useEditorStore.getState().bundle!.schematic).toBe(before);
    expect(useEditorStore.getState().bundle!.schematic.instances).toHaveLength(1);
    expect(proposal.after.instances).toHaveLength(2);
  });

  it("rejecting a proposal leaves the document unchanged", async () => {
    await useEditorStore.getState().loadProject("proj_prop");
    const before = useEditorStore.getState().bundle!.schematic;
    const pastBefore = useEditorStore.getState().past.length;

    const copilot = createCopilot();
    copilot.propose(before, "add a resistor");
    // ...user rejects: we simply never call applySchematic.

    expect(useEditorStore.getState().bundle!.schematic).toBe(before);
    expect(useEditorStore.getState().past.length).toBe(pastBefore);
  });

  it("accepting pushes exactly one undo entry and undo reverts it", async () => {
    await useEditorStore.getState().loadProject("proj_prop");
    const before = useEditorStore.getState().bundle!.schematic;
    const pastBefore = useEditorStore.getState().past.length;

    const copilot = createCopilot();
    const proposal = copilot.propose(before, "add a resistor")!;

    useEditorStore.getState().applySchematic(proposal.after);

    // Applied through the normal mutation stack.
    const applied = useEditorStore.getState().bundle!.schematic;
    expect(applied).toBe(proposal.after);
    expect(applied.instances.map((i) => i.instanceId)).toContain("R1");

    // Exactly one new undo entry.
    expect(useEditorStore.getState().past.length).toBe(pastBefore + 1);

    // Undo reverts to the pre-proposal document.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().bundle!.schematic).toBe(before);
    expect(useEditorStore.getState().bundle!.schematic.instances).toHaveLength(1);
  });
});
