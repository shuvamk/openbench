import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateSimulationRun } from "@openbench/ir-schema";
import { describe, expect, it } from "vitest";
import { NativeNgspiceBackend } from "../src/backend";
import { runSimulation } from "../src/index";
import { decodeSamples } from "../src/samples";
import { rcNetlist } from "./fixture";

const opFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/rc-op.raw", import.meta.url)),
  "utf8",
);
const NOW = "2026-07-05T12:00:00Z";

describe("NativeNgspiceBackend.detect (feature detection)", () => {
  it("returns a structured engine-unavailable result when the binary is absent — never throws", async () => {
    const backend = new NativeNgspiceBackend({ locate: async () => null });
    const availability = await backend.detect();
    expect(availability.available).toBe(false);
    expect(typeof availability.reason).toBe("string");
    expect(availability.reason!.length).toBeGreaterThan(0);
  });

  it("swallows a locate() failure into a structured unavailable result — never throws", async () => {
    const backend = new NativeNgspiceBackend({
      locate: async () => {
        throw new Error("boom");
      },
    });
    await expect(backend.detect()).resolves.toMatchObject({ available: false });
  });

  it("reports available with the resolved binary path when present", async () => {
    const backend = new NativeNgspiceBackend({ locate: async () => "/usr/bin/ngspice" });
    await expect(backend.detect()).resolves.toEqual({
      available: true,
      binaryPath: "/usr/bin/ngspice",
    });
  });
});

describe("runSimulation with NativeNgspiceBackend", () => {
  it("absent binary → status:failed run (never throws), engine-unavailable in logs", async () => {
    const backend = new NativeNgspiceBackend({ locate: async () => null });
    const run = await runSimulation(rcNetlist, { mode: "op" }, backend, { now: NOW });
    expect(run.status).toBe("failed");
    expect(run.results).toBeUndefined();
    const log = new TextDecoder().decode(decodeSamples(run.logs!));
    expect(log.toLowerCase()).toContain("unavailable");
  });

  it("op run parses ngspice rawfile output into single-sample signals", async () => {
    const backend = new NativeNgspiceBackend({
      locate: async () => "/usr/bin/ngspice",
      execute: async () => opFixture,
    });
    const run = await runSimulation(
      rcNetlist,
      { mode: "op", probes: ["net_vin", "net_vout"] },
      backend,
      { now: NOW },
    );
    expect(run.status).toBe("completed");
    expect(validateSimulationRun(run).ok).toBe(true);
    const byNet = Object.fromEntries(
      run.results!.signals.map((s) => [s.netId, Array.from(decodeSamples(s.samples))]),
    );
    // fixture: v(1)=5 (net_vin, spiceNode 1), v(2)=2.5 (net_vout, spiceNode 2)
    expect(byNet["net_vin"]).toEqual([5]);
    expect(byNet["net_vout"]).toEqual([2.5]);
  });
});
