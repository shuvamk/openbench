import { describe, expect, it } from "vitest";
import { buildSpiceDeck, NgspiceAdapterError } from "../src/deck";
import { acConfig, dcSweepConfig, dividerNetlist, rcNetlist, transientConfig } from "./fixture";

const cardLines = (netlist: typeof rcNetlist, config: Parameters<typeof buildSpiceDeck>[1]) =>
  buildSpiceDeck(netlist, config).trimEnd().split("\n");

/**
 * Acceptance (issue #9, bullet 1): deck contains title, all cards,
 * .tran step duration, .end.
 */
describe("buildSpiceDeck", () => {
  it("lays out title, one line per element card, .tran and .end", () => {
    const deck = buildSpiceDeck(rcNetlist, transientConfig);
    const lines = deck.trimEnd().split("\n");
    expect(lines[0]).toBe("* OpenBench net_fixture_rc");
    expect(lines[1]).toBe("V1 1 0 DC 5");
    expect(lines[2]).toBe("R1 1 2 1k");
    expect(lines[3]).toBe("C1 2 0 1u");
    expect(lines[4]).toBe(".tran 1us 10ms");
    expect(lines[5]).toBe(".end");
    expect(lines).toHaveLength(6);
  });

  it("contains every element spiceCard exactly as given", () => {
    const deck = buildSpiceDeck(rcNetlist, transientConfig);
    for (const element of rcNetlist.elements) {
      expect(deck).toContain(element.spiceCard);
    }
  });

  it("accepts common SPICE time value spellings", () => {
    for (const value of ["10ms", "1us", "100n", "5e-3", "0.5s", "2meg", "3"]) {
      expect(() =>
        buildSpiceDeck(rcNetlist, { duration: value, step: "1us" }),
      ).not.toThrow();
    }
  });

  it("rejects a malformed duration with a structured error", () => {
    let caught: unknown;
    try {
      buildSpiceDeck(rcNetlist, { duration: "ten miles", step: "1us" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NgspiceAdapterError);
    const err = caught as NgspiceAdapterError;
    expect(err.errors.some((e) => e.path === "config.duration")).toBe(true);
    expect(err.errors.every((e) => typeof e.message === "string")).toBe(true);
  });

  it("rejects a malformed step with a structured error", () => {
    let caught: unknown;
    try {
      buildSpiceDeck(rcNetlist, { duration: "10ms", step: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NgspiceAdapterError);
    const err = caught as NgspiceAdapterError;
    expect(err.errors.some((e) => e.path === "config.step")).toBe(true);
  });

  it("treats an explicit mode:'transient' the same as the flat transient config", () => {
    const flat = buildSpiceDeck(rcNetlist, transientConfig);
    const explicit = buildSpiceDeck(rcNetlist, { mode: "transient", duration: "10ms", step: "1us" });
    expect(explicit).toBe(flat);
  });
});

/**
 * Acceptance (issue #36): AC analysis mode emits `.ac <sweep> <points> <fStart> <fStop>`.
 */
describe("buildSpiceDeck — AC analysis", () => {
  it("emits `.ac dec 10 1 1meg` in place of the .tran card", () => {
    const lines = cardLines(rcNetlist, acConfig);
    expect(lines[0]).toBe("* OpenBench net_fixture_rc");
    expect(lines).toContain(".ac dec 10 1 1meg");
    expect(lines).not.toContain(".tran 1us 10ms");
    expect(lines.some((l) => l.startsWith(".tran"))).toBe(false);
    expect(lines[lines.length - 1]).toBe(".end");
  });

  it("keeps every element card", () => {
    const deck = buildSpiceDeck(rcNetlist, acConfig);
    for (const element of rcNetlist.elements) expect(deck).toContain(element.spiceCard);
  });

  it("supports oct and lin sweep types", () => {
    expect(cardLines(rcNetlist, { ...acConfig, sweep: "oct" as const })).toContain(
      ".ac oct 10 1 1meg",
    );
    expect(cardLines(rcNetlist, { ...acConfig, sweep: "lin" as const, points: 100 })).toContain(
      ".ac lin 100 1 1meg",
    );
  });

  it("rejects fStop < fStart with a structured error (never throws a bare Error)", () => {
    let caught: unknown;
    try {
      buildSpiceDeck(rcNetlist, { ...acConfig, fStart: "1meg", fStop: "1" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NgspiceAdapterError);
    expect((caught as NgspiceAdapterError).errors.some((e) => e.path === "config.fStop")).toBe(true);
  });

  it("rejects non-positive points and a bad sweep type", () => {
    expect(() => buildSpiceDeck(rcNetlist, { ...acConfig, points: 0 })).toThrow(NgspiceAdapterError);
    expect(() =>
      buildSpiceDeck(rcNetlist, { ...acConfig, sweep: "logarithmic" as never }),
    ).toThrow(NgspiceAdapterError);
  });
});

/**
 * Acceptance (issue #36): DC-sweep mode emits `.dc <source> <start> <stop> <step>`.
 */
describe("buildSpiceDeck — DC sweep", () => {
  it("emits `.dc V1 0 5 0.1` in place of the .tran card", () => {
    const lines = cardLines(dividerNetlist, dcSweepConfig);
    expect(lines[0]).toBe("* OpenBench net_fixture_divider");
    expect(lines).toContain(".dc V1 0 5 0.1");
    expect(lines.some((l) => l.startsWith(".tran"))).toBe(false);
    expect(lines[lines.length - 1]).toBe(".end");
  });

  it("keeps every element card", () => {
    const deck = buildSpiceDeck(dividerNetlist, dcSweepConfig);
    for (const element of dividerNetlist.elements) expect(deck).toContain(element.spiceCard);
  });

  it("rejects step 0 with a structured error", () => {
    let caught: unknown;
    try {
      buildSpiceDeck(dividerNetlist, { ...dcSweepConfig, step: 0 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NgspiceAdapterError);
    expect((caught as NgspiceAdapterError).errors.some((e) => e.path === "config.step")).toBe(true);
  });

  it("rejects an empty source name", () => {
    expect(() => buildSpiceDeck(dividerNetlist, { ...dcSweepConfig, source: "" })).toThrow(
      NgspiceAdapterError,
    );
  });
});
