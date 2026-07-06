import { IR_VERSION, type Project, type ProjectBundle, type Schematic } from "@openbench/ir-schema";

/** Options for {@link createProject}; all default to fresh random ids / now. */
export interface CreateProjectOptions {
  /** Explicit `proj_…` id (else a random one is minted) — for deterministic tests. */
  projectId?: string;
  /** Explicit `sch_…` id (else a random one is minted). */
  schematicId?: string;
  /** ISO-8601 stamp for `provenance.at` (else the current time). */
  now?: string;
  /** `provenance.source` for both documents (else "schematic-ops"). */
  source?: string;
}

function randomSuffix(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID().replace(/-/g, "");
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 24; i++) suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return suffix;
}

/**
 * Mint a fresh, valid {@link ProjectBundle} with an empty schematic — the thin
 * shared factory both the in-app copilot and the agent-control MCP server start
 * new projects through (spike #33 §5, ADR-0019). Pure: inject `projectId` /
 * `schematicId` / `now` for deterministic output; otherwise ids are random and
 * the clock is `Date.now()`.
 */
export function createProject(name: string, opts: CreateProjectOptions = {}): ProjectBundle {
  const projectId = opts.projectId ?? `proj_${randomSuffix()}`;
  const schematicId = opts.schematicId ?? `sch_${randomSuffix()}`;
  const at = opts.now ?? new Date().toISOString();
  const source = opts.source ?? "schematic-ops";
  const provenance = { source, at };

  const schematic: Schematic = {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: schematicId,
    projectId,
    instances: [],
    nets: [],
    provenance,
  };

  const project: Project = {
    irVersion: IR_VERSION,
    kind: "project",
    id: projectId,
    name,
    schematicId,
    collaborators: [],
    provenance,
  };

  return { project, schematic };
}
