import { describe, expect, it } from "vitest";
import { MockBackend } from "../src/backend";
import { buildSpiceDeck } from "../src/deck";
import { acConfig, dcSweepConfig, dividerNetlist, rcNetlist, transientConfig } from "./fixture";

const deck = () => buildSpiceDeck(rcNetlist, transientConfig);

describe("MockBackend", () => {
  it("has a name", () => {
    expect(new MockBackend().name).toBe("mock");
  });

  it("generates 256 samples per probe plus a matching x (time) vector", async () => {
    const result = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    expect(result.x.length).toBe(256);
    expect(Object.keys(result.signals).sort()).toEqual(["v(1)", "v(2)"]);
    expect(result.signals["v(1)"]!.length).toBe(256);
    expect(result.signals["v(2)"]!.length).toBe(256);
  });

  it("spans the parsed .tran duration (10ms → last time point 0.01s)", async () => {
    const result = await new MockBackend().run(deck(), ["v(1)"]);
    expect(result.x[0]).toBe(0);
    expect(result.x[255]).toBeCloseTo(0.01, 12);
  });

  it("is deterministic across runs", async () => {
    const a = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    const b = await new MockBackend().run(deck(), ["v(1)", "v(2)"]);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
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

  it("rejects when the deck has no analysis card", async () => {
    await expect(
      new MockBackend().run("* OpenBench net_x\n.end\n", ["v(1)"]),
    ).rejects.toThrow(/analysis card|\.tran|\.ac|\.dc/);
  });
});

/**
 * Acceptance (issue #36): AC analysis returns magnitude + phase over a
 * frequency x-axis. The mock models the deck's first-RC single-pole low-pass,
 * so a 1k/1u RC divider must show its -3 dB corner at ~159 Hz.
 */
describe("MockBackend — AC analysis", () => {
  const acDeck = () => buildSpiceDeck(rcNetlist, acConfig);

  it("returns a frequency x-axis spanning fStart..fStop plus per-probe phase", async () => {
    const result = await new MockBackend().run(acDeck(), ["v(2)"]);
    expect(result.x[0]).toBeCloseTo(1, 6);
    expect(result.x[result.x.length - 1]).toBeCloseTo(1e6, 0);
    // strictly increasing frequencies
    for (let i = 1; i < result.x.length; i++) expect(result.x[i]!).toBeGreaterThan(result.x[i - 1]!);
    expect(result.phase).toBeDefined();
    expect(result.phase!["v(2)"]!.length).toBe(result.signals["v(2)"]!.length);
  });

  it("magnitude is 0 dB in-band and rolls off; -3 dB corner ≈ 159 Hz (RC=1k·1u)", async () => {
    const { x, signals } = await new MockBackend().run(acDeck(), ["v(2)"]);
    const mag = signals["v(2)"]!;
    // In-band (near fStart) the low-pass passes ~unity.
    expect(mag[0]!).toBeCloseTo(0, 1);
    // Monotonic roll-off.
    expect(mag[mag.length - 1]!).toBeLessThan(-40);
    // Recover the -3.0103 dB crossing frequency by log-interpolation.
    const target = -3.0103;
    let corner = NaN;
    for (let i = 1; i < mag.length; i++) {
      if (mag[i - 1]! >= target && mag[i]! < target) {
        const t = (target - mag[i - 1]!) / (mag[i]! - mag[i - 1]!);
        const logf = Math.log10(x[i - 1]!) + t * (Math.log10(x[i]!) - Math.log10(x[i - 1]!));
        corner = 10 ** logf;
        break;
      }
    }
    const expected = 1 / (2 * Math.PI * 1000 * 1e-6); // ≈ 159.155 Hz
    expect(corner).toBeGreaterThan(expected * 0.9);
    expect(corner).toBeLessThan(expected * 1.1);
  });

  it("phase falls from ~0° toward -90° across the corner", async () => {
    const { phase } = await new MockBackend().run(acDeck(), ["v(2)"]);
    const ph = phase!["v(2)"]!;
    expect(ph[0]!).toBeCloseTo(0, 0);
    expect(ph[ph.length - 1]!).toBeLessThan(-80);
  });
});

/**
 * Acceptance (issue #36): DC sweep returns output over the swept variable
 * (not time); a resistive 2:1 divider is a linear transfer of slope ~0.5.
 */
describe("MockBackend — DC sweep", () => {
  const dcDeck = () => buildSpiceDeck(dividerNetlist, dcSweepConfig);

  it("x-axis is the swept source values start..stop by step (no phase)", async () => {
    const { x, phase } = await new MockBackend().run(dcDeck(), ["v(2)"]);
    expect(x[0]).toBeCloseTo(0, 9);
    expect(x[x.length - 1]).toBeCloseTo(5, 9);
    expect(x.length).toBe(51); // 0,0.1,…,5
    expect(phase).toBeUndefined();
  });

  it("returns a linear transfer: vout = 0.5 · vin for the first probe", async () => {
    const { x, signals } = await new MockBackend().run(dcDeck(), ["v(2)"]);
    const out = signals["v(2)"]!;
    for (let i = 0; i < x.length; i++) expect(out[i]!).toBeCloseTo(0.5 * x[i]!, 9);
  });

  it("is deterministic", async () => {
    const a = await new MockBackend().run(dcDeck(), ["v(2)"]);
    const b = await new MockBackend().run(dcDeck(), ["v(2)"]);
    expect(Array.from(a.signals["v(2)"]!)).toEqual(Array.from(b.signals["v(2)"]!));
  });
});
