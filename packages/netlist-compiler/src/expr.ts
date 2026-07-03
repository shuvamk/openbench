/**
 * Safe arithmetic evaluator for `simModel.derivedParams` expressions (issue #21).
 *
 * Grammar (recursive descent, NO eval/Function — hostile input can only ever
 * produce a structured error):
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/") unary)*
 *   unary      := ("+" | "-") unary | primary
 *   primary    := NUMBER | IDENTIFIER | "(" expression ")"
 *
 * NUMBER supports decimals and scientific notation (`0.001`, `1e12`, `2.5e-3`);
 * IDENTIFIER values come exclusively from the caller-supplied Map (so object
 * prototype names like `constructor` are never resolvable).
 */

export type EvaluateResult = { ok: true; value: number } | { ok: false; message: string };

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; name: string }
  | { kind: "operator"; op: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

const NUMBER_RE = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

class ExpressionError extends Error {}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < expression.length) {
    const char = expression[position]!;
    if (/\s/.test(char)) {
      position += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "operator", op: char });
      position += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "lparen" });
      position += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rparen" });
      position += 1;
      continue;
    }
    NUMBER_RE.lastIndex = position;
    const numberMatch = NUMBER_RE.exec(expression);
    if (numberMatch !== null) {
      tokens.push({ kind: "number", value: Number(numberMatch[0]) });
      position = NUMBER_RE.lastIndex;
      continue;
    }
    IDENTIFIER_RE.lastIndex = position;
    const identifierMatch = IDENTIFIER_RE.exec(expression);
    if (identifierMatch !== null) {
      tokens.push({ kind: "identifier", name: identifierMatch[0] });
      position = IDENTIFIER_RE.lastIndex;
      continue;
    }
    throw new ExpressionError(
      `invalid character "${char}" at position ${position} (allowed: numbers, identifiers, + - * / and parentheses)`,
    );
  }
  return tokens;
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly variables: ReadonlyMap<string, number>,
  ) {}

  evaluate(): number {
    if (this.tokens.length === 0) {
      throw new ExpressionError("empty expression");
    }
    const value = this.expression();
    const trailing = this.tokens[this.position];
    if (trailing !== undefined) {
      throw new ExpressionError(`unexpected ${describeToken(trailing)} after expression`);
    }
    return value;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      const op = this.matchOperator("+", "-");
      if (op === undefined) return value;
      const rhs = this.term();
      value = op === "+" ? value + rhs : value - rhs;
    }
  }

  private term(): number {
    let value = this.unary();
    for (;;) {
      const op = this.matchOperator("*", "/");
      if (op === undefined) return value;
      const rhs = this.unary();
      value = op === "*" ? value * rhs : value / rhs;
    }
  }

  private unary(): number {
    const op = this.matchOperator("+", "-");
    if (op !== undefined) {
      const value = this.unary();
      return op === "-" ? -value : value;
    }
    return this.primary();
  }

  private primary(): number {
    const token = this.tokens[this.position];
    if (token === undefined) {
      throw new ExpressionError("unexpected end of expression");
    }
    if (token.kind === "number") {
      this.position += 1;
      return token.value;
    }
    if (token.kind === "identifier") {
      this.position += 1;
      const value = this.variables.get(token.name);
      if (value === undefined) {
        throw new ExpressionError(`unknown identifier "${token.name}"`);
      }
      return value;
    }
    if (token.kind === "lparen") {
      this.position += 1;
      const value = this.expression();
      const closing = this.tokens[this.position];
      if (closing === undefined || closing.kind !== "rparen") {
        throw new ExpressionError("missing closing parenthesis");
      }
      this.position += 1;
      return value;
    }
    throw new ExpressionError(`unexpected ${describeToken(token)}`);
  }

  private matchOperator<T extends "+" | "-" | "*" | "/">(...ops: T[]): T | undefined {
    const token = this.tokens[this.position];
    if (token?.kind === "operator" && (ops as string[]).includes(token.op)) {
      this.position += 1;
      return token.op as T;
    }
    return undefined;
  }
}

function describeToken(token: Token): string {
  switch (token.kind) {
    case "number":
      return `number ${token.value}`;
    case "identifier":
      return `identifier "${token.name}"`;
    case "operator":
      return `operator "${token.op}"`;
    case "lparen":
      return `"("`;
    case "rparen":
      return `")"`;
  }
}

/**
 * Evaluate a derivedParams arithmetic expression against parameter values.
 * Returns a structured result — this function never throws and never executes
 * the input as code.
 */
export function evaluateExpression(
  expression: string,
  variables: ReadonlyMap<string, number>,
): EvaluateResult {
  try {
    const value = new Parser(tokenize(expression), variables).evaluate();
    if (!Number.isFinite(value)) {
      return { ok: false, message: "expression does not evaluate to a finite number" };
    }
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
