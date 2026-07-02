/**
 * S-expression parser/serializer for KiCad files (`.kicad_sch` et al.).
 *
 * Trees are nested arrays of atoms. Atoms are:
 *   - `number`   — bare numeric tokens (`42`, `-1.5`, `2e-3`)
 *   - `string`   — quoted tokens (`"Reference"`), escapes decoded
 *   - `SExprSymbol` — bare identifiers (`kicad_sch`, `at`), wrapped so a
 *     quoted string and a bare symbol never collide
 *
 * Invariant: `parse(serialize(x))` deep-equals `x` for every serializable
 * tree. `serialize` throws on trees that could not round-trip (symbols that
 * look like numbers or contain delimiters, non-finite numbers).
 */

export interface SExprSymbol {
  readonly sym: string;
}

export type SExprAtom = string | number | SExprSymbol;
export type SExpr = SExprAtom | SExpr[];

/** Construct a bare-symbol atom. */
export function sym(name: string): SExprSymbol {
  return { sym: name };
}

/** True when `value` is a bare-symbol atom (vs a quoted string / number / list). */
export function isSym(value: SExpr): value is SExprSymbol {
  return typeof value === "object" && !Array.isArray(value) && typeof value.sym === "string";
}

/** Thrown by `parse` on malformed input. `offset` is the 0-based character index. */
export class SExprParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = "SExprParseError";
    this.offset = offset;
  }
}

const NUMBER_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const isWhitespace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/**
 * Parse exactly one S-expression; trailing non-whitespace content is an error
 * (a KiCad file is a single top-level form). Throws `SExprParseError`.
 */
export function parse(text: string): SExpr {
  let pos = 0;

  const skipWhitespace = (): void => {
    while (pos < text.length && isWhitespace(text[pos]!)) pos += 1;
  };

  const parseString = (): string => {
    const start = pos;
    pos += 1; // opening quote
    let out = "";
    while (pos < text.length) {
      const ch = text[pos]!;
      if (ch === '"') {
        pos += 1;
        return out;
      }
      if (ch === "\\") {
        pos += 1;
        if (pos >= text.length) break;
        const esc = text[pos]!;
        if (esc === "n") out += "\n";
        else if (esc === "t") out += "\t";
        else if (esc === "r") out += "\r";
        else out += esc; // \" \\ and any unknown escape: literal char
        pos += 1;
      } else {
        out += ch;
        pos += 1;
      }
    }
    throw new SExprParseError("unterminated string", start);
  };

  const parseAtomToken = (): SExprAtom => {
    const start = pos;
    while (pos < text.length) {
      const ch = text[pos]!;
      if (isWhitespace(ch) || ch === "(" || ch === ")" || ch === '"') break;
      pos += 1;
    }
    const token = text.slice(start, pos);
    if (NUMBER_TOKEN.test(token)) return Number(token);
    return sym(token);
  };

  const parseExpr = (): SExpr => {
    skipWhitespace();
    if (pos >= text.length) throw new SExprParseError("unexpected end of input", pos);
    const ch = text[pos]!;
    if (ch === "(") {
      const start = pos;
      pos += 1;
      const items: SExpr[] = [];
      for (;;) {
        skipWhitespace();
        if (pos >= text.length) {
          throw new SExprParseError("unbalanced parentheses: missing ')'", start);
        }
        if (text[pos] === ")") {
          pos += 1;
          return items;
        }
        items.push(parseExpr());
      }
    }
    if (ch === ")") throw new SExprParseError("unexpected ')'", pos);
    if (ch === '"') return parseString();
    return parseAtomToken();
  };

  const expr = parseExpr();
  skipWhitespace();
  if (pos < text.length) {
    throw new SExprParseError("unexpected trailing content after document", pos);
  }
  return expr;
}

const escapeString = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");

const serializeAtom = (atom: SExprAtom): string => {
  if (typeof atom === "number") {
    if (!Number.isFinite(atom)) {
      throw new TypeError(`cannot serialize non-finite number ${atom}`);
    }
    return String(atom);
  }
  if (typeof atom === "string") return `"${escapeString(atom)}"`;
  const name = atom.sym;
  if (
    name.length === 0 ||
    /[\s()"\\]/.test(name) ||
    NUMBER_TOKEN.test(name)
  ) {
    throw new TypeError(
      `cannot serialize symbol ${JSON.stringify(name)}: would not round-trip as a bare token`,
    );
  }
  return name;
};

const formatExpr = (expr: SExpr, indent: number): string => {
  if (!Array.isArray(expr)) return serializeAtom(expr);
  if (expr.length === 0) return "()";
  if (expr.every((item) => !Array.isArray(item))) {
    return `(${expr.map((item) => serializeAtom(item as SExprAtom)).join(" ")})`;
  }
  // KiCad style: leading atoms on the head line, every remaining element on
  // its own indented line, closing paren at the parent indent.
  const childPad = "  ".repeat(indent + 1);
  const parts: string[] = [];
  let i = 0;
  while (i < expr.length && !Array.isArray(expr[i])) {
    parts.push(serializeAtom(expr[i] as SExprAtom));
    i += 1;
  }
  const lines: string[] = [];
  for (; i < expr.length; i += 1) {
    lines.push(childPad + formatExpr(expr[i]!, indent + 1));
  }
  return `(${parts.join(" ")}\n${lines.join("\n")}\n${"  ".repeat(indent)})`;
};

/** Serialize a tree to KiCad-style pretty-printed text. Inverse of `parse`. */
export function serialize(expr: SExpr): string {
  return formatExpr(expr, 0);
}
