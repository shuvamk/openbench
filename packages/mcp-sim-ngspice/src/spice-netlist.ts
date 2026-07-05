/**
 * @openbench/mcp-sim-ngspice — SPICE netlist (.cir/.net) adapter (issue #41).
 *
 * A flat SPICE deck ↔ netlist IR. Reuses the standard adapter contract shape
 * (`import`/`export`/`validate` + round-trip) and the KiCad adapter's
 * foreign-file escape-hatch pattern.
 *
 * Mapping (export):
 *   - Every `netlist.elements[].spiceCard` is emitted verbatim, in order, as a
 *     deck body line (`.model` / `.subckt … .ends` blocks included, since the
 *     compiler stores those as elements too), then a terminating `.end`.
 *   - The full structured netlist (minus provenance) is embedded once in a
 *     `* x_openbench_netlist <json>` comment so re-import is EXACT — the deck
 *     body alone loses the netId ↔ spiceNode mapping (a flat deck only carries
 *     bare SPICE node numbers).
 *
 * Import reads the `x_openbench_netlist` escape hatch when present (lossless
 * round-trip, modulo provenance: provenance is REGENERATED on import — source
 * "mcp-sim-spice", `at` = import time). A foreign deck (no escape hatch) is
 * parsed heuristically: R/C/L/V/I/D/Q/M device cards → elements keyed by their
 * ref, `.model` / `.subckt` blocks → elements, SPICE nodes collected from the
 * device cards' node positions. Any element card whose device letter is not
 * recognized is preserved verbatim as an `x_openbench_raw_<n>` element and a
 * warning is emitted (never dropped, never thrown).
 */
import {
  IR_VERSION,
  validateNetlist,
  type Netlist,
  type NetlistElement,
  type NetlistNode,
  type ValidationError,
  type ValidationResult,
} from "@openbench/ir-schema";
import { NgspiceAdapterError } from "./deck";

export interface ImportSuccess {
  ok: true;
  netlist: Netlist;
  warnings: string[];
}

export interface ImportFailure {
  ok: false;
  errors: ValidationError[];
}

export type ImportResult = ImportSuccess | ImportFailure;

const ESCAPE_HATCH = "x_openbench_netlist";
const IMPORT_SOURCE = "mcp-sim-spice";
const IMPORT_DERIVED_BY = "mcp-sim-spice-import@0.1.0";

// ---------------------------------------------------------------------------
// export: netlist IR → SPICE deck
// ---------------------------------------------------------------------------

/**
 * Serialize a netlist IR document to a flat SPICE deck. Throws a structured
 * {@link NgspiceAdapterError} on a netlist that fails IR validation (export of
 * an invalid document is a programming error, mirroring the KiCad adapter).
 */
