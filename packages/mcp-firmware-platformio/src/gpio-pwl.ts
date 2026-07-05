/**
 * GPIO -> net -> PWL translator — firmware-in-the-loop step 2 (issue #65).
 *
 * Step 1 (#64, {@link ./gpio-poller}) turns the emulated MCU's GPIO registers
 * into a `(t, gpio, level)` event stream so pin state leaves the emulator. This
 * step closes the output direction: it binds those events to schematic nets and
 * renders them as SPICE stimulus so ngspice actually sees firmware-driven pins.
 *
 * Each driven pin becomes a Thevenin push-pull driver — a PWL voltage source
 * behind a series output resistance, mirroring the SIN/DC source-card path in
 * `packages/netlist-compiler`:
 *
 *   Vgpio2 n_gpio2 0   PWL(t0 v0 t1 v1 ...)   ; ideal level, times in SECONDS
 *   Rgpio2 n_gpio2 <net> 30                    ; ~30 ohm output impedance
 *
 * Drive model: HIGH -> {@link VOH_VOLTS} (3.3V), LOW -> {@link VOL_VOLTS} (0V),
 * each transition holding the old level then ramping to the new one over
 * {@link EDGE_RAMP_SECONDS} (~1us) so ngspice never sees an infinite dv/dt.
 *
 * Hi-Z -> no drive: a plain V+R Thevenin source cannot open-circuit, so Hi-Z
 * ("Z") samples contribute no breakpoint. A pin that is only ever Hi-Z (or
 * never appears in the stream) emits no card at all — the net floats, exactly
 * as an output-disabled pin should. Interior Hi-Z windows are approximated as a
 * hold of the surrounding driven levels (documented limitation; true tri-state
 * would need a switched source, out of scope for step 2).
 */
import type { GpioEvent } from "./gpio-poller";

/** HIGH output level for an ESP32 push-pull pin (VDD, volts). */
export const VOH_VOLTS = 3.3;
/** LOW output level (volts). */
export const VOL_VOLTS = 0;
/** Series output resistance of the Thevenin driver (ohms). */
export const ROUT_OHMS = 30;
/** Rise/fall edge ramp so PWL edges have finite slope (seconds, ~1us). */
export const EDGE_RAMP_SECONDS = 1e-6;

/**
 * A pin drive sample: at time `t` (ms) pin `gpio` drives HIGH (1), LOW (0), or
 * is high-impedance ("Z"). A {@link GpioEvent} (level `0 | 1`) is structurally
 * assignable, so the #64 poller's output feeds this translator unchanged; add
 * explicit `"Z"` samples to mark output-disable windows.
 */
export interface PinDriveEvent {
  /** Timestamp of the sample (ms). */
  t: number;
  /** GPIO pin number (0-39). */
  gpio: number;
  /** Driven level, or "Z" for high-impedance (undriven). */
  level: GpioEvent["level"] | "Z";
}

/** Maps a driven GPIO pin number to the SPICE node its net compiles to. */
export type Esp32PinNetMap = ReadonlyMap<number, string>;

/** One SPICE PWL stimulus source derived from a pin's driven timeline. */
export interface PwlSource {
  /** GPIO pin this source drives. */
  gpio: number;
  /** SPICE node (from the pin->net map) the driver's Rout connects to. */
  net: string;
  /** Internal node between the PWL source and the series Rout. */
  node: string;
  /** `(time_seconds, volts)` PWL breakpoints, in ascending time order. */
  breakpoints: Array<[number, number]>;
  /** The SPICE cards: `[V PWL source, series Rout]`. */
  cards: [string, string];
}

/** Result of {@link gpioEventsToPwl}: sources plus non-fatal warnings. */
export interface GpioPwlResult {
  sources: PwlSource[];
  warnings: string[];
}

