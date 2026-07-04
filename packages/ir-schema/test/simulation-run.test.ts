import { describe, expect, it } from "vitest";
import { validateSimulationRun } from "../src/index";

/**
 * Acceptance tests for issue #5 — the `simulationRun` IR kind.
 * Mirrors the simulationRun example in .context/interchange-format.md.
 */
const minimalRun = {
  irVersion: "0.1.0",
  kind: "simulationRun",
  id: "sim_00000000000000000000000000000000",
  netlistId: "net_00000000000000000000000000000000",
  engine: "ngspice",
  mode: "transient",
  config: { duration: "10ms", step: "1us" },
  status: "completed",
  results: {
    format: "waveform-v1",
    signals: [{ netId: "net_vcc", unit: "V", samples: "s3://openbench-results/vcc.bin" }],
  },
  logs: "s3://openbench-results/sim.log",
  provenance: { source: "mcp-sim-ngspice", at: "2026-07-02T00:00:00Z" },
};

const clone = () => structuredClone(minimalRun) as Record<string, any>;

describe("validateSimulationRun", () => {
  it("accepts the canonical completed run", () => {
    const result = validateSimulationRun(minimalRun);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a queued run without results or logs", () => {
    const doc = clone();
    doc.status = "queued";
    delete doc.results;
    delete doc.logs;
    const result = validateSimulationRun(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an id not matching sim_*", () => {
    const doc = clone();
    doc.id = "run_1";
    const result = validateSimulationRun(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("rejects an engine outside ngspice|renode|qemu", () => {
    const doc = clone();
    doc.engine = "ltspice";
    const result = validateSimulationRun(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "engine")).toBe(true);
  });

  it("accepts renode and qemu engines", () => {
    for (const engine of ["renode", "qemu"]) {
      const doc = clone();
      doc.engine = engine;
      expect(validateSimulationRun(doc).valid).toBe(true);
    }
  });

  it("rejects a status outside queued|running|completed|failed", () => {
    const doc = clone();
    doc.status = "done";
    const result = validateSimulationRun(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "status")).toBe(true);
  });

  it("rejects results with a format other than waveform-v1", () => {
    const doc = clone();
    doc.results.format = "waveform-v2";
    const result = validateSimulationRun(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "results.format")).toBe(true);
  });

  it("rejects signal samples that are neither a URL nor a data: URI", () => {
    const doc = clone();
    doc.results.signals[0].samples = "just some bytes";
    const result = validateSimulationRun(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "results.signals.0.samples")).toBe(true);
  });

  it("accepts data: URI samples", () => {
    const doc = clone();
    doc.results.signals[0].samples = "data:application/octet-stream;base64,AAAA";
    const result = validateSimulationRun(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string mode", () => {
    const doc = clone();
    doc.mode = 42;
    const result = validateSimulationRun(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "mode")).toBe(true);
  });

  // Issue #36: ngspice grows two additive modes beyond "transient".
  it.each(["ac", "dcSweep"])("accepts the additive mode %s", (mode) => {
    const doc = clone();
    doc.mode = mode;
    const result = validateSimulationRun(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts an AC run carrying dB/deg magnitude+phase over a frequency axis", () => {
    const doc = clone();
    doc.mode = "ac";
    doc.config = { sweep: "dec", points: 10, fStart: "1", fStop: "1meg" };
    doc.results.signals = [
      { netId: "net_vout", unit: "dB", samples: "s3://openbench-results/vout.mag.bin" },
      { netId: "net_vout", unit: "deg", samples: "s3://openbench-results/vout.phase.bin" },
      { netId: "frequency", unit: "Hz", samples: "s3://openbench-results/freq.bin" },
    ];
    const result = validateSimulationRun(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a DC-sweep run whose x-axis is the swept source, not time", () => {
    const doc = clone();
    doc.mode = "dcSweep";
    doc.config = { source: "V1", start: 0, stop: 5, step: 0.1 };
    doc.results.signals = [
      { netId: "net_vout", unit: "V", samples: "s3://openbench-results/vout.bin" },
      { netId: "V1", unit: "V", samples: "s3://openbench-results/sweep.bin" },
    ];
    const result = validateSimulationRun(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
