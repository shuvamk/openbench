/**
 * @openbench/mcp-kicad — KiCad engine adapter (issue #8, Phase 1).
 *
 * `.kicad_sch` S-expressions ↔ schematic IR, flat single sheet only.
 * Pure TS, no kicad-cli dependency.
 *
 * Mapping (export):
 *   - instance → `(symbol …)` with property "Reference" = instanceId,
 *     property "Value" = primary parameter value or component name,
 *     property "x_openbench_component" = componentId; position from
 *     `schematic.layout` (default 0,0).
 *   - net → one `(global_label "<netName>" …)` per connection, placed at the
 *     connected instance's position; the exact connection list is stored in a
 *     top-level `(x_openbench_nets "<json>")` escape hatch so import
 *     reconstructs nets EXACTLY.
 *   - parameterOverrides → property "x_openbench_params" (JSON), emitted only
 *     when the instance declares overrides (absence round-trips too).
 *   - per-instance layout entry → property "x_openbench_layout" (JSON).
 *
 * Import reads the x_openbench_* metadata when present (lossless round-trip,
 * modulo provenance: provenance is REGENERATED on import — source
 * "mcp-kicad", `at` = import time). Foreign KiCad files (no metadata) are
 * imported heuristically: instances from symbols (componentId derived from
 * lib_id), nets from distinct global_label names (pin-level connectivity is
 * unknowable without the escape hatch, so connections stay empty), layout
 * from symbol positions. Everything skipped or guessed produces a warning.
 */
import {
  IR_VERSION,
  validateSchematic,
  type Net,
  type Schematic,
  type SchematicInstance,
  type ValidationError,
  type ValidationResult,
} from "@openbench/ir-schema";
import { isSym, parse, serialize, sym, SExprParseError, type SExpr } from "./sexpr";

export interface ImportSuccess {
  ok: true;
  schematic: Schematic;
  warnings: string[];
}

export interface ImportFailure {
  ok: false;
  errors: ValidationError[];
}

export type ImportResult = ImportSuccess | ImportFailure;

export interface ExportOptions {
  /** ISO-8601 timestamp stamped into the file metadata; defaults to now. */
  now?: string;
}

const GENERATOR = "openbench-mcp-kicad";
const KICAD_FILE_VERSION = 20231120;

type Rotation = 0 | 90 | 180 | 270;
interface LayoutEntry {
  x: number;
  y: number;
  rotation?: Rotation;
}

// ---------------------------------------------------------------------------
// small S-expression navigation helpers
// ---------------------------------------------------------------------------

const isList = (expr: SExpr): expr is SExpr[] => Array.isArray(expr);

const headIs = (expr: SExpr, name: string): expr is SExpr[] =>
  isList(expr) && expr.length > 0 && isSym(expr[0]!) && expr[0].sym === name;

const childLists = (node: SExpr[], name: string): SExpr[][] =>
  node.filter((entry): entry is SExpr[] => headIs(entry, name));

const childList = (node: SExpr[], name: string): SExpr[] | undefined =>
  childLists(node, name)[0];

const stringAt = (node: SExpr[], index: number): string | undefined => {
  const value = node[index];
  return typeof value === "string" ? value : undefined;
};

const numberAt = (node: SExpr[], index: number): number | undefined => {
  const value = node[index];
  return typeof value === "number" ? value : undefined;
};

