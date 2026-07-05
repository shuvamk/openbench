import { describe, expect, it } from "vitest";
import {
  GPIO_ENABLE1_REG,
  GPIO_ENABLE_REG,
  GPIO_OUT1_REG,
  GPIO_OUT_REG,
  GpioPoller,
  pollGpio,
  type GpioEvent,
  type MemoryReader,
} from "../src/index";

/**
 * Acceptance tests for issue #64 — GPIO register poller (firmware-in-the-loop
 * step 1). A poller samples the ESP32 GPIO_OUT / GPIO_ENABLE registers off a
 * MemoryReader and emits edge-triggered (t, gpio, level) events for driven
 * pins only.
 *
 * ESP32 register map (TRM): GPIO_OUT_REG 0x3FF44004 / GPIO_OUT1_REG 0x3FF44010
 * (pins 32-39), GPIO_ENABLE_REG 0x3FF44020 / GPIO_ENABLE1_REG 0x3FF4402C.
 */

/**
 * A fake "firmware" backing a MemoryReader: only the enabled pins are driven,
 * and each `out` value is the GPIO_OUT_REG word for that sample tick.
 */
function fakeReader(samples: { out: number; out1?: number; enable: number; enable1?: number }[]): {
  reader: MemoryReader;
  advance: () => void;
} {
  let i = 0;
  const reader: MemoryReader = {
    async readWord(address: number): Promise<number> {
      const s = samples[Math.min(i, samples.length - 1)];
      switch (address) {
        case GPIO_OUT_REG:
          return s.out;
        case GPIO_OUT1_REG:
          return s.out1 ?? 0;
        case GPIO_ENABLE_REG:
          return s.enable;
        case GPIO_ENABLE1_REG:
          return s.enable1 ?? 0;
        default:
          throw new Error(`unexpected address 0x${address.toString(16)}`);
      }
    },
  };
  return { reader, advance: () => { i += 1; } };
}

describe("register map", () => {
  it("exposes the canonical ESP32 GPIO register addresses", () => {
    expect(GPIO_OUT_REG).toBe(0x3ff44004);
    expect(GPIO_OUT1_REG).toBe(0x3ff44010);
    expect(GPIO_ENABLE_REG).toBe(0x3ff44020);
    expect(GPIO_ENABLE1_REG).toBe(0x3ff4402c);
  });
});

describe("GpioPoller.sample", () => {
  it("emits the initial level of each driven pin on the first sample", async () => {
    // GPIO2 enabled and HIGH.
    const { reader } = fakeReader([{ out: 1 << 2, enable: 1 << 2 }]);
    const poller = new GpioPoller(reader);

    const events = await poller.sample(0);
    expect(events).toEqual([{ t: 0, gpio: 2, level: 1 }]);
  });

  it("is edge-triggered: no event when a driven pin's level is unchanged", async () => {
    const { reader } = fakeReader([{ out: 1 << 2, enable: 1 << 2 }]);
    const poller = new GpioPoller(reader);

    await poller.sample(0); // initial HIGH
    const again = await poller.sample(100); // still HIGH
    expect(again).toEqual([]);
  });

  it("emits nothing for undriven (output-disabled) pins", async () => {
    // GPIO4 is HIGH in GPIO_OUT but its ENABLE bit is clear → not driven.
    const { reader } = fakeReader([{ out: 1 << 4, enable: 0 }]);
    const poller = new GpioPoller(reader);

    expect(await poller.sample(0)).toEqual([]);
  });

  it("decodes pins 32-39 from GPIO_OUT1/GPIO_ENABLE1", async () => {
    // GPIO34 (bit 2 of the *1 registers) driven HIGH.
    const { reader } = fakeReader([{ out: 0, out1: 1 << 2, enable: 0, enable1: 1 << 2 }]);
    const poller = new GpioPoller(reader);

    expect(await poller.sample(0)).toEqual([{ t: 0, gpio: 34, level: 1 }]);
  });
});

describe("acceptance: fixture firmware toggling GPIO2 at 1 Hz", () => {
  it("yields alternating HIGH/LOW events for GPIO2 and nothing for undriven pins", async () => {
    // GPIO2 enabled; GPIO4 is high in OUT but never enabled (undriven noise).
    // Each sample flips GPIO2 (the 1 Hz toggle, sampled once per half-period).
    const en = 1 << 2;
    const noise = 1 << 4; // undriven
    const { reader, advance } = fakeReader([
      { out: (1 << 2) | noise, enable: en }, // HIGH
      { out: 0 | noise, enable: en }, // LOW
      { out: (1 << 2) | noise, enable: en }, // HIGH
      { out: 0 | noise, enable: en }, // LOW
    ]);
    const poller = new GpioPoller(reader);

    const collected: GpioEvent[] = [];
    for (let t = 0; t < 4; t++) {
      collected.push(...(await poller.sample(t * 500)));
      advance();
    }

    expect(collected).toEqual([
      { t: 0, gpio: 2, level: 1 },
      { t: 500, gpio: 2, level: 0 },
      { t: 1000, gpio: 2, level: 1 },
      { t: 1500, gpio: 2, level: 0 },
    ]);
    // Only GPIO2 ever appears — the undriven GPIO4 emits nothing.
    expect(collected.every((e) => e.gpio === 2)).toBe(true);
  });
});

describe("pollGpio run loop", () => {
  it("drives the poller on an injected clock/sleep and stops on the signal", async () => {
    const en = 1 << 2;
    const outs = [1 << 2, 0, 1 << 2];
    let idx = 0;
    const reader: MemoryReader = {
      async readWord(address: number): Promise<number> {
        if (address === GPIO_ENABLE_REG) return en;
        if (address === GPIO_OUT_REG) return outs[Math.min(idx, outs.length - 1)];
        return 0;
      },
    };

    let now = 0;
    const clock = () => now;
    const sleep = async (ms: number) => {
      now += ms;
      idx += 1;
    };

    const events: GpioEvent[] = [];
    let ticks = 0;
    const stop = () => ticks++ >= 3;

    await pollGpio(reader, {
      pollHz: 20,
      clock,
      sleep,
      stop,
      onEvent: (e) => events.push(e),
    });

    // 50 ms period at 20 Hz, GPIO2 HIGH -> LOW -> HIGH across the ticks.
    expect(events).toEqual([
      { t: 0, gpio: 2, level: 1 },
      { t: 50, gpio: 2, level: 0 },
      { t: 100, gpio: 2, level: 1 },
    ]);
  });
});
