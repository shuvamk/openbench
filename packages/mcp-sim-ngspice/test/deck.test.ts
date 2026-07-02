import { describe, expect, it } from "vitest";
import { buildSpiceDeck, NgspiceAdapterError } from "../src/deck";
import { rcNetlist, transientConfig } from "./fixture";

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
});
