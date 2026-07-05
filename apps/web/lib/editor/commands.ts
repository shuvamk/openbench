import type { Component } from "@openbench/ir-schema";
import { registryComponents } from "@openbench/registry";
import type { SearchableItem } from "@astryxdesign/core/Typeahead";
import { categoryLabel } from "./palette-filter";

/** Group headings the palette renders (and auto-groups by). */
export const ACTIONS_GROUP = "Actions";
export const ADD_COMPONENT_GROUP = "Add component";

/**
 * A single keyboard-first action, decoupled from React so the command list is
 * pure and unit-testable. `run()` calls back into injected store actions — the
 * very same mutations the palette-less UI already dispatches.
 */
export interface EditorCommand {
  id: string;
  label: string;
  group: string;
  /** Extra search terms (aliases) matched alongside the label. */
  keywords: string[];
  /** For add-component commands: the registry part this command places. */
  componentId?: string;
  run: () => void;
}

/**
 * The store/navigation actions the palette drives. Injected (rather than
 * imported) so `buildEditorCommands` stays pure and the wrapper decides how
 * each one binds to the live stores (e.g. the drop position for `place`).
 */
export interface EditorCommandDeps {
  /** Place a part on the canvas — bound by the wrapper to store.place at a
   *  default drop point, identical to the click-then-place UI path. */
  place: (component: Component) => void;
  runSimulation: () => void;
  toggleLive: () => void;
  checkErc: () => void;
  undo: () => void;
  redo: () => void;
  exportProject: () => void;
  importProject: () => void;
  openProjects: () => void;
}

/** Search terms hidden in a part id, e.g. `cmp_nmos_2n7000` → "nmos 2n7000". */
function componentKeywords(component: Component): string[] {
  const idWords = component.id.replace(/^cmp_/, "").replace(/_/g, " ");
  return [component.category, categoryLabel(component.category), idWords];
}

/**
 * Build the full command list: the fixed action commands followed by one
 * "Add <part>" command per registry component. New registry parts appear
 * automatically because the list is derived from `registryComponents`.
 */
export function buildEditorCommands(deps: EditorCommandDeps): EditorCommand[] {
  const actions: EditorCommand[] = [
    {
      id: "run-simulation",
      label: "Run simulation",
      group: ACTIONS_GROUP,
      keywords: ["run", "simulate", "spice", "play"],
      run: deps.runSimulation,
    },
    {
      id: "toggle-live",
      label: "Toggle Live mode",
      group: ACTIONS_GROUP,
      keywords: ["live", "design", "interactive", "play", "toggle"],
      run: deps.toggleLive,
    },
    {
      id: "check-erc",
      label: "Check electrical rules (ERC)",
      group: ACTIONS_GROUP,
      keywords: ["erc", "errors", "rules", "validate", "check", "issues"],
      run: deps.checkErc,
    },
    {
      id: "undo",
      label: "Undo",
      group: ACTIONS_GROUP,
      keywords: ["history", "back", "revert"],
      run: deps.undo,
    },
    {
      id: "redo",
      label: "Redo",
      group: ACTIONS_GROUP,
      keywords: ["history", "forward", "repeat"],
      run: deps.redo,
    },
    {
      id: "export-kicad",
      label: "Export .kicad_sch",
      group: ACTIONS_GROUP,
      keywords: ["export", "download", "kicad", "save"],
      run: deps.exportProject,
    },
    {
      id: "import-schematic",
      label: "Import schematic…",
      group: ACTIONS_GROUP,
      keywords: ["import", "open", "upload", "kicad"],
      run: deps.importProject,
    },
    {
      id: "open-project",
      label: "Open project…",
      group: ACTIONS_GROUP,
      keywords: ["open", "project", "projects", "switch"],
      run: deps.openProjects,
    },
  ];

  const addComponent: EditorCommand[] = registryComponents.map((component) => ({
    id: `add:${component.id}`,
    label: `Add ${component.name}`,
    group: ADD_COMPONENT_GROUP,
    keywords: ["add", "place", ...componentKeywords(component)],
    componentId: component.id,
    run: () => deps.place(component),
  }));

  return [...actions, ...addComponent];
}

/** Auxiliary payload carried on each palette search item. */
export interface CommandItemAux {
  group: string;
  keywords: string[];
}

/**
 * Adapt commands to Astryx `SearchableItem`s. `auxiliaryData.group` drives the
 * palette's auto-grouping; `keywords` feed the static source's alias matching.
 */
export function commandSearchItems(
  commands: EditorCommand[],
): SearchableItem<CommandItemAux>[] {
  return commands.map((command) => ({
    id: command.id,
    label: command.label,
    auxiliaryData: { group: command.group, keywords: command.keywords },
  }));
}
