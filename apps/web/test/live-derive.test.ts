import { describe, expect, it } from "vitest";
import type { Schematic, SimulationRun } from "@openbench/ir-schema";
import { IR_VERSION } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import { encodeSamples } from "@openbench/mcp-sim-ngspice";
import { deriveInstanceStates, LED_NOMINAL_CURRENT } from "../lib/live/derive";

/**
 * Issue #24 acceptance — pure physics derivation from net-voltage waveforms.
 * Voltages are what a real sim would report at the nodes (e.g. an LED fed
 * from 5V through 220R settles near its ~1.45V forward voltage for the
 * Is=1e-14/n=2 Shockley model used here).
 */

const AT = "2026-07-02T00:00:00Z";
const N = 8;

const constant = (value: number) => encodeSamples(new Float64Array(N).fill(value));

function makeRun(signals: Array<{ netId: string; samples: string }>): SimulationRun {
  return {
    irVersion: IR_VERSION,
    kind: "simulationRun",
    id: "sim_live_fixture",
    netlistId: "net_live_fixture",
    engine: "ngspice",
    mode: "transient",
    status: "completed",
    results: {
      format: "waveform-v1",
      signals: [
        { netId: "time", unit: "s", samples: encodeSamples(new Float64Array(N).map((_, i) => i * 1e-3)) },
        ...signals.map((s) => ({ ...s, unit: "V" })),
      ],
    },
    provenance: { source: "test", at: AT },
  };
}

function schematicWith(
  instances: Array<{ instanceId: string; componentId: string; parameterOverrides?: Record<string, number> }>,
  nets: Array<{ netId: string; name?: string; connections: Array<{ instanceId: string; pinId: string }> }>,
): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_live_fixture",
    projectId: "proj_live_fixture",
    instances,
    nets,
    provenance: { source: "test", at: AT },
  } as Schematic;
}