/** Read `(property "<key>" "<value>" …)` from a symbol node. */
const getProperty = (symbolNode: SExpr[], key: string): string | undefined => {
  for (const property of childLists(symbolNode, "property")) {
    if (property[1] === key && typeof property[2] === "string") return property[2];
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// deterministic ids (export must be reproducible for a fixed `now`)
// ---------------------------------------------------------------------------

const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const deterministicUuid = (seed: string): string => {
  const hex = ["a", "b", "c", "d"]
    .map((salt) => fnv1a(`${salt}:${seed}`).toString(16).padStart(8, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const HEX = "0123456789abcdef";
const randomHex = (length: number): string =>
  Array.from({ length }, () => HEX[Math.floor(Math.random() * 16)]).join("");

// ---------------------------------------------------------------------------
// export: schematic IR → .kicad_sch
// ---------------------------------------------------------------------------

const primaryValue = (instance: SchematicInstance): string => {
  const overrides = instance.parameterOverrides;
  if (overrides) {
    const first = Object.values(overrides)[0];
    if (first !== undefined) return String(first);
  }
  return instance.componentId.replace(/^cmp_/, "");
};

const positionOf = (schematic: Schematic, instanceId: string): LayoutEntry => {
  const entry = schematic.layout?.instances[instanceId];
  return entry ?? { x: 0, y: 0 };
};

const atNode = (entry: LayoutEntry): SExpr[] => [
  sym("at"),
  entry.x,
  entry.y,
  entry.rotation ?? 0,
];

const propertyNode = (key: string, value: string, entry: LayoutEntry): SExpr[] => [
  sym("property"),
  key,
  value,
  [sym("at"), entry.x, entry.y, 0],
];

const symbolNode = (schematic: Schematic, instance: SchematicInstance): SExpr[] => {
  const layoutEntry = schematic.layout?.instances[instance.instanceId];
  const position = layoutEntry ?? { x: 0, y: 0 };
  const node: SExpr[] = [
    sym("symbol"),
    [sym("lib_id"), `OpenBench:${instance.componentId}`],
    atNode(position),
    [sym("unit"), 1],
    [sym("in_bom"), sym("yes")],
    [sym("on_board"), sym("yes")],
    [sym("uuid"), deterministicUuid(`${schematic.id}/${instance.instanceId}`)],
    propertyNode("Reference", instance.instanceId, position),
    propertyNode("Value", primaryValue(instance), position),
    propertyNode("x_openbench_component", instance.componentId, position),
  ];
  if (instance.parameterOverrides !== undefined) {
    node.push(
      propertyNode("x_openbench_params", JSON.stringify(instance.parameterOverrides), position),
    );
  }
  if (layoutEntry !== undefined) {
    node.push(propertyNode("x_openbench_layout", JSON.stringify(layoutEntry), position));
  }
  return node;
};

const globalLabelNodes = (schematic: Schematic, net: Net): SExpr[][] =>
  net.connections.map((connection, index) => {
    const position = positionOf(schematic, connection.instanceId);
    return [
      sym("global_label"),
      net.name ?? net.netId,
      [sym("shape"), sym("input")],
      [sym("at"), position.x, position.y, 0],
      [sym("uuid"), deterministicUuid(`${schematic.id}/${net.netId}/${index}`)],
    ];
  });

/**
 * Serialize a schematic IR document to a minimal, flat, single-sheet
 * `.kicad_sch`. Deterministic for a fixed `opts.now`. Throws on a schematic
 * that fails IR validation.
 */
export function exportSchematic(schematic: Schematic, opts?: ExportOptions): string {
  const validation = validateSchematic(schematic);
  if (!validation.valid) {
    const detail = validation.errors
      .map((error) => `${error.path || "<root>"}: ${error.message}`)
      .join("; ");
    throw new Error(`invalid schematic: ${detail}`);
  }
  const now = opts?.now ?? new Date().toISOString();
  const meta = {
    irVersion: schematic.irVersion,
    id: schematic.id,
    projectId: schematic.projectId,
    exportedAt: now,
  };
  const document: SExpr[] = [
    sym("kicad_sch"),
    [sym("version"), KICAD_FILE_VERSION],
    [sym("generator"), GENERATOR],
    [sym("uuid"), deterministicUuid(schematic.id)],
    [sym("paper"), "A4"],
    [sym("x_openbench_schematic"), JSON.stringify(meta)],
    ...schematic.instances.map((instance) => symbolNode(schematic, instance)),
    ...schematic.nets.flatMap((net) => globalLabelNodes(schematic, net)),
    [sym("x_openbench_nets"), JSON.stringify(schematic.nets)],
  ];
  return `${serialize(document)}\n`;
}

// ---------------------------------------------------------------------------
// import: .kicad_sch → schematic IR
// ---------------------------------------------------------------------------

const fail = (path: string, message: string): ImportFailure => ({
  ok: false,
  errors: [{ path, message }],
});

const sanitizeComponentId = (libId: string): string => {
  const body = libId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `cmp_${body || "unknown"}`;
};

const sanitizeNetToken = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseJson = (
  text: string,
  path: string,
  errors: ValidationError[],
): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    errors.push({ path, message: `invalid JSON in ${path}` });
    return undefined;
  }
};

const readSymbolPosition = (
  symbolNode: SExpr[],
  reference: string,
  warnings: string[],
): LayoutEntry | undefined => {
  const at = childList(symbolNode, "at");
  if (!at) return undefined;
  const x = numberAt(at, 1);
  const y = numberAt(at, 2);
  if (x === undefined || y === undefined) return undefined;
  const entry: LayoutEntry = { x, y };
  const angle = numberAt(at, 3) ?? 0;
  if (angle === 90 || angle === 180 || angle === 270) {
    entry.rotation = angle;
  } else if (angle !== 0) {
    warnings.push(
      `symbol "${reference}": rotation ${angle} is not one of 0/90/180/270 — dropped`,
    );
  }
  return entry;
};

/**
 * Parse a `.kicad_sch` file into a schematic IR document. Never throws:
 * malformed input yields `{ ok: false, errors: [{ path, message }] }`.
 *
 * Provenance is regenerated on import (`source: "mcp-kicad"`, `at`: import
 * time) — callers comparing round-tripped documents must normalize it.
 */
export function importSchematic(kicadSch: string): ImportResult {
  try {
    let root: SExpr;
    try {
      root = parse(kicadSch);
    } catch (error) {
      const message =
        error instanceof SExprParseError
          ? error.message
          : `unreadable file: ${String(error)}`;
      return fail("", message);
    }
    if (!headIs(root, "kicad_sch")) {
      return fail("", "not a kicad_sch document: expected a (kicad_sch …) top-level form");
    }
    return buildSchematic(root);
  } catch (error) {
    // belt-and-braces: the adapter contract forbids throwing
    return fail("", `internal adapter error: ${String(error)}`);
  }
}

function buildSchematic(root: SExpr[]): ImportResult {
  const warnings: string[] = [];
  const errors: ValidationError[] = [];

  // --- mode: our own files carry an x_openbench_schematic metadata node ---
  const metaNode = childList(root, "x_openbench_schematic");
  let irVersion = IR_VERSION;
  let id: string | undefined;
  let projectId: string | undefined;
  if (metaNode) {
    const metaText = stringAt(metaNode, 1);
    const meta =
      metaText === undefined
        ? (errors.push({
            path: "x_openbench_schematic",
            message: "x_openbench_schematic must carry a quoted JSON string",
          }),
          undefined)
        : parseJson(metaText, "x_openbench_schematic", errors);
    if (meta !== undefined && typeof meta === "object" && meta !== null) {
      const record = meta as Record<string, unknown>;
      if (typeof record.irVersion === "string") irVersion = record.irVersion;
      if (typeof record.id === "string") id = record.id;
      if (typeof record.projectId === "string") projectId = record.projectId;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const openbenchMode = metaNode !== undefined;

  // --- instances from (symbol …) nodes ---
  const instances: SchematicInstance[] = [];
  const layoutInstances: Record<string, LayoutEntry> = {};
  const seenReferences = new Set<string>();
  childLists(root, "symbol").forEach((symbolNode, index) => {
    const reference = getProperty(symbolNode, "Reference");
    if (reference === undefined || reference.length === 0) {
      warnings.push(`symbol #${index + 1} skipped: no "Reference" property`);
      return;
    }
    if (seenReferences.has(reference)) {
      warnings.push(`symbol "${reference}" skipped: duplicate Reference`);
      return;
    }
    seenReferences.add(reference);

    let componentId = getProperty(symbolNode, "x_openbench_component");
    if (componentId === undefined) {
      const libId = stringAt(childList(symbolNode, "lib_id") ?? [], 1);
      componentId = sanitizeComponentId(libId ?? "");
      warnings.push(
        `symbol "${reference}": no x_openbench_component metadata — componentId "${componentId}" derived from lib_id "${libId ?? "<missing>"}"`,
      );
    }

    const instance: SchematicInstance = { instanceId: reference, componentId };
    const paramsText = getProperty(symbolNode, "x_openbench_params");
    if (paramsText !== undefined) {
      const params = parseJson(paramsText, `instances.${index}.parameterOverrides`, errors);
      if (params !== undefined) {
        instance.parameterOverrides = params as SchematicInstance["parameterOverrides"];
      }
    }
    instances.push(instance);

    if (openbenchMode) {
      // exact layout comes only from the per-instance escape hatch
      const layoutText = getProperty(symbolNode, "x_openbench_layout");
      if (layoutText !== undefined) {
        const entry = parseJson(layoutText, `layout.instances.${reference}`, errors);
        if (entry !== undefined) layoutInstances[reference] = entry as LayoutEntry;
      }
    } else {
      const entry = readSymbolPosition(symbolNode, reference, warnings);
      if (entry !== undefined) layoutInstances[reference] = entry;
    }
  });

  // --- nets: exact from the escape hatch, else heuristic from labels ---
  let nets: Net[] = [];
  const netsNode = childList(root, "x_openbench_nets");
  const netsText = netsNode ? stringAt(netsNode, 1) : undefined;
  if (netsText !== undefined) {
    const parsed = parseJson(netsText, "nets", errors);
    if (Array.isArray(parsed)) {
      nets = parsed as Net[];
    } else if (parsed !== undefined) {
      errors.push({ path: "nets", message: "x_openbench_nets must be a JSON array" });
    }
  } else {
    const labels = childLists(root, "global_label");
    const seenNames = new Map<string, string>(); // name → netId
    labels.forEach((label, index) => {
      const name = stringAt(label, 1);
      if (name === undefined || name.length === 0) {
        warnings.push(`global_label #${index + 1} skipped: no name`);
        return;
      }
      if (seenNames.has(name)) return;
      let netId = `net_${sanitizeNetToken(name) || `label_${index}`}`;
      while ([...seenNames.values()].includes(netId)) netId = `${netId}_`;
      seenNames.set(name, netId);
      nets.push({ netId, name, connections: [] });
    });
    if (labels.length > 0) {
      warnings.push(
        "nets reconstructed from global_label names only: pin-level connectivity cannot be recovered without x_openbench_nets metadata — connections left empty",
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // --- ids (foreign files: derive or generate, with warnings) ---
  if (id === undefined) {
    const fileUuid = stringAt(childList(root, "uuid") ?? [], 1)?.toLowerCase();
    if (fileUuid !== undefined && /^[a-z0-9_-]+$/.test(fileUuid)) {
      id = `sch_${fileUuid}`;
    } else {
      id = `sch_${randomHex(32)}`;
      warnings.push(`no usable uuid in file — generated schematic id "${id}"`);
    }
  }
  if (projectId === undefined) {
    projectId = `proj_${randomHex(32)}`;
    warnings.push(
      `no x_openbench_schematic metadata — generated projectId "${projectId}"`,
    );
  }

  const schematic: Schematic = {
    irVersion,
    kind: "schematic",
    id,
    projectId,
    instances,
    nets,
    // provenance is regenerated on every import (documented lossy field)
    provenance: { source: "mcp-kicad", at: new Date().toISOString() },
  };
  if (Object.keys(layoutInstances).length > 0) {
    schematic.layout = { instances: layoutInstances };
  }

  const validation = validateSchematic(schematic);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  return { ok: true, schematic, warnings };
}

/** Adapter contract `validate` — delegates to the canonical IR schema. */
export function validate(doc: unknown): ValidationResult {
  return validateSchematic(doc);
}

export { parse, serialize, sym, isSym, SExprParseError } from "./sexpr";
export type { SExpr, SExprAtom, SExprSymbol } from "./sexpr";