export function exportNetlist(netlist: Netlist): string {
  const validation = validateNetlist(netlist);
  if (!validation.valid) {
    throw new NgspiceAdapterError("invalid netlist IR", validation.errors);
  }
  const meta = {
    irVersion: netlist.irVersion,
    id: netlist.id,
    schematicId: netlist.schematicId,
    nodes: netlist.nodes,
    elements: netlist.elements,
    derivedBy: netlist.derivedBy,
  };
  const lines = [
    `* OpenBench netlist ${netlist.id}`,
    `* ${ESCAPE_HATCH} ${JSON.stringify(meta)}`,
    ...netlist.elements.map((element) => element.spiceCard),
    ".end",
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// import: SPICE deck → netlist IR
// ---------------------------------------------------------------------------

const fail = (path: string, message: string): ImportFailure => ({
  ok: false,
  errors: [{ path, message }],
});

/** FNV-1a → deterministic ids for foreign decks with no OpenBench origin. */
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** Node-count of the recognized device letters (index 0 is the ref token). */
const DEVICE_NODE_ARITY: Record<string, number> = {
  R: 2, // resistor
  C: 2, // capacitor
  L: 2, // inductor
  V: 2, // voltage source
  I: 2, // current source
  D: 2, // diode
  Q: 3, // BJT (collector base emitter)
  M: 4, // MOSFET (drain gate source bulk)
};

/** Strip an inline `;`/`$` comment from a SPICE line (outside our escape hatch). */
const stripInlineComment = (line: string): string =>
  line.replace(/\s+[;$].*$/, "").replace(/;.*$/, "");

/**
 * Fold SPICE line continuations: a line whose first non-space char is `+`
 * continues the previous line. Returns physical-index-preserving logical lines
 * (the continued text is appended to its parent; the `+` line becomes empty).
 */
function foldContinuations(rawLines: string[]): string[] {
  const folded = [...rawLines];
  for (let i = 0; i < folded.length; i += 1) {
    const trimmed = folded[i]!.trimStart();
    if (trimmed.startsWith("+")) {
      // find the nearest preceding non-empty logical line
      let j = i - 1;
      while (j >= 0 && folded[j]!.trim() === "") j -= 1;
      if (j >= 0) {
        folded[j] = `${folded[j]} ${trimmed.slice(1).trim()}`.trim();
        folded[i] = "";
      }
    }
  }
  return folded;
}

/** Reconstruct a netlist IR exactly from an embedded escape-hatch payload. */
function fromEscapeHatch(json: string): ImportResult {
  const errors: ValidationError[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail(ESCAPE_HATCH, `invalid JSON in ${ESCAPE_HATCH} escape hatch`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return fail(ESCAPE_HATCH, `${ESCAPE_HATCH} must be a JSON object`);
  }
  const meta = parsed as Record<string, unknown>;
  const netlist: Netlist = {
    irVersion: typeof meta.irVersion === "string" ? meta.irVersion : IR_VERSION,
    kind: "netlist",
    id: String(meta.id ?? ""),
    schematicId: String(meta.schematicId ?? ""),
    nodes: (meta.nodes as NetlistNode[]) ?? [],
    elements: (meta.elements as NetlistElement[]) ?? [],
    derivedBy: typeof meta.derivedBy === "string" ? meta.derivedBy : IMPORT_DERIVED_BY,
    // provenance is regenerated on every import (documented lossy field)
    provenance: { source: IMPORT_SOURCE, at: new Date().toISOString() },
  };
  const validation = validateNetlist(netlist);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, netlist, warnings: [] };
}

/**
 * Parse a SPICE deck into a netlist IR document. Never throws: malformed input
 * yields `{ ok: false, errors: [{ path, message }] }`; unrecognized cards are
 * preserved (not fatal). Provenance is regenerated on import.
 */
export function importNetlist(deck: string): ImportResult {
  try {
    const rawLines = deck.split(/\r?\n/);

    // --- escape-hatch mode: our own decks carry a x_openbench_netlist comment ---
    for (const line of rawLines) {
      const trimmed = line.trim();
      const marker = `* ${ESCAPE_HATCH} `;
      if (trimmed.startsWith(marker)) {
        return fromEscapeHatch(trimmed.slice(marker.length));
      }
    }

    return parseForeignDeck(rawLines);
  } catch (error) {
    // the adapter contract forbids throwing
    return fail("", `internal adapter error: ${String(error)}`);
  }
}

function parseForeignDeck(rawLines: string[]): ImportResult {
  const warnings: string[] = [];
  const errors: ValidationError[] = [];
  const elements: NetlistElement[] = [];

  // node ordering: first-seen SPICE node token → NetlistNode
  const nodeOrder: string[] = [];
  const seenNodes = new Set<string>();
  const noteNode = (token: string): void => {
    if (!seenNodes.has(token)) {
      seenNodes.add(token);
      nodeOrder.push(token);
    }
  };

  const folded = foldContinuations(rawLines);
  let rawCounter = 0;

  // SPICE convention: the first physical line is the title/comment, ignored.
  for (let i = 1; i < folded.length; i += 1) {
    const source = folded[i]!;
    const line = stripInlineComment(source).trim();
    if (line === "") continue;
    if (line.startsWith("*")) continue; // full-line comment

    const lower = line.toLowerCase();

    // --- dot directives ---
    if (line.startsWith(".")) {
      if (lower.startsWith(".model")) {
        const name = line.split(/\s+/)[1];
        elements.push({ instanceId: name && name.length > 0 ? name : `model_${i}`, spiceCard: line });
        continue;
      }
      if (lower.startsWith(".subckt")) {
        const name = line.split(/\s+/)[1] ?? `subckt_${i}`;
        const block = [line];
        let closed = false;
        let j = i + 1;
        for (; j < folded.length; j += 1) {
          const inner = stripInlineComment(folded[j]!).trim();
          if (inner === "" || inner.startsWith("*")) continue;
          block.push(inner);
          if (inner.toLowerCase().startsWith(".ends")) {
            closed = true;
            break;
          }
        }
        if (!closed) {
          errors.push({
            path: `.subckt.${name}`,
            message: `.subckt "${name}" has no matching .ends`,
          });
        } else {
          elements.push({ instanceId: name, spiceCard: block.join("\n") });
        }
        i = j; // skip consumed lines
        continue;
      }
      // analysis / control / other directives are not netlist elements — ignore
      continue;
    }

    // --- element cards ---
    const tokens = line.split(/\s+/);
    const ref = tokens[0]!;
    const deviceLetter = ref[0]!.toUpperCase();
    const arity = DEVICE_NODE_ARITY[deviceLetter];

    if (arity === undefined) {
      // unrecognized device → preserve via the escape hatch, warn, never drop
      rawCounter += 1;
      elements.push({ instanceId: `x_openbench_raw_${rawCounter}`, spiceCard: line });
      warnings.push(
        `unsupported card "${ref}" preserved verbatim (device letter "${deviceLetter}" not recognized)`,
      );
      continue;
    }

    if (tokens.length < 1 + arity) {
      errors.push({
        path: `elements.${ref}`,
        message: `device "${ref}" needs ${arity} node(s) but the card has only ${tokens.length - 1}`,
      });
      continue;
    }

    for (let n = 1; n <= arity; n += 1) noteNode(tokens[n]!);
    elements.push({ instanceId: ref, spiceCard: line });
  }

  if (errors.length > 0) return { ok: false, errors };

  const fingerprint = fnv1a(folded.join("\n"));
  const nodes: NetlistNode[] = nodeOrder.map((token) => ({
    netId: `net_${token.toLowerCase()}`,
    spiceNode: token,
  }));

  warnings.push(
    `foreign SPICE deck: no OpenBench schematic origin — generated ids net_${fingerprint} / sch_${fingerprint}`,
  );

  const netlist: Netlist = {
    irVersion: IR_VERSION,
    kind: "netlist",
    id: `net_${fingerprint}`,
    schematicId: `sch_${fingerprint}`,
    nodes,
    elements,
    derivedBy: IMPORT_DERIVED_BY,
    provenance: { source: IMPORT_SOURCE, at: new Date().toISOString() },
  };

  const validation = validateNetlist(netlist);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  return { ok: true, netlist, warnings };
}

/** Adapter contract `validate` — delegates to the canonical IR schema. */
export function validate(doc: unknown): ValidationResult {
  return validateNetlist(doc);
}
