import { NgspiceAdapterError } from "./deck";

/**
 * ngspice ASCII rawfile parser/serializer (issue #30).
 *
 * The native CLI backend runs ngspice in batch mode and reads back an ASCII
 * rawfile (`SPICE_ASCIIRAWFILE=1`). Format:
 *
 *   Title: <title>
 *   Date: <date>
 *   Plotname: <plot name>
 *   Flags: real
 *   No. Variables: <N>
 *   No. Points: <P>
 *   Variables:
 *   \t0\t<name>\t<type>
 *   ...
 *   Values:
 *   \t<point index>\t<value of var 0>
 *   \t<value of var 1>
 *   ...
 *
 * Only real plots (`.op`, `.tran`, `.dc`) are decoded here — the value of each
 * variable is the last whitespace-delimited token on its line, so the leading
 * point index on a point's first line is ignored uniformly.
 */
export interface RawVariable {
  index: number;
  name: string;
  type: string;
}

export interface RawPlot {
  title: string;
  date?: string;
  plotname: string;
  flags: string[];
  variables: RawVariable[];
  points: number;
  /** variable name → real sample values (length === points). */
  vectors: Record<string, Float64Array>;
}

function headerValue(line: string, key: string): string {
  return line.slice(key.length + 1).trim();
}

export function parseRawfile(text: string): RawPlot {
  const lines = text.split(/\r?\n/);
  let i = 0;

  let title = "";
  let date: string | undefined;
  let plotname = "";
  let flags: string[] = [];
  let nVars = -1;
  let nPoints = -1;

  // Header key: value lines up to the "Variables:" section.
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^Variables:\s*$/.test(line)) break;
    if (line.startsWith("Title:")) title = headerValue(line, "Title:");
    else if (line.startsWith("Date:")) date = headerValue(line, "Date:");
    else if (line.startsWith("Plotname:")) plotname = headerValue(line, "Plotname:");
    else if (line.startsWith("Flags:")) flags = headerValue(line, "Flags:").split(/\s+/).filter(Boolean);
    else if (line.startsWith("No. Variables:")) nVars = Number(headerValue(line, "No. Variables:"));
    else if (line.startsWith("No. Points:")) nPoints = Number(headerValue(line, "No. Points:"));
  }

  if (i >= lines.length) {
    throw new NgspiceAdapterError("rawfile has no Variables: section", [
      { path: "rawfile", message: "missing Variables: section" },
    ]);
  }
  if (!Number.isInteger(nVars) || nVars <= 0) {
    throw new NgspiceAdapterError(`rawfile declares an invalid variable count (${nVars})`, [
      { path: "rawfile.No. Variables", message: "expected a positive integer" },
    ]);
  }
  if (!Number.isInteger(nPoints) || nPoints < 0) {
    throw new NgspiceAdapterError(`rawfile declares an invalid point count (${nPoints})`, [
      { path: "rawfile.No. Points", message: "expected a non-negative integer" },
    ]);
  }
  if (flags.includes("complex")) {
    throw new NgspiceAdapterError("complex (AC) rawfiles are not decoded by this parser", [
      { path: "rawfile.Flags", message: "only real plots are supported" },
    ]);
  }

  i++; // consume "Variables:"
  const variables: RawVariable[] = [];
  for (let v = 0; v < nVars; v++, i++) {
    const parts = (lines[i] ?? "").trim().split(/\s+/);
    if (parts.length < 3) {
      throw new NgspiceAdapterError(`malformed variable declaration on line ${i + 1}`, [
        { path: "rawfile.Variables", message: `expected "<index> <name> <type>"` },
      ]);
    }
    variables.push({ index: Number(parts[0]), name: parts[1]!, type: parts[2]! });
  }

  // Advance to "Values:".
  for (; i < lines.length && !/^Values:\s*$/.test(lines[i]!); i++);
  if (i >= lines.length) {
    throw new NgspiceAdapterError("rawfile has no Values: section", [
      { path: "rawfile", message: "missing Values: section" },
    ]);
  }
  i++; // consume "Values:"

  // Collect the last token of every non-blank line → one value per (point, var).
  const tokens: number[] = [];
  for (; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "") continue;
    const parts = trimmed.split(/\s+/);
    tokens.push(Number(parts[parts.length - 1]));
  }

  const expected = nVars * nPoints;
  if (tokens.length !== expected) {
    throw new NgspiceAdapterError(
      `rawfile value count mismatch: header declares ${nPoints} points × ${nVars} variables ` +
        `(${expected} values) but the data section has ${tokens.length}`,
      [{ path: "rawfile.Values", message: "point/variable counts disagree with the data" }],
    );
  }

  const vectors: Record<string, Float64Array> = {};
  for (const variable of variables) vectors[variable.name] = new Float64Array(nPoints);
  for (let p = 0; p < nPoints; p++) {
    for (let v = 0; v < nVars; v++) {
      vectors[variables[v]!.name]![p] = tokens[p * nVars + v]!;
    }
  }

  return { title, date, plotname, flags, variables, points: nPoints, vectors };
}

/** 17 significant digits → exact round-trip for IEEE-754 doubles. */
function formatValue(value: number): string {
  return value.toExponential(16);
}

/** Serialize a plot back to ASCII rawfile text (real plots only). */
export function serializeRawfile(plot: RawPlot): string {
  const lines: string[] = [
    `Title: ${plot.title}`,
    `Date: ${plot.date ?? ""}`,
    `Plotname: ${plot.plotname}`,
    `Flags: ${plot.flags.join(" ")}`,
    `No. Variables: ${plot.variables.length}`,
    `No. Points: ${plot.points}`,
    "Variables:",
  ];
  for (const v of plot.variables) lines.push(`\t${v.index}\t${v.name}\t${v.type}`);
  lines.push("Values:");
  for (let p = 0; p < plot.points; p++) {
    plot.variables.forEach((v, vi) => {
      const value = formatValue(plot.vectors[v.name]![p]!);
      lines.push(vi === 0 ? `\t${p}\t${value}` : `\t${value}`);
    });
  }
  return `${lines.join("\n")}\n`;
}
