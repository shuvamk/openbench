import { describe, expect, it } from "vitest";
import { parse, serialize, sym, isSym, SExprParseError, type SExpr } from "../src/sexpr";

describe("sexpr parse", () => {
  it("parses a flat list of symbols, strings and numbers", () => {
    expect(parse('(foo "bar" 42 -1.5 baz)')).toEqual([
      sym("foo"),
      "bar",
      42,
      -1.5,
      sym("baz"),
    ]);
  });

  it("distinguishes quoted strings from bare symbols", () => {
    const result = parse('(a "a")') as SExpr[];
    expect(isSym(result[0]!)).toBe(true);
    expect(result[1]).toBe("a");
  });

  it("parses nested lists", () => {
    expect(parse("(kicad_sch (version 20231120) (symbol (at 120 80 0)))")).toEqual([
      sym("kicad_sch"),
      [sym("version"), 20231120],
      [sym("symbol"), [sym("at"), 120, 80, 0]],
    ]);
  });

  it("parses the empty list", () => {
    expect(parse("()")).toEqual([]);
  });

  it("handles whitespace, tabs and newlines between tokens", () => {
    expect(parse("(a\n\t (b\r\n  1)   2)")).toEqual([sym("a"), [sym("b"), 1], 2]);
  });

  it("parses integer, float and exponent number forms", () => {
    expect(parse("(1 -2 3.5 -0.25 1e3 2.5e-2 1E+2)")).toEqual([
      1, -2, 3.5, -0.25, 1000, 0.025, 100,
    ]);
  });

  it("parses escape sequences inside quoted strings", () => {
    expect(parse('("a\\"b" "c\\\\d" "e\\nf" "g\\th")')).toEqual([
      'a"b',
      "c\\d",
      "e\nf",
      "g\th",
    ]);
  });

  it("keeps parens and whitespace literal inside quoted strings", () => {
    expect(parse('("(not a list) two  spaces")')).toEqual(["(not a list) two  spaces"]);
  });

  it("parses a quoted string containing JSON", () => {
    const json = JSON.stringify({ resistance: 4700, label: 'say "hi"' });
    const doc = [sym("x_openbench_params"), json];
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it("throws SExprParseError on unbalanced open paren", () => {
    expect(() => parse("(kicad_sch (symbol")).toThrow(SExprParseError);
  });

  it("throws SExprParseError on a stray closing paren", () => {
    expect(() => parse(")")).toThrow(SExprParseError);
  });

  it("throws SExprParseError on trailing content after the document", () => {
    expect(() => parse("(a) (b)")).toThrow(SExprParseError);
  });

  it("throws SExprParseError on a truncated quoted string", () => {
    expect(() => parse('(prop "unterminated')).toThrow(SExprParseError);
  });

  it("throws SExprParseError on empty input", () => {
    expect(() => parse("")).toThrow(SExprParseError);
    expect(() => parse("   \n ")).toThrow(SExprParseError);
  });

  it("reports a position in parse error messages", () => {
    try {
      parse("(a))");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SExprParseError);
      expect((error as SExprParseError).message).toMatch(/\d+/);
    }
  });
});

describe("sexpr serialize", () => {
  it("serializes atoms distinctly: symbols bare, strings quoted", () => {
    expect(serialize([sym("generator"), "openbench"])).toContain('(generator "openbench")');
  });

  it("escapes quotes, backslashes and newlines in strings", () => {
    const out = serialize([sym("p"), 'a"b\\c\nd']);
    expect(out).toBe('(p "a\\"b\\\\c\\nd")');
  });

  it("rejects symbols that could not round-trip", () => {
    expect(() => serialize(sym("has space"))).toThrow();
    expect(() => serialize(sym("123"))).toThrow();
    expect(() => serialize(sym('quo"te'))).toThrow();
    expect(() => serialize(sym(""))).toThrow();
  });

  it("rejects non-finite numbers", () => {
    expect(() => serialize([sym("a"), Number.NaN])).toThrow();
    expect(() => serialize([sym("a"), Number.POSITIVE_INFINITY])).toThrow();
  });

  it("round-trips: parse(serialize(x)) deep-equals x for representative trees", () => {
    const trees: SExpr[] = [
      42,
      -3.25,
      "just a string",
      sym("just_a_symbol"),
      [],
      [sym("kicad_sch"), [sym("version"), 20231120], [sym("generator"), "openbench-mcp-kicad"]],
      [
        sym("symbol"),
        [sym("lib_id"), "OpenBench:cmp_resistor_generic"],
        [sym("at"), 120, 80, 0],
        [sym("property"), "Reference", "R1", [sym("at"), 120, 80, 0]],
        [sym("property"), "x_openbench_params", '{"resistance":4700}'],
      ],
      [sym("deep"), [sym("a"), [sym("b"), [sym("c"), [sym("d"), 1, "two", sym("three")]]]]],
      [sym("strings"), 'with "quotes"', "with\nnewlines", "with\\backslashes", "with\ttabs", ""],
      [sym("numbers"), 0, 7, -7, 0.001, -123.456, 1e21, 5e-7],
      [sym("mixed"), 1, [sym("nested")], "after", 2],
    ];
    for (const tree of trees) {
      expect(parse(serialize(tree))).toEqual(tree);
    }
  });
});