describe("deriveInstanceStates", () => {
  it("LED at its forward voltage glows near full brightness with ~15mA", () => {
    const schematic = schematicWith(
      [
        { instanceId: "D1", componentId: "cmp_led_generic" },
        { instanceId: "GND1", componentId: "cmp_ground" },
      ],
      [
        { netId: "net_a", connections: [{ instanceId: "D1", pinId: "anode" }] },
        {
          netId: "net_k",
          name: "GND",
          connections: [
            { instanceId: "D1", pinId: "cathode" },
            { instanceId: "GND1", pinId: "gnd" },
          ],
        },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_a", samples: constant(1.45) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const led = result.states.get("D1")!;
    expect(led.kind).toBe("led");
    const current = led.series.current![0]!;
    expect(current).toBeGreaterThan(0.010);
    expect(current).toBeLessThan(0.025);
    expect(led.series.brightness![0]!).toBeGreaterThan(0.6);
    expect(led.series.brightness![0]!).toBeLessThanOrEqual(1);
  });

  it("reverse-biased LED stays dark", () => {
    const schematic = schematicWith(
      [{ instanceId: "D1", componentId: "cmp_led_generic" }],
      [
        { netId: "net_a", connections: [{ instanceId: "D1", pinId: "anode" }] },
        { netId: "net_k", connections: [{ instanceId: "D1", pinId: "cathode" }] },
      ],
    );
    const result = deriveInstanceStates(
      schematic,
      getComponent,
      makeRun([
        { netId: "net_a", samples: constant(0) },
        { netId: "net_k", samples: constant(5) },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.states.get("D1")!.series.brightness![0]).toBe(0);
  });

  it("motor at half its nominal voltage spins at rpmFraction 0.5", () => {
    const schematic = schematicWith(
      [{ instanceId: "M1", componentId: "cmp_dc_motor" }],
      [
        { netId: "net_p", connections: [{ instanceId: "M1", pinId: "p1" }] },
        { netId: "net_n", name: "GND", connections: [{ instanceId: "M1", pinId: "p2" }] },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_p", samples: constant(3) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const motor = result.states.get("M1")!;
    expect(motor.kind).toBe("motor");
    expect(motor.series.rpmFraction![0]).toBeCloseTo(0.5, 5);
  });

  it("lamp intensity follows power; buzzer reports on/off", () => {
    const schematic = schematicWith(
      [
        { instanceId: "LA1", componentId: "cmp_lamp" },
        { instanceId: "BZ1", componentId: "cmp_buzzer" },
      ],
      [
        {
          netId: "net_v",
          connections: [
            { instanceId: "LA1", pinId: "p1" },
            { instanceId: "BZ1", pinId: "p1" },
          ],
        },
        {
          netId: "net_g",
          name: "GND",
          connections: [
            { instanceId: "LA1", pinId: "p2" },
            { instanceId: "BZ1", pinId: "p2" },
          ],
        },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_v", samples: constant(5) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lamp = result.states.get("LA1")!;
    // 5V across 60R → 0.417W → intensity clamps vs the 0.25W nominal
    expect(lamp.kind).toBe("lamp");
    expect(lamp.series.intensity![0]).toBe(1);
    const buzzer = result.states.get("BZ1")!;
    expect(buzzer.kind).toBe("buzzer");
    expect(buzzer.series.on![0]).toBe(1);
  });

  it("switch state derives from its derived on/off resistance", () => {
    const schematic = schematicWith(
      [
        { instanceId: "BTN1", componentId: "cmp_pushbutton", parameterOverrides: { pressed: 1 } },
        { instanceId: "SW1", componentId: "cmp_switch_spst" },
      ],
      [
        {
          netId: "net_x",
          connections: [
            { instanceId: "BTN1", pinId: "p1" },
            { instanceId: "SW1", pinId: "p1" },
          ],
        },
        {
          netId: "net_y",
          name: "GND",
          connections: [
            { instanceId: "BTN1", pinId: "p2" },
            { instanceId: "SW1", pinId: "p2" },
          ],
        },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_x", samples: constant(0) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.states.get("BTN1")!.series.closed![0]).toBe(1);
    expect(result.states.get("SW1")!.series.closed![0]).toBe(0);
  });

  it("resistor current uses the override-resolved resistance", () => {
    const schematic = schematicWith(
      [{ instanceId: "R1", componentId: "cmp_resistor_generic", parameterOverrides: { resistance: 100 } }],
      [
        { netId: "net_a", connections: [{ instanceId: "R1", pinId: "p1" }] },
        { netId: "net_b", name: "GND", connections: [{ instanceId: "R1", pinId: "p2" }] },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_a", samples: constant(2) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.states.get("R1")!;
    expect(r.series.current![0]).toBeCloseTo(0.02, 6);
    expect(r.series.power![0]).toBeCloseTo(0.04, 6);
  });

  it("timeline lengths match the sample count and unprobed instances degrade to unknown", () => {
    const schematic = schematicWith(
      [
        { instanceId: "R1", componentId: "cmp_resistor_generic" },
        { instanceId: "R2", componentId: "cmp_resistor_generic" },
      ],
      [
        { netId: "net_a", connections: [{ instanceId: "R1", pinId: "p1" }] },
        { netId: "net_b", name: "GND", connections: [{ instanceId: "R1", pinId: "p2" }] },
        { netId: "net_c", connections: [{ instanceId: "R2", pinId: "p1" }] },
        { netId: "net_d", connections: [{ instanceId: "R2", pinId: "p2" }] },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_a", samples: constant(1) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.time.length).toBe(N);
    expect(result.states.get("R1")!.series.current!.length).toBe(N);
    // net_c / net_d were never probed → R2 cannot be derived
    expect(result.states.get("R2")!.kind).toBe("unknown");
  });

  it("a run without a time signal is a structured failure", () => {
    const schematic = schematicWith([], []);
    const run = makeRun([]);
    run.results!.signals = run.results!.signals.filter((s) => s.netId !== "time");
    const result = deriveInstanceStates(schematic, getComponent, run);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toContain("results");
  });

  it("exports the LED nominal current used for brightness scaling", () => {
    expect(LED_NOMINAL_CURRENT).toBeGreaterThan(0);
  });

  it("a sine voltage source derives a voltage series like the DC/pulse sources", () => {
    const schematic = schematicWith(
      [{ instanceId: "V1", componentId: "cmp_vsource_sin" }],
      [
        { netId: "net_p", connections: [{ instanceId: "V1", pinId: "pos" }] },
        { netId: "net_n", name: "GND", connections: [{ instanceId: "V1", pinId: "neg" }] },
      ],
    );
    const result = deriveInstanceStates(schematic, getComponent, makeRun([{ netId: "net_p", samples: constant(3.3) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = result.states.get("V1")!;
    expect(source.kind).toBe("source");
    expect(source.series.voltage![0]).toBeCloseTo(3.3, 6);
  });
});
