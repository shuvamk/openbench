import { validateSimulationRun } from "@openbench/ir-schema";
import { describe, expect, it } from "vitest";
import { MockBackend } from "../src/backend";
import { runSimulation } from "../src/index";
import { decodeSamples } from "../src/samples";
import { rcNetlist } from "./fixture";

const config = { mode: "transient" as const, duration: "10ms", step: "1us" };
const NOW = "2026-07-02T12:00:00Z";

describe("runSimulation (MockBackend)", () => {
  /**
   * Acceptance (issue #9, bullet 2): runSimulation(mock) returns status
   * completed, one signal per requested net, decodable samples of expected
   * length.
   */
  it("completes with one V signal per requested net, decodable at 256 samples", async () => {
    const run = await runSimulation(
      rcNetlist,
      { ...config, probes: ["net_vout"] },
      new MockBackend(),
      { now: NOW },
    );
    expect(run.status).toBe("completed");
    expect(run.results).toBeDefined();
    expect(run.results!.format).toBe("waveform-v1");
    const voltageSignals = run.results!.signals.filter((s) => s.netId !== "time");
    expect(voltageSignals.map((s) => s.netId)).toEqual(["net_vout"]);
    expect(voltageSignals[0]!.unit).toBe("V");
    expect(decodeSamples(voltageSignals[0]!.samples).length).toBe(256);
  });

  it("defaults probes to all non-ground nets and adds a time signal in seconds", async () => {
    const run = await runSimulation(rcNetlist, config, new MockBackend(), { now: NOW });
    expect(run.status).toBe("completed");
    const netIds = run.results!.signals.map((s) => s.netId);
    expect(netIds).toContain("net_vin");
    expect(netIds).toContain("net_vout");
    expect(netIds).toContain("time");
    // ground (spice node "0") is never probed
    expect(netIds).not.toContain("net_gnd");
    const time = run.results!.signals.find((s) => s.netId === "time")!;
    expect(time.unit).toBe("s");
    const decoded = decodeSamples(time.samples);
    expect(decoded.length).toBe(256);
    expect(decoded[255]).toBeCloseTo(0.01, 12);
  });

  it("produces a document that passes validateSimulationRun, with provenance mcp-sim-ngspice", async () => {
    const run = await runSimulation(rcNetlist, config, new MockBackend(), { now: NOW });
    const result = validateSimulationRun(run);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(run.id).toMatch(/^sim_[a-z0-9_-]+$/);
    expect(run.netlistId).toBe("net_fixture_rc");
    expect(run.engine).toBe("ngspice");
    expect(run.mode).toBe("transient");
    expect(run.config).toEqual({ duration: "10ms", step: "1us" });
    expect(run.provenance.source).toBe("mcp-sim-ngspice");
    expect(run.provenance.at).toBe(NOW);
  });

  /**
   * Acceptance (issue #9, bullet 3): backend failure → status failed with
   * logs, never throws.
   */
  it("maps a backend rejection to status failed with the message in logs, without throwing", async () => {
    const run = await runSimulation(
      rcNetlist,
      config,
      new MockBackend({ fail: "convergence failure at t=1.2ms" }),
      { now: NOW },
    );
    expect(run.status).toBe("failed");
    expect(run.results).toBeUndefined();
    expect(run.logs).toBeDefined();
    expect(run.logs!.startsWith("data:text/plain;base64,")).toBe(true);
    const b64 = run.logs!.slice("data:text/plain;base64,".length);
    // Decode base64 → utf-8 text (node-safe, no Buffer dependency in the test)
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toContain("convergence failure at t=1.2ms");
    const result = validateSimulationRun(run);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("fails (not throws) on an invalid transient config", async () => {
    const run = await runSimulation(
      rcNetlist,
      { ...config, duration: "banana" },
      new MockBackend(),
      { now: NOW },
    );
    expect(run.status).toBe("failed");
    expect(validateSimulationRun(run).valid).toBe(true);
  });

  it("fails (not throws) when a probe references an unknown net", async () => {
    const run = await runSimulation(
      rcNetlist,
      { ...config, probes: ["net_nope"] },
      new MockBackend(),
      { now: NOW },
    );
    expect(run.status).toBe("failed");
    expect(run.logs).toBeDefined();
    expect(validateSimulationRun(run).valid).toBe(true);
  });
});
