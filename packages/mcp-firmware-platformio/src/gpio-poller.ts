/**
 * ESP32 GPIO register poller — firmware-in-the-loop step 1 (issue #64).
 *
 * Samples the emulated MCU's GPIO output registers over a {@link MemoryReader}
 * (in production, the {@link RspMemoryReader} talking to QEMU's GDB stub) and
 * turns them into an edge-triggered `(t, gpio, level)` event stream. This is
 * the first half of closing the firmware -> virtual-MCU -> circuit loop: with a
 * poller, GPIO state finally leaves the emulator so the schematic side can
 * react to it.
 *
 * Only *driven* pins (output-enabled in GPIO_ENABLE) produce events; a pin that
 * is high in GPIO_OUT but not enabled is undriven noise and is ignored. Events
 * are edge-triggered — one event per level transition — so a slow toggle
 * sampled fast yields clean alternating HIGH/LOW rather than a duplicate storm.
 */
import type { MemoryReader } from "./gdb-rsp";

export type { MemoryReader } from "./gdb-rsp";

/**
 * ESP32 GPIO register map (Technical Reference Manual §4.11). The `*1` variants
 * cover the high pins (GPIO32-39) in bits 0-7.
 */
export const GPIO_OUT_REG = 0x3ff44004; // pins 0-31 output level
export const GPIO_OUT1_REG = 0x3ff44010; // pins 32-39 output level (bits 0-7)
export const GPIO_ENABLE_REG = 0x3ff44020; // pins 0-31 output enable
export const GPIO_ENABLE1_REG = 0x3ff4402c; // pins 32-39 output enable (bits 0-7)

/** Highest GPIO number on the ESP32. */
const MAX_GPIO = 39;

/** A single observed level transition on a driven GPIO pin. */
export interface GpioEvent {
  /** Timestamp of the sample that observed the transition (ms). */
  t: number;
  /** GPIO pin number (0-39). */
  gpio: number;
  /** Output level: 1 = HIGH, 0 = LOW. */
  level: 0 | 1;
}

/**
 * Samples ESP32 GPIO registers and emits edge-triggered level events. Stateful:
 * it remembers the last emitted level per driven pin so repeat samples at the
 * same level are suppressed.
 */
export class GpioPoller {
  private readonly last = new Map<number, 0 | 1>();

  constructor(private readonly reader: MemoryReader) {}

  /**
   * Sample all GPIO registers once at time `t` and return the level-change
   * events for driven pins. The first sample of a driven pin always emits its
   * current level; subsequent samples emit only on a transition. A pin that
   * becomes output-disabled is forgotten, so re-enabling it re-emits.
   */
  async sample(t: number): Promise<GpioEvent[]> {
    const [out, out1, enable, enable1] = await Promise.all([
      this.reader.readWord(GPIO_OUT_REG),
      this.reader.readWord(GPIO_OUT1_REG),
      this.reader.readWord(GPIO_ENABLE_REG),
      this.reader.readWord(GPIO_ENABLE1_REG),
    ]);

    const events: GpioEvent[] = [];
    for (let gpio = 0; gpio <= MAX_GPIO; gpio++) {
      const low = gpio < 32;
      const bit = low ? gpio : gpio - 32;
      const enabled = (((low ? enable : enable1) >>> bit) & 1) === 1;
      if (!enabled) {
        this.last.delete(gpio);
        continue;
      }
      const level = (((low ? out : out1) >>> bit) & 1) as 0 | 1;
      if (this.last.get(gpio) !== level) {
        events.push({ t, gpio, level });
        this.last.set(gpio, level);
      }
    }
    return events;
  }
}

/** Options controlling the {@link pollGpio} run loop. */
export interface PollGpioOptions {
  /** Sampling rate in Hz (10-30 Hz is the intended range). */
  pollHz: number;
  /** Returns the current time in ms (injectable for deterministic tests). */
  clock: () => number;
  /** Sleeps for `ms` (injectable so tests can drive time without real waits). */
  sleep: (ms: number) => Promise<void>;
  /** Called before each sample; returning true ends the loop. */
  stop: () => boolean;
  /** Invoked once per emitted GPIO event. */
  onEvent: (event: GpioEvent) => void;
}

/**
 * Run a {@link GpioPoller} at `pollHz` until `stop()` returns true, forwarding
 * every event to `onEvent`. Time and sleeping are injected so the loop is fully
 * deterministic under test; in production, pass `Date.now` and a real timer.
 */
export async function pollGpio(reader: MemoryReader, opts: PollGpioOptions): Promise<void> {
  const period = 1000 / opts.pollHz;
  const poller = new GpioPoller(reader);
  while (!opts.stop()) {
    const t = opts.clock();
    for (const event of await poller.sample(t)) {
      opts.onEvent(event);
    }
    await opts.sleep(period);
  }
}
