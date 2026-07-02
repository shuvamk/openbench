import { describe, expect, it } from "vitest";
import { MockBackend } from "../src/backend";
import { buildSpiceDeck } from "../src/deck";
import { rcNetlist, transientConfig } from "./fixture";

const deck = () => buildSpiceDeck(rcNetlist, transientConfig);

describe("MockBackend", () => {
  it("has a name", () => {
    expect(new MockBackend().name).toBe("mock");
  });

  it("generates 256 samples per probe plus a matching time vector", async () => {
    const result = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    expect(result.time.length).toBe(256);
    expect(Object.keys(result.signals).sort()).toEqual(["v(1)", "v(2)"]);
    expect(result.signals["v(1)"]!.length).toBe(256);
    expect(result.signals["v(2)"]!.length).toBe(256);
  });

  it("spans the parsed .tran duration (10ms → last time point 0.01s)", async () => {
    const result = await new MockBackend().run(deck(), ["v(1)"]);
    expect(result.time[0]).toBe(0);
    expect(result.time[255]).toBeCloseTo(0.01, 12);
  });

  it("is deterministic across runs", async () => {
    const a = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    const b = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    expect(Array.from(a.time)).toEqual(Array.from(b.time));
    expect(Array.from(a.signals["v(1)"]!)).toEqual(Array.from(b.signals["v(1)"]!));
    expect(Array.from(a.signals["v(2)"]!)).toEqual(Array.from(b.signals["v(2)"]!));
  });

  it("gives each probe a distinct waveform", async () => {
    const { signals } = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    expect(Array.from(signals["v(1)"]!)).not.toEqual(Array.from(signals["v(2)"]!));
  });

  it("rejects with the configured failure message", async () => {
    const backend = new MockBackend({ fail: "ngspice exploded" });
    await expect(backend.run(deck(), ["v(1)"])).rejects.toThrow("ngspice exploded");
  });

  it("rejects when the deck has no .tran card", async () => {
    await expect(
      new MockBackend().run("* OpenBench net_x\n.end\n", ["v(1)"]),
    ).rejects.toThrow(/\.tran/);
  });
});
