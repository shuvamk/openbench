import {
  IR_VERSION,
  validateSchematic,
  type Net,
  type Project,
  type Schematic,
  type ValidationError,
} from "@openbench/ir-schema";
import { exportSchematic, importSchematic } from "@openbench/mcp-kicad";
import { getComponent } from "@openbench/registry";
import type { ProjectBundle } from "../project-store/types";

/**
 * KiCad import/export for the UI (issue #19). Pure functions — the browser
 * glue (Blob downloads, dialogs) lives in the components that call these.
 *
 * Export delegates to the @openbench/mcp-kicad adapter; import additionally
 * screens every instance against the @openbench/registry: an instance whose
 * componentId does not resolve via `getComponent` is dropped (with its net
 * connections and layout entry) and surfaced as a warning, because the
 * editor cannot render or simulate parts outside the curated registry.
 */

export interface KicadExport {
  filename: string;
  text: string;
}

export type KicadImportResult =
  | { ok: true; bundle: ProjectBundle; warnings: string[] }
  | { ok: false; errors: ValidationError[] };

/** Slug a project name into `<slug>.kicad_sch` (same rules as .openbench.json export). */
function kicadFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "project" : slug}.kicad_sch`;
}

/** Serialize a bundle's schematic as a `.kicad_sch` download payload. */
export function exportProjectToKicad(bundle: ProjectBundle): KicadExport {
  return {
    filename: kicadFileName(bundle.project.name),
    text: exportSchematic(bundle.schematic),
  };
}

/** Fresh IR id: `<prefix>_` + 32 lowercase hex chars. */
const freshId = (prefix: "proj" | "sch"): string =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

/**
 * Parse a `.kicad_sch` payload into a fresh, saveable ProjectBundle named
 * `name`. Never throws; malformed input yields `{ ok: false, errors }`.
 *
 * Instances are kept only when their componentId (from x_openbench metadata
 * or derived from lib_id by the adapter) resolves in the registry; every
 * dropped instance produces a `skipped <instanceId>: unknown component
 * <componentId>` warning and its connections/layout entry are removed.
 * A brand-new project document is minted (provenance source "kicad-import").
 */
export function importKicadToBundle(text: string, name: string): KicadImportResult {
  const imported = importSchematic(text);
  if (!imported.ok) {
    return { ok: false, errors: imported.errors };
  }
  const warnings = [...imported.warnings];

  // --- registry screening: drop instances the registry cannot resolve ---
  const kept = new Set<string>();
  const instances = imported.schematic.instances.filter((instance) => {
    if (getComponent(instance.componentId) === undefined) {
      warnings.push(
        `skipped ${instance.instanceId}: unknown component ${instance.componentId}`,
      );
      return false;
    }
    kept.add(instance.instanceId);
    return true;
  });

  const nets: Net[] = imported.schematic.nets.map((net) => ({
    ...net,
    connections: net.connections.filter((connection) => kept.has(connection.instanceId)),
  }));

  const layoutEntries = Object.entries(imported.schematic.layout?.instances ?? {}).filter(
    ([instanceId]) => kept.has(instanceId),
  );

  // --- fresh documents with kicad-import provenance on the project ---
  const projectId = freshId("proj");
  const at = new Date().toISOString();

  const schematic: Schematic = {
    ...imported.schematic,
    projectId,
    instances,
    nets,
  };
  delete schematic.layout;
  if (layoutEntries.length > 0) {
    schematic.layout = { instances: Object.fromEntries(layoutEntries) };
  }

  const validation = validateSchematic(schematic);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  const project: Project = {
    irVersion: IR_VERSION,
    kind: "project",
    id: projectId,
    name,
    schematicId: schematic.id,
    collaborators: [],
    provenance: { source: "kicad-import", at },
  };

  return { ok: true, bundle: { project, schematic }, warnings };
}
