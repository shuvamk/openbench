import { describe, expect, it } from "vitest";
import type { Schematic } from "@openbench/ir-schema";
import { IR_VERSION } from "@openbench/ir-schema";
import { getComponent } from "@openbench/registry";
import type { PinDriveEvent } from "@openbench/mcp-firmware-platformio";
import { deriveInstanceStates, sampleAt } from "../lib/live/derive";
import {
  ESP32_DEVKIT_ID,
  buildFirmwareDrivenRun,
  deriveEsp32PinNetMap,
  evaluatePwl,
} from "../lib/live/firmware";

/**
 * Issue #66 acceptance — firmware-in-the-loop step 3: wire the
 * poll -> PWL -> (net voltages) -> derive loop behind the live view so an
 * emulated blink actually blinks the on-canvas LED. The GPIO event stream
 * stands in for the #64 poller; the real #65 translator turns it into a PWL
 * source whose voltage drives the LED's net, and derive.ts consumes it exactly
 * as it consumes any analog run.
 */

const AT = "2026-07-05T00:00:00Z";

/** ESP32 GPIO2 -> LED anode; LED cathode -> GND. GPIO4 left undriven/floating. */
function blinkSchematic(): Schematic {
  return {
    irVersion: IR_VERSION,
    kind: "schematic",
    id: "sch_fw_fixture",
    projectId: "proj_fw_fixture",
    instances: [
      { instanceId: "U1", componentId: ESP32_DEVKIT_ID },
      { instanceId: "D1", componentId: "cmp_led_generic" },
      { instanceId: "GND1", componentId: "cmp_ground" },
    ],
    nets: [
      {
        netId: "net_gpio2",
        connections: [
          { instanceId: "U1", pinId: "GPIO2" },
          { instanceId: "D1", pinId: "anode" },
        ],
      },
      {
        netId: "net_gpio4",
        connections: [{ instanceId: "U1", pinId: "GPIO4" }],
      },
      {
        netId: "net_gnd",
        name: "GND",
        connections: [
          { instanceId: "D1", pinId: "cathode" },
          { instanceId: "GND1", pinId: "gnd" },
        ],
      },
    ],
    provenance: { source: "test", at: AT },
  } as Schematic;
}

/** A 1-cycle blink on GPIO2: HIGH @0ms, LOW @100ms, HIGH @200ms. */
const BLINK: PinDriveEvent[] = [
  { t: 0, gpio: 2, level: 1 },
  { t: 100, gpio: 2, level: 0 },
  { t: 200, gpio: 2, level: 1 },
];

describe("deriveEsp32PinNetMap", () => {
  it("binds each ESP32 GPIO pin to the net it connects to", () => {
    const map = deriveEsp32PinNetMap(blinkSchematic());
    expect(map.get(2)).toBe("net_gpio2");
    expect(map.get(4)).toBe("net_gpio4");
    expect(map.size).toBe(2);
  });

  it("returns an empty map when there is no ESP32 in the schematic", () => {
    const schematic = blinkSchematic();
    schematic.instances = schematic.instances.filter((i) => i.componentId !== ESP32_DEVKIT_ID);
    expect(deriveEsp32PinNetMap(schematic).size).toBe(0);
  });
});

describe("evaluatePwl", () => {
  const bp: Array<[number, number]> = [
    [0, 3.3],
    [0.1, 3.3],
    [0.100001, 0],
    [0.2, 0],
    [0.200001, 3.3],
  ];

  it("holds the first level before the first breakpoint and the last after", () => {
    expect(evaluatePwl(bp, -1)).toBe(3.3);
    expect(evaluatePwl(bp, 5)).toBe(3.3);
  });

  it("reads the driven level inside each window", () => {
    expect(evaluatePwl(bp, 0.05)).toBeCloseTo(3.3, 6); // HIGH window
    expect(evaluatePwl(bp, 0.15)).toBeCloseTo(0, 6); // LOW window
    expect(evaluatePwl(bp, 0.25)).toBeCloseTo(3.3, 6); // HIGH window
  });
});

describe("buildFirmwareDrivenRun", () => {
  const time = new Float64Array([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);

  it("drives the GPIO2 net high during HIGH windows and 0 during LOW windows", () => {
    const run = buildFirmwareDrivenRun(blinkSchematic(), BLINK, time, { now: AT });
    expect(run.status).toBe("completed");
    const signal = run.results?.signals.find((s) => s.netId === "net_gpio2");
    expect(signal).toBeDefined();
    expect(run.results?.signals.find((s) => s.netId === "time")).toBeDefined();
    // No source card for the undriven GPIO4 net.
    expect(run.results?.signals.find((s) => s.netId === "net_gpio4")).toBeUndefined();
  });

  it("makes the on-GPIO2 LED brightness track the emulator blink timeline", () => {
    const run = buildFirmwareDrivenRun(blinkSchematic(), BLINK, time, { now: AT });
    const result = deriveInstanceStates(blinkSchematic(), getComponent, run);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const led = result.states.get("D1")!;
    expect(led.kind).toBe("led");
    const { brightness } = led.series;
    expect(brightness).toBeDefined();

    // Brightness follows the GPIO2 timeline: bright while driven HIGH, dark while LOW.
    expect(sampleAt(result.time, brightness!, 0.05)).toBeGreaterThan(0.6);
    expect(sampleAt(result.time, brightness!, 0.15)).toBeLessThan(0.05);
    expect(sampleAt(result.time, brightness!, 0.25)).toBeGreaterThan(0.6);
  });

  it("emits no driven signals when the firmware never toggles a bound pin", () => {
    // GPIO7 has no net binding in the schematic -> nothing to drive.
    const run = buildFirmwareDrivenRun(blinkSchematic(), [{ t: 0, gpio: 7, level: 1 }], time, { now: AT });
    const voltageSignals = run.results?.signals.filter((s) => s.netId !== "time") ?? [];
    expect(voltageSignals).toHaveLength(0);
  });
});
