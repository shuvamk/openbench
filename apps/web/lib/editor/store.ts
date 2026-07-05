import { create } from "zustand";
import type { Component, NetConnection } from "@openbench/ir-schema";
import type { ProjectBundle } from "../project-store";
import {
  connectPins,
  deleteSelection,
  moveInstance,
  placeInstance,
  rotateInstance,
  setParameterOverride,
  type Point,
} from "./mutations";
import { addProbe as addProbeMutation, removeProbe as removeProbeMutation } from "./probes";

// Pure mutation helpers are re-exported so tests (and the sim/panel agents)
// can drive schematic edits without going through the store singleton.
export {
  connectPins,
  deleteSelection,
  moveInstance,
  placeInstance,
  rotateInstance,
  setParameterOverride,
  snapToGrid,
  refPrefix,
  GRID,
  type PlaceResult,
  type Point,
} from "./mutations";
export { activeProbeNetIds, addProbe, isNetProbed, removeProbe } from "./probes";

export type EditorTool = "select" | "place" | "wire" | "probe";

export interface WireDraft {
  from: { instanceId: string; pinId: string };
  cursor: Point;
}

/** Minimal slice of the dashboard's ProjectStore the editor needs. */
export interface ProjectStoreLike {
  load(projectId: string): Promise<ProjectBundle | undefined>;
  save(bundle: ProjectBundle): Promise<void>;
}

interface ProjectStoreModuleLike {
  getProjectStore(): ProjectStoreLike;
  ensureSeeded(store: ProjectStoreLike): Promise<unknown> | unknown;
}

/**
 * The project-store package is implemented by a parallel agent; we resolve it
 * lazily so the editor store stays testable before/without it, and tests can
 * inject an in-memory stub.
 */
let projectStoreModuleLoader: () => Promise<ProjectStoreModuleLike> = async () => {
  const mod = (await import("../project-store")) as unknown as ProjectStoreModuleLike;
  return mod;
};

