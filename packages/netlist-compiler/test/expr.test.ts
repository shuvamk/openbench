import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../src/expr";

/**
 * Acceptance tests for issue #21 — the SAFE derivedParams expression
 * evaluator. Recursive descent over numbers, identifiers, + - * / and
 * parentheses; NO eval/Function, ever. Anything outside the grammar is a
 * structured error, never thrown and never executed as JS.
 */

const vars = (entries: Record<string, number>) => new Map(Object.entries(entries));

const value = (expression: string, variables: Record<string, number> = {}): number => {
  const result = evaluateExpression(expression, vars(variables));
  expect(result.ok, `expected "${expression}" to evaluate, got: ${JSON.stringify(result)}`).toBe(true);
  return result.ok ? result.value : Number.NaN;
};

const failure = (expression: string, variables: Record<string, number> = {}): string => {
  const result = evaluateExpression(expression, vars(variables));
  expect(result.ok, `expected "${expression}" to fail`).toBe(false);
  return result.ok ? "" : result.message;
};

describe("evaluateExpression — arithmetic", () => {
  it("evaluates plain numeric literals (integer, decimal, scientific)", () => {
    expect(value("42")).toBe(42);
    expect(value("0.001")).toBe(0.001);
    expect(value("1e12")).toBe(1e12);
    expect(value("2.5e-3")).toBe(2.5e-3);
    expect(value(".5")).toBe(0.5);
  });

  it("applies operator precedence (* / bind tighter than + -)", () => {
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("10 - 8 / 4")).toBe(8);
  });

  it("evaluates left-to-right within a precedence level", () => {
    expect(value("10 - 3 - 2")).toBe(5);
    expect(value("16 / 4 / 2")).toBe(2);
  });

  it("respects parentheses", () => {
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("100 / (2 + 3)")).toBe(20);
  });

  it("supports unary minus and plus", () => {
    expect(value("-3 + 5")).toBe(2);
    expect(value("2 * -4")).toBe(-8);
    expect(value("+7")).toBe(7);
  });

  it("substitutes identifiers from the variables map", () => {
    expect(value("0.001 + (1 - pressed) * 1e12", { pressed: 1 })).toBe(0.001);
    expect(value("0.001 + (1 - pressed) * 1e12", { pressed: 0 })).toBe(1e12 + 0.001);
    expect(value("(r1 * r2) / (r1 + r2)", { r1: 1000, r2: 1000 })).toBe(500);
  });
});

describe("evaluateExpression — structured errors (never eval'd as JS)", () => {
  it("rejects unknown identifiers", () => {
    expect(failure("1 + held")).toContain("held");
  });

  it("rejects illegal characters (semicolons, quotes, dots, commas)", () => {
    failure("1; 2");
    failure("require('fs')");
    failure("process.exit", { process: 1 });
    failure("pow(1, 2)");
  });

  it("rejects call syntax even when the callee is a known variable", () => {
    failure("pressed(1)", { pressed: 1 });
  });

  it("rejects malformed expressions", () => {
    failure("");
    failure("   ");
    failure("1 +");
    failure("(1 + 2");
    failure("1 2");
    failure("* 3");
    failure("2 ** 3");
  });

  it("rejects non-finite results (division by zero)", () => {
    failure("1 / 0");
    failure("0 / 0");
    failure("1e308 * 1e308");
  });

  it("does not treat object-prototype names as variables", () => {
    failure("constructor");
    failure("__proto__ + 1");
    failure("toString");
  });
});