/** Overridable drive parameters (default to the ESP32 push-pull values). */
export interface GpioPwlOptions {
  /** HIGH level (volts); defaults to {@link VOH_VOLTS}. */
  voh?: number;
  /** LOW level (volts); defaults to {@link VOL_VOLTS}. */
  vol?: number;
  /** Series output resistance (ohms); defaults to {@link ROUT_OHMS}. */
  rout?: number;
  /** Edge ramp (seconds); defaults to {@link EDGE_RAMP_SECONDS}. */
  edgeRampSeconds?: number;
}

/** Format a number for a SPICE card, stripping binary-float rounding noise. */
function spiceNumber(value: number): string {
  // 12 significant digits is plenty for ms/us times and clears artifacts like
  // 0.001 + 1e-6 === 0.0010010000000000001.
  return String(Number.parseFloat(value.toPrecision(12)));
}

/**
 * Translate a GPIO event timeline into SPICE PWL 'V' source cards, one per
 * driven, net-bound pin.
 *
 * - Events are grouped by pin and sorted by time (stable within equal times).
 * - `"Z"` (Hi-Z) samples are dropped; a pin with no remaining driven samples
 *   emits nothing (the net floats — Hi-Z means no drive).
 * - A pin driven but absent from `pinNetMap` is skipped with a warning (nothing
 *   to bind its output to).
 * - Sources are returned ordered by GPIO number for determinism.
 */
export function gpioEventsToPwl(
  pinNetMap: Esp32PinNetMap,
  events: readonly PinDriveEvent[],
  opts: GpioPwlOptions = {},
): GpioPwlResult {
  const voh = opts.voh ?? VOH_VOLTS;
  const vol = opts.vol ?? VOL_VOLTS;
  const rout = opts.rout ?? ROUT_OHMS;
  const ramp = opts.edgeRampSeconds ?? EDGE_RAMP_SECONDS;

  // Group events per pin, preserving stream order (stable sort by time below).
  const byPin = new Map<number, PinDriveEvent[]>();
  for (const event of events) {
    const bucket = byPin.get(event.gpio);
    if (bucket === undefined) {
      byPin.set(event.gpio, [event]);
    } else {
      bucket.push(event);
    }
  }

  const sources: PwlSource[] = [];
  const warnings: string[] = [];

  for (const gpio of [...byPin.keys()].sort((a, b) => a - b)) {
    const driven = byPin
      .get(gpio)!
      .filter((event): event is PinDriveEvent & { level: 0 | 1 } => event.level !== "Z")
      .slice()
      .sort((a, b) => a.t - b.t);
    if (driven.length === 0) {
      continue; // pure Hi-Z (or all filtered) — no drive, net floats.
    }

    const net = pinNetMap.get(gpio);
    if (net === undefined) {
      warnings.push(`gpio ${gpio} has drive events but no net binding; skipped`);
      continue;
    }

    // Build PWL breakpoints: the first sample sets the initial level; every
    // later sample holds the previous level then ramps to the new one over the
    // edge time, giving ngspice a finite-slope transition.
    const breakpoints: Array<[number, number]> = [];
    let prevVolts = 0;
    driven.forEach((event, i) => {
      const volts = event.level === 1 ? voh : vol;
      const seconds = event.t / 1000; // event times are ms; SPICE PWL is seconds.
      if (i === 0) {
        breakpoints.push([seconds, volts]);
      } else {
        breakpoints.push([seconds, prevVolts]);
        breakpoints.push([Number.parseFloat((seconds + ramp).toPrecision(12)), volts]);
      }
      prevVolts = volts;
    });

    const node = `n_gpio${gpio}`;
    const pwl = breakpoints.map(([t, v]) => `${spiceNumber(t)} ${spiceNumber(v)}`).join(" ");
    const cards: [string, string] = [
      `Vgpio${gpio} ${node} 0 PWL(${pwl})`,
      `Rgpio${gpio} ${node} ${net} ${spiceNumber(rout)}`,
    ];
    sources.push({ gpio, net, node, breakpoints, cards });
  }

  return { sources, warnings };
}
