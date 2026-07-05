import { describe, expect, it } from "vitest";
import {
  EDGE_RAMP_SECONDS,
  ROUT_OHMS,
  VOH_VOLTS,
  VOL_VOLTS,
  gpioEventsToPwl,
  type GpioEvent,
  type PinDriveEvent,
} from "../src/index";

/**
 * Acceptance tests for issue #65 — GPIO->net->PWL translator (firmware-in-the-loop
 * step 2). A pure function turns the emulator's GPIO event timeline (from the #64
 * poller) plus a pin->net binding into SPICE PWL 'V' source cards so ngspice sees
 * firmware-driven pins:
 *   HIGH -> VOH (3.3V), LOW -> 0V, Hi-Z -> no drive, series Rout ~30ohm,
 *   ~1us edge ramp.
 */

/** GPIO2 (net "3") toggling HIGH -> LOW -> HIGH at 1ms intervals. */
const HLH: PinDriveEvent[] = [
  { t: 0, gpio: 2, level: 1 },
  { t: 1, gpio: 2, level: 0 },
  { t: 2, gpio: 2, level: 1 },
];

describe("gpioEventsToPwl — constants", () => {
  it("uses ESP32 push-pull drive levels, series Rout, and a 1us edge ramp", () => {
    expect(VOH_VOLTS).toBe(3.3);
    expect(VOL_VOLTS).toBe(0);
    expect(ROUT_OHMS).toBe(30);
    expect(EDGE_RAMP_SECONDS).toBe(1e-6);
  });
});

describe("gpioEventsToPwl — HIGH/LOW/HIGH timeline", () => {
  const map = new Map<number, string>([[2, "3"]]);
  const result = gpioEventsToPwl(map, HLH);

  it("emits exactly one source bound to GPIO2's net", () => {
    expect(result.warnings).toEqual([]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.gpio).toBe(2);
    expect(result.sources[0]?.net).toBe("3");
  });

  it("builds PWL breakpoints with held levels and 1us ramps (times in seconds)", () => {
    // t is milliseconds; SPICE PWL time is seconds. Each transition holds the
    // previous level, then ramps to the new level over EDGE_RAMP_SECONDS.
    expect(result.sources[0]?.breakpoints).toEqual([
      [0, 3.3],
      [0.001, 3.3],
      [0.001001, 0],
      [0.002, 0],
      [0.002001, 3.3],
    ]);
  });

  it("renders a PWL V card driving an internal node and a series Rout to the net", () => {
    expect(result.sources[0]?.cards).toEqual([
      "Vgpio2 n_gpio2 0 PWL(0 3.3 0.001 3.3 0.001001 0 0.002 0 0.002001 3.3)",
      "Rgpio2 n_gpio2 3 30",
    ]);
  });
});

describe("gpioEventsToPwl — a single constant level", () => {
  it("emits a flat PWL (one breakpoint) plus the series Rout", () => {
    const result = gpioEventsToPwl(new Map([[4, "7"]]), [{ t: 0, gpio: 4, level: 1 }]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.breakpoints).toEqual([[0, 3.3]]);
    expect(result.sources[0]?.cards).toEqual([
      "Vgpio4 n_gpio4 0 PWL(0 3.3)",
      "Rgpio4 n_gpio4 7 30",
    ]);
  });
});

describe("gpioEventsToPwl — Hi-Z emits no drive", () => {
  it("emits no source for a pin whose only events are Hi-Z", () => {
    const result = gpioEventsToPwl(new Map([[2, "3"]]), [
      { t: 0, gpio: 2, level: "Z" },
      { t: 1, gpio: 2, level: "Z" },
    ]);
    expect(result.sources).toEqual([]);
  });

  it("emits no source for a bound pin that never appears in the event stream", () => {
    const result = gpioEventsToPwl(new Map([[2, "3"]]), []);
    expect(result.sources).toEqual([]);
  });

  it("drops leading/trailing Hi-Z but still drives the enabled window", () => {
    const result = gpioEventsToPwl(new Map([[2, "3"]]), [
      { t: 0, gpio: 2, level: "Z" },
      { t: 1, gpio: 2, level: 1 },
      { t: 2, gpio: 2, level: 0 },
      { t: 3, gpio: 2, level: "Z" },
    ]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.breakpoints).toEqual([
      [0.001, 3.3],
      [0.002, 3.3],
      [0.002001, 0],
    ]);
  });
});

describe("gpioEventsToPwl — unbound pins", () => {
  it("skips a driven pin with no net binding and warns", () => {
    const result = gpioEventsToPwl(new Map(), [{ t: 0, gpio: 5, level: 1 }]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/gpio 5/i);
  });
});

describe("gpioEventsToPwl — multiple pins", () => {
  it("emits one source per driven, bound pin, ordered by gpio", () => {
    const map = new Map<number, string>([
      [4, "7"],
      [2, "3"],
    ]);
    const events: PinDriveEvent[] = [
      { t: 0, gpio: 4, level: 1 },
      { t: 0, gpio: 2, level: 0 },
    ];
    const result = gpioEventsToPwl(map, events);
    expect(result.sources.map((s) => s.gpio)).toEqual([2, 4]);
  });
});

describe("gpioEventsToPwl — overridable drive parameters", () => {
  it("honors a custom VOH and Rout", () => {
    const result = gpioEventsToPwl(new Map([[2, "3"]]), [{ t: 0, gpio: 2, level: 1 }], {
      voh: 5,
      rout: 47,
    });
    expect(result.sources[0]?.cards).toEqual([
      "Vgpio2 n_gpio2 0 PWL(0 5)",
      "Rgpio2 n_gpio2 3 47",
    ]);
  });
});

describe("gpioEventsToPwl — poller output is directly consumable", () => {
  it("accepts GpioEvent[] (level 0|1) without widening", () => {
    const pollerEvents: GpioEvent[] = [{ t: 0, gpio: 2, level: 1 }];
    const result = gpioEventsToPwl(new Map([[2, "3"]]), pollerEvents);
    expect(result.sources).toHaveLength(1);
  });
});