export function __setProjectStoreModuleLoaderForTests(
  loader: () => Promise<ProjectStoreModuleLike>,
): void {
  projectStoreModuleLoader = loader;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const AUTOSAVE_DEBOUNCE_MS = 800;
/** Maximum number of undo snapshots kept (issue #18). */
export const HISTORY_LIMIT = 100;

type SchematicDoc = ProjectBundle["schematic"];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export interface EditorState {
  bundle: ProjectBundle | null;
  selection: string[];
  tool: EditorTool;
  placingComponentId?: string;
  wireDraft?: WireDraft;
  dirty: boolean;
  loading: boolean;
  loadError?: string;
  /**
   * True when the bundle was hydrated from a stateless share payload (issue #40).
   * Every IR mutation becomes a no-op — the embed/share view is view-only.
   */
  readOnly: boolean;
  zoom: number;
  pan: Point;
  /** Undo/redo stacks of schematic snapshots, newest last / next first. */
  past: SchematicDoc[];
  future: SchematicDoc[];

  loadProject(projectId: string): Promise<void>;
  /** Hydrate a read-only bundle decoded from a share/embed payload (issue #40). */
  loadShared(bundle: ProjectBundle): void;
  place(component: Component, position: Point): void;
  move(instanceId: string, position: Point): void;
  rotateSelection(): void;
  connect(a: NetConnection, b: NetConnection): void;
  removeSelection(): void;
  setParameter(
    instanceId: string,
    parameterName: string,
    value: number | string | boolean | undefined,
  ): void;
  /** Drop a scope probe on a net; snaps the marker and records history (issue #37). */
  addProbe(netId: string, position: Point, color?: string): void;
  /** Remove a scope probe by id. */
  removeProbe(probeId: string): void;
  renameProject(name: string): void;

  undo(): void;
  redo(): void;
  /**
   * Bracket a continuous pointer gesture (e.g. a drag-move) so every commit
   * inside it coalesces into a single history entry.
   */
  beginGesture(): void;
  endGesture(): void;

  setSelection(ids: string[]): void;
  addToSelection(id: string): void;
  setTool(tool: EditorTool, placingComponentId?: string): void;
  startWire(from: { instanceId: string; pinId: string }): void;
  moveWireCursor(cursor: Point): void;
  cancelWire(): void;

  setZoom(zoom: number): void;
  setView(zoom: number, pan: Point): void;
  setPan(pan: Point): void;

  flushSave(): Promise<void>;
}

const initialState = {
  bundle: null as ProjectBundle | null,
  selection: [] as string[],
  tool: "select" as EditorTool,
  placingComponentId: undefined,
  wireDraft: undefined,
  dirty: false,
  loading: false,
  loadError: undefined,
  readOnly: false,
  zoom: 1,
  pan: { x: 0, y: 0 },
  past: [] as SchematicDoc[],
  future: [] as SchematicDoc[],
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function clearSaveTimer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

// Gesture coalescing flags (module-level, like saveTimer, so
// resetEditorState can clear them between tests / project switches).
let gestureActive = false;
let gestureRecorded = false;

function resetGesture(): void {
  gestureActive = false;
  gestureRecorded = false;
}

/** Drop selected ids that do not exist in the (restored) schematic. */
function sanitizeSelection(selection: string[], schematic: SchematicDoc): string[] {
  const alive = new Set(schematic.instances.map((instance) => instance.instanceId));
  const kept = selection.filter((id) => alive.has(id));
  return kept.length === selection.length ? selection : kept;
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Apply an IR mutation, mark dirty, and (re)arm the autosave debounce. */
  function commitBundle(bundle: ProjectBundle): void {
    if (get().readOnly) return;
    set({ bundle, dirty: true });
    clearSaveTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Push the pre-mutation schematic onto the undo stack (bounded, clearing
   * any redo branch). Commits inside an active gesture record only once, so
   * a continuous drag-move undoes as a single step.
   */
  function recordHistory(previous: SchematicDoc): void {
    if (gestureActive) {
      if (gestureRecorded) return;
      gestureRecorded = true;
    }
    const nextPast = [...get().past, previous];
    if (nextPast.length > HISTORY_LIMIT) nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
    set({ past: nextPast, future: [] });
  }

  /** History-aware commit: no-op schematics don't dirty the store or the stack. */
  function commitSchematic(schematic: SchematicDoc): void {
    if (get().readOnly) return;
    const bundle = get().bundle;
    if (!bundle || schematic === bundle.schematic) return;
    recordHistory(bundle.schematic);
    commitBundle({ ...bundle, schematic });
  }

  return {
    ...initialState,

    async loadProject(projectId) {
      resetGesture();
      set({ loading: true, loadError: undefined });
      try {
        const mod = await projectStoreModuleLoader();
        const projectStore = mod.getProjectStore();
        await mod.ensureSeeded(projectStore);
        const bundle = await projectStore.load(projectId);
        if (!bundle) {
          set({ loading: false, bundle: null, loadError: `Project "${projectId}" not found` });
          return;
        }
        set({ ...initialState, bundle, loading: false });
      } catch (error) {
        set({
          loading: false,
          loadError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    loadShared(bundle) {
      resetGesture();
      clearSaveTimer();
      set({ ...initialState, bundle, readOnly: true, loading: false });
    },

    place(component, position) {
      const bundle = get().bundle;
      if (!bundle) return;
      const placed = placeInstance(bundle.schematic, component, position);
      set({ selection: [placed.instanceId], tool: "select", placingComponentId: undefined });
      commitSchematic(placed.schematic);
    },

    move(instanceId, position) {
      const bundle = get().bundle;
      if (!bundle) return;
      commitSchematic(moveInstance(bundle.schematic, instanceId, position));
    },

    rotateSelection() {
      const bundle = get().bundle;
      if (!bundle) return;
      let schematic = bundle.schematic;
      for (const instanceId of get().selection) {
        schematic = rotateInstance(schematic, instanceId);
      }
      if (schematic !== bundle.schematic) commitSchematic(schematic);
    },

    connect(a, b) {
      const bundle = get().bundle;
      if (!bundle) return;
      set({ wireDraft: undefined });
      const next = connectPins(bundle.schematic, a, b);
      if (next !== bundle.schematic) commitSchematic(next);
    },

    removeSelection() {
      const bundle = get().bundle;
      const selection = get().selection;
      if (!bundle || selection.length === 0) return;
      set({ selection: [] });
      commitSchematic(deleteSelection(bundle.schematic, selection));
    },

    setParameter(instanceId, parameterName, value) {
      const bundle = get().bundle;
      if (!bundle) return;
      commitSchematic(setParameterOverride(bundle.schematic, instanceId, parameterName, value));
    },

    addProbe(netId, position, color) {
      const bundle = get().bundle;
      if (!bundle) return;
      commitSchematic(addProbeMutation(bundle.schematic, netId, position, color));
    },

    removeProbe(probeId) {
      const bundle = get().bundle;
      if (!bundle) return;
      commitSchematic(removeProbeMutation(bundle.schematic, probeId));
    },

    renameProject(name) {
      const bundle = get().bundle;
      if (!bundle || name.trim().length === 0 || name === bundle.project.name) return;
      commitBundle({ ...bundle, project: { ...bundle.project, name } });
    },

    undo() {
      const { bundle, past, future, selection } = get();
      if (!bundle || past.length === 0) return;
      const snapshot = past[past.length - 1]!;
      set({
        past: past.slice(0, -1),
        future: [bundle.schematic, ...future].slice(0, HISTORY_LIMIT),
        selection: sanitizeSelection(selection, snapshot),
      });
      commitBundle({ ...bundle, schematic: snapshot });
    },

    redo() {
      const { bundle, past, future, selection } = get();
      if (!bundle || future.length === 0) return;
      const snapshot = future[0]!;
      const nextPast = [...past, bundle.schematic];
      if (nextPast.length > HISTORY_LIMIT) nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
      set({
        past: nextPast,
        future: future.slice(1),
        selection: sanitizeSelection(selection, snapshot),
      });
      commitBundle({ ...bundle, schematic: snapshot });
    },

    beginGesture() {
      gestureActive = true;
      gestureRecorded = false;
    },

    endGesture() {
      resetGesture();
    },

    setSelection(ids) {
      set({ selection: ids });
    },

    addToSelection(id) {
      const selection = get().selection;
      set({
        selection: selection.includes(id)
          ? selection.filter((existing) => existing !== id)
          : [...selection, id],
      });
    },

    setTool(tool, placingComponentId) {
      set({
        tool,
        placingComponentId: tool === "place" ? placingComponentId : undefined,
        wireDraft: undefined,
      });
    },

    startWire(from) {
      set({ wireDraft: { from, cursor: { x: 0, y: 0 } } });
    },

    moveWireCursor(cursor) {
      const draft = get().wireDraft;
      if (!draft) return;
      set({ wireDraft: { ...draft, cursor } });
    },

    cancelWire() {
      set({ wireDraft: undefined });
    },

    setZoom(zoom) {
      set({ zoom: clampZoom(zoom) });
    },

    setView(zoom, pan) {
      set({ zoom: clampZoom(zoom), pan });
    },

    setPan(pan) {
      set({ pan });
    },

    async flushSave() {
      const bundle = get().bundle;
      if (!bundle) return;
      clearSaveTimer();
      try {
        const mod = await projectStoreModuleLoader();
        await mod.getProjectStore().save(bundle);
        // Only clear dirty if nothing changed while the save was in flight.
        if (get().bundle === bundle) set({ dirty: false });
      } catch {
        // Keep dirty=true; the next mutation (or manual flush) retries.
      }
    },
  };
});

/** Reset the singleton store between tests / project switches. */
export function resetEditorState(): void {
  clearSaveTimer();
  resetGesture();
  useEditorStore.setState({ ...initialState });
}
