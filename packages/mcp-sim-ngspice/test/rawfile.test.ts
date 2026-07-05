import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRawfile, serializeRawfile, type RawPlot } from "../src/rawfile";

const opFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/rc-op.raw", import.meta.url)),
  "utf8",
);

describe("parseRawfile", () => {
  it("parses the checked-in operating-point fixture", () => {
    const plot = parseRawfile(opFixture);
    expect(plot.plotname).toBe("Operating Point");
    expect(plot.flags).toContain("real");
    expect(plot.points).toBe(1);
    expect(plot.variables.map((v) => v.name)).toEqual(["v(1)", "v(2)"]);
    // one sample per signal, at the operating point
    expect(Array.from(plot.vectors["v(1)"]!)).toEqual([5]);
    expect(Array.from(plot.vectors["v(2)"]!)).toEqual([2.5]);
  });

  it("parses a multi-point transient rawfile (index + continuation lines)", () => {
    const tran = [
      "Title: * OpenBench net_x",
      "Date: Sun Jul  5 12:00:00 2026",
      "Plotname: Transient Analysis",
      "Flags: real",
      "No. Variables: 2",
      "No. Points: 3",
      "Variables:",
      "\t0\ttime\ttime",
      "\t1\tv(2)\tvoltage",
      "Values:",
      "\t0\t0.0000000000000000e+00",
      "\t0.0000000000000000e+00",
      "\t1\t1.0000000000000000e-06",
      "\t5.0000000000000000e-01",
      "\t2\t2.0000000000000000e-06",
      "\t1.0000000000000000e+00",
      "",
    ].join("\n");
    const plot = parseRawfile(tran);
    expect(plot.points).toBe(3);
    expect(Array.from(plot.vectors["time"]!)).toEqual([0, 1e-6, 2e-6]);
    expect(Array.from(plot.vectors["v(2)"]!)).toEqual([0, 0.5, 1]);
  });

  it("throws a structured error when the header point/variable counts disagree with the data", () => {
    const broken = opFixture.replace("No. Points: 1", "No. Points: 2");
    expect(() => parseRawfile(broken)).toThrowError(/point|values/i);
  });
});

describe("serializeRawfile round-trip", () => {
  it("parse(serialize(plot)) deep-equals the parsed fixture", () => {
    const original = parseRawfile(opFixture);
    const roundTripped = parseRawfile(serializeRawfile(original));
    expect(roundTripped.plotname).toBe(original.plotname);
    expect(roundTripped.flags).toEqual(original.flags);
    expect(roundTripped.points).toBe(original.points);
    expect(roundTripped.variables).toEqual(original.variables);
    for (const v of original.variables) {
      expect(Array.from(roundTripped.vectors[v.name]!)).toEqual(
        Array.from(original.vectors[v.name]!),
      );
    }
  });

  it("round-trips arbitrary double precision values exactly", () => {
    const plot: RawPlot = {
      title: "* precision",
      plotname: "Operating Point",
      flags: ["real"],
      variables: [{ index: 0, name: "v(a)", type: "voltage" }],
      points: 3,
      vectors: { "v(a)": new Float64Array([Math.PI, 1 / 3, -6.02214076e23]) },
    };
    const back = parseRawfile(serializeRawfile(plot));
    expect(Array.from(back.vectors["v(a)"]!)).toEqual([Math.PI, 1 / 3, -6.02214076e23]);
  });
});
