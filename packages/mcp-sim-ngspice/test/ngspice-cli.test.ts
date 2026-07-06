import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NgspiceAdapterError } from "../src/deck";
import { NgspiceCliBackend, parseNgspiceOutput } from "../src/backend";
import { runSimulation } from "../src/index";
import { rcNetlist } from "./fixture";

/**
 * Acceptance tests for issue #118 — the desktop-facing native ngspice CLI
 * backend. It shells out to a bundled `ngspice` binary in batch mode and parses
 * the `wrdata` ASCII column output (per the issue's "decisions assumed": plain
 * ASCII is simpler + more robust to parse than the binary rawfile that the
 * pre-existing #30 `NativeNgspiceBackend` decodes). Feature-detected like
 * `PioCliBackend`: an absent binary is a structured failure, never a crash.
 *
 * The binary is never invoked here — availability is probed against a name that
 * cannot exist, and the happy path runs through an injected executor returning a
 * fixture. Real-binary behaviour is covered by the bundling issue's smoke test.
 */

const WRDATA_FIXTURE = readFileSync(
  fileURLToPath(new URL("./fixtures/ngspice-wrdata.txt", import.meta.url)),
  "utf8",
);

describe("NgspiceCliBackend", () => {
  it('is named "ngspice-cli"', () => {
    expect(new NgspiceCliBackend().name).toBe("ngspice-cli");
  });

  it("surfaces an absent binary as a structured, engine-unavailable failure (never throws) via runSimulation", async () => {
    const backend = new NgspiceCliBackend({ ngspiceBinary: "definitely-not-a-real-binary" });
    const run = await runSimulation(
      rcNetlist,
      { mode: "transient", duration: "1ms", step: "250us" },
      backend,
    );
    expect(run.status).toBe("failed");
    expect(run.results).toBeUndefined();
    const b64 = run.logs!.slice("data:text/plain;base64,".length);
    const log = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    expect(log.toLowerCase()).toContain("engine-unavailable");
  });

  it("run() rejects with an engine-unavailable NgspiceAdapterError when the binary is absent", async () => {
    const backend = new NgspiceCliBackend({ ngspiceBinary: "definitely-not-a-real-binary" });
    await expect(backend.run("* deck\n.tran 1u 1m\n.end\n", ["v(1)"])).rejects.toMatchObject({
      name: "NgspiceAdapterError",
    });
  });

  it("runs a transient through an injected executor and shapes the wrdata into a BackendResult", async () => {
    const backend = new NgspiceCliBackend({
      isAvailable: () => true,
      execute: async () => WRDATA_FIXTURE,
    });
    const result = await backend.run("* deck\n.tran 1m 3m\n.end\n", ["v(1)", "v(2)"]);
    expect(Array.from(result.x)).toEqual([0, 1e-3, 2e-3, 3e-3]);
    expect(Array.from(result.signals["v(1)"]!)).toEqual([5, 5, 5, 5]);
    expect(Array.from(result.signals["v(2)"]!)).toEqual([2.5, 2.4, 2.3, 2.2]);
  });
});

describe("parseNgspiceOutput", () => {
  it("parses interleaved wrdata columns (one scale per probe) into {time, signals}", () => {
    const { time, signals } = parseNgspiceOutput(WRDATA_FIXTURE, ["v(1)", "v(2)"]);
    expect(time).toBeInstanceOf(Float64Array);
    expect(time.length).toBe(4);
    expect(Array.from(time)).toEqual([0, 1e-3, 2e-3, 3e-3]);
    expect(Array.from(signals["v(1)"]!)).toEqual([5, 5, 5, 5]);
    expect(Array.from(signals["v(2)"]!)).toEqual([2.5, 2.4, 2.3, 2.2]);
  });

  it("parses shared-scale wrdata columns (one leading scale, then per-probe values)", () => {
    const shared = "0  5  2.5\n1  5  2.4\n2  5  2.3\n";
    const { time, signals } = parseNgspiceOutput(shared, ["v(1)", "v(2)"]);
    expect(Array.from(time)).toEqual([0, 1, 2]);
    expect(Array.from(signals["v(1)"]!)).toEqual([5, 5, 5]);
    expect(Array.from(signals["v(2)"]!)).toEqual([2.5, 2.4, 2.3]);
  });

  it("throws a structured NgspiceAdapterError on empty output (never an unhandled crash)", () => {
    expect(() => parseNgspiceOutput("   \n  \n", ["v(1)"])).toThrow(NgspiceAdapterError);
  });

  it("throws a structured NgspiceAdapterError when the column count matches no known layout", () => {
    // 3 columns cannot be an interleaved (2·2=4) nor shared (2+1=3 ✓)… use a count
    // that fits neither: 2 probes want 4 or 3 columns; give 5.
    const malformed = "0 1 2 3 4\n0 1 2 3 4\n";
    expect(() => parseNgspiceOutput(malformed, ["v(1)", "v(2)"])).toThrow(NgspiceAdapterError);
  });
});
