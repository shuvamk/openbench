import type { Component, Schematic } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";

/**
 * Bill of Materials — a pure projection of the schematic IR (issue #39).
 *
 * `buildBom` groups instances that share a component AND a resolved parameter
 * set into one line (so two 4.7k resistors collapse to a single qty-2 row), and
 * splits the result into the purchasable list and a "virtual" section for parts
 * that have no footprint (ground, sources). Registry-unknown instances are kept
 * (flagged), never dropped — you can't fabricate a board with a hole in the BOM.
 */

export type ParamValue = number | string | boolean;

export interface BomLine {
  /** Instance references in this group, naturally sorted (R1, R2, R10…). */
  refs: string[];
  componentId: string;
  /** Human value string (engineering-formatted primary parameter, or ""). */
  value: string;
  qty: number;
  /** KiCad footprint ref; absent for virtual or unknown parts. */
  footprint?: string;
  /** True when `componentId` doesn't resolve in the registry. */
  unknown?: boolean;
}

export interface Bom {
  /** Purchasable parts (have a footprint) plus registry-unknown instances. */
  lines: BomLine[];
  /** Resolved parts with no footprint — counted but not purchasable. */
  virtual: BomLine[];
}

type ResolveComponent = (id: string) => Component | undefined;

/** SI prefixes for engineering notation, indexed by power-of-ten group. */
const SI_PREFIX: Record<number, string> = {
  [-12]: "p",
  [-9]: "n",
  [-6]: "µ",
  [-3]: "m",
  [0]: "",
  [3]: "k",
  [6]: "M",
  [9]: "G",
};

/** Engineering-notation magnitude, e.g. 4700 → "4.7k", 1e-7 → "100n", 220 → "220". */
export function formatEngineering(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let exponent = Math.floor(Math.log10(abs) / 3) * 3;
  exponent = Math.max(-12, Math.min(9, exponent));
  const mantissa = abs / 10 ** exponent;
  // Trim to at most 3 significant digits, dropping trailing zeros.
  const trimmed = parseFloat(mantissa.toPrecision(3));
  return `${sign}${trimmed}${SI_PREFIX[exponent] ?? `e${exponent}`}`;
}

/** Resolve every declared parameter from the instance override or its default. */
function resolveParams(
  component: Component,
  overrides: Record<string, ParamValue> | undefined,
): Record<string, ParamValue> {
  const resolved: Record<string, ParamValue> = {};
  for (const parameter of component.parameters) {
    resolved[parameter.name] = overrides?.[parameter.name] ?? parameter.default;
  }
  return resolved;
}

/** Display value: the first numeric parameter in engineering notation, else "". */
function primaryValue(
  component: Component,
  resolved: Record<string, ParamValue>,
): string {
  const numeric = component.parameters.find((p) => p.type === "number");
  if (!numeric) return "";
  const value = resolved[numeric.name];
  return typeof value === "number" ? formatEngineering(value) : String(value ?? "");
}

/** Stable JSON of a param map (keys sorted) — the grouping discriminator. */
function stableParamKey(params: Record<string, ParamValue>): string {
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}=${String(params[k])}`).join("&");
}

/** Natural ref order: split trailing digits so R2 sorts before R10. */
function compareRefs(a: string, b: string): number {
  const parse = (ref: string): [string, number] => {
    const match = /^(.*?)(\d+)$/.exec(ref);
    return match ? [match[1]!, Number(match[2])] : [ref, Number.NaN];
  };
  const [pa, na] = parse(a);
  const [pb, nb] = parse(b);
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : a > b ? 1 : 0;
  return na - nb;
}

interface Group {
  refs: string[];
  componentId: string;
  value: string;
  footprint?: string;
  unknown: boolean;
}

export function buildBom(
  schematic: Schematic,
  resolveComponent: ResolveComponent = getComponent,
): Bom {
  const groups = new Map<string, Group>();

  for (const instance of schematic.instances) {
    const component = resolveComponent(instance.componentId);
    let value = "";
    let footprint: string | undefined;
    let unknown = false;
    let paramKey: string;

    if (component) {
      const resolved = resolveParams(component, instance.parameterOverrides);
      value = primaryValue(component, resolved);
      footprint = component.footprint?.kicadRef;
      paramKey = stableParamKey(resolved);
    } else {
      unknown = true;
      paramKey = stableParamKey(instance.parameterOverrides ?? {});
    }

    const key = `${instance.componentId}|${paramKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.refs.push(instance.instanceId);
    } else {
      groups.set(key, {
        refs: [instance.instanceId],
        componentId: instance.componentId,
        value,
        footprint,
        unknown,
      });
    }
  }

  const all: BomLine[] = [...groups.values()].map((group) => ({
    refs: group.refs.slice().sort(compareRefs),
    componentId: group.componentId,
    value: group.value,
    qty: group.refs.length,
    ...(group.footprint !== undefined ? { footprint: group.footprint } : {}),
    ...(group.unknown ? { unknown: true } : {}),
  }));

  const byLabel = (a: BomLine, b: BomLine): number =>
    a.componentId !== b.componentId
      ? a.componentId < b.componentId
        ? -1
        : 1
      : a.value < b.value
        ? -1
        : a.value > b.value
          ? 1
          : 0;

  // Virtual = resolved parts with no footprint. Unknown parts stay in `lines`
  // (we can't assume they're unpurchasable — we just can't source them yet).
  const lines = all
    .filter((line) => line.unknown || line.footprint !== undefined)
    .sort(byLabel);
  const virtual = all
    .filter((line) => !line.unknown && line.footprint === undefined)
    .sort(byLabel);

  return { lines, virtual };
}

// --- CSV ---------------------------------------------------------------------

const CSV_HEADER = ["ref", "componentId", "value", "qty", "footprint"] as const;
/** Refs are joined into a single CSV cell with this separator. */
const REF_SEP = ";";

/** Quote a CSV cell iff it contains a comma, quote, CR or LF (RFC 4180). */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize the purchasable BOM lines to RFC-4180 CSV (CRLF-terminated rows). */
export function bomToCsv(lines: BomLine[]): string {
  const rows = lines.map((line) => [
    line.refs.join(REF_SEP),
    line.componentId,
    line.value,
    String(line.qty),
    line.footprint ?? "",
  ]);
  return [CSV_HEADER as readonly string[], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

/** One parsed CSV row — the subset of BomLine the CSV carries. */
export interface BomCsvRow {
  refs: string[];
  componentId: string;
  value: string;
  qty: number;
  footprint?: string;
}

/** Split one CSV record into cells, honoring RFC-4180 quoting. */
function splitCsvRecord(record: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (record[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Parse a BOM CSV back into rows; the inverse of `bomToCsv` (header skipped). */
export function parseBomCsv(csv: string): BomCsvRow[] {
  const records = csv.split(/\r\n|\n/).filter((line) => line.length > 0);
  return records.slice(1).map((record) => {
    const [ref, componentId, value, qty, footprint] = splitCsvRecord(record);
    return {
      refs: (ref ?? "").split(REF_SEP).filter(Boolean),
      componentId: componentId ?? "",
      value: value ?? "",
      qty: Number(qty),
      footprint: footprint ? footprint : undefined,
    };
  });
}
