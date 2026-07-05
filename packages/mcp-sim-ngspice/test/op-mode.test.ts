import { validateSimulationRun } from "@openbench/ir-schema";
import { describe, expect, it } from "vitest";
import { MockBackend } from "../src/backend";
import { buildSpiceDeck } from "../src/deck";
import { runSimulation } from "../src/index";
import { decodeSamples } from "../src/samples";
import { rcNetlist } from "./fixture";

const NOW = "2026-07-05T12:00:00Z";

describe("operating-point (op) deck", () => {
  it("emits a .op card and no .tran", () => {
    const deck = buildSpiceDeck(rcNetlist, { mode: "op" });
    expect(deck).toMatch(/^\.op\s*$/m);
    expect(deck).not.toMatch(/\.tran/);
  });
});

describe("runSimulation op mode (MockBackend)", () => {
  it("yields single-sample V signals that validate as a simulationRun", async () => {
    const run = await runSimulation(
      rcNetlist,
      { mode: "op", probes: ["net_vin", "net_vout"] },
      new MockBackend(),
      { now: NOW },
    );

    expect(run.status).toBe("completed");
    expect(run.mode).toBe("op");
    expect(validateSimulationRun(run).valid).toBe(true);

    const signals = run.results!.signals;
    // op has no independent axis — no time/frequency signal, just the probes.
    expect(signals.map((s) => s.netId).sort()).toEqual(["net_vin", "net_vout"]);
    for (const s of signals) {
      expect(s.unit).toBe("V");
      expect(decodeSamples(s.samples).length).toBe(1);
    }
  });

  it("defaults probes to all non-ground nets", async () => {
    const run = await runSimulation(rcNetlist, { mode: "op" }, new MockBackend(), { now: NOW });
    expect(run.status).toBe("completed");
    const netIds = run.results!.signals.map((s) => s.netId);
    expect(netIds).toContain("net_vin");
    expect(netIds).toContain("net_vout");
    expect(netIds).not.toContain("net_gnd");
    expect(netIds).not.toContain("time");
  });
});
