import type { Schematic, SimulationRun } from "@openbench/ir-schema";
import { IR_VERSION } from "@openbench/ir-schema";
import { encodeSamples } from "@openbench/mcp-sim-ngspice";
import {
  gpioEventsToPwl,
  type GpioPwlOptions,
  type PinDriveEvent,
} from "@openbench/mcp-firmware-platformio";

/**
 * Firmware-in-the-loop step 3 (issue #66): wire the
 * poll -> PWL -> (net voltages) -> derive loop behind the live view so an
 * emulated blink actually blinks the on-canvas LED. This is the frontend glue
 * that joins the three earlier pieces of ADR-0018:
 *
 *   #64 GpioPoller  ──►  (t, gpio, level) events   (the `events` argument here)
 *   #65 gpioEventsToPwl  ──►  a PWL source per driven, net-bound pin
 *   this module  ──►  evaluate each PWL onto the run's time grid so the
 *                     GPIO-driven net gains a voltage waveform
 *   derive.ts (ADR-0013)  ──►  LED brightness / motor speed / … , unchanged
 *
 * The GPIO->net binding is *derived* from the schematic's ESP32 pin
 * connections (design decision Q2/Direction-A), so no new IR field is needed:
 * a pin labelled `GPIO2` on a `cmp_esp32_devkit` instance names its own GPIO
 * number, and whatever net it connects to is the net that pin drives.
 *
 * Fidelity note (ADR-0013 / firmware-in-the-loop.md): a firmware-driven
 * push-pull net is dominated by its stiff ~30 Ohm source, so for the *live
 * view* we take the driven net's voltage to be the PWL source's own level
 * (VOH when HIGH, 0 when LOW) rather than round-tripping the augmented deck
 * through WASM ngspice. derive.ts already treats live-mode physics as a
 * documented visual-fidelity approximation, and it clamps LED current, so the
 * on/off blink reads identically. The same PWL cards remain the canonical
 * stimulus and can be injected into a real ngspice deck for a
 * verification-grade run when one is wanted.
 */

/** Registry id of the ESP32 DevKitC part whose GPIO pins drive nets. */
export const ESP32_DEVKIT_ID = "cmp_esp32_devkit";

/** Matches an ESP32 GPIO pin id (`GPIO2`, `GPIO4`, …) and captures its number. */
const GPIO_PIN = /^GPIO(\d+)$/;

/**
 * Derive the `GPIO number -> netId` binding from a schematic's ESP32
 * instances. Each `cmp_esp32_devkit` pin labelled `GPIO<n>` contributes its
 * connected net. If several ESP32 instances (or several nets) touch the same
 * pin number, the first one encountered wins — deterministic given the
 * schematic's net/connection order.
 */
export function deriveEsp32PinNetMap(schematic: Schematic): Map<number, string> {
  const esp32Instances = new Set(
    schematic.instances
      .filter((instance) => instance.componentId === ESP32_DEVKIT_ID)
      .map((instance) => instance.instanceId),
  );

  const map = new Map<number, string>();
  if (esp32Instances.size === 0) return map;

  for (const net of schematic.nets) {
    for (const connection of net.connections) {
      if (!esp32Instances.has(connection.instanceId)) continue;
      const match = GPIO_PIN.exec(connection.pinId);
      if (match === null) continue;
      const gpio = Number(match[1]);
      if (!map.has(gpio)) map.set(gpio, net.netId);
    }
  }
  return map;
}

/**
 * Evaluate a PWL breakpoint list `(time_seconds, volts)` at time `t` (seconds)
 * by linear interpolation, holding the first level before the first breakpoint
 * and the last level after the last. Mirrors how SPICE reads a PWL source, so
 * sampling it onto the run grid reproduces the driven net's voltage.
 */
export function evaluatePwl(breakpoints: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (breakpoints.length === 0) return 0;
  const first = breakpoints[0]!;
  if (t <= first[0]) return first[1];
  const last = breakpoints[breakpoints.length - 1]!;
  if (t >= last[0]) return last[1];

  for (let i = 1; i < breakpoints.length; i++) {
    const [t1, v1] = breakpoints[i]!;
    if (t <= t1) {
      const [t0, v0] = breakpoints[i - 1]!;
      const span = t1 - t0;
      if (span <= 0) return v1; // coincident breakpoints — take the newer level.
      return v0 + ((v1 - v0) * (t - t0)) / span;
    }
  }
  return last[1];
}

/** Options for {@link buildFirmwareDrivenRun}. */
export interface BuildFirmwareRunOptions {
  /** ISO-8601 timestamp for the run's provenance; defaults to now. */
  now?: string;
  /** Deterministic run id (test hook); defaults to a firmware-live id. */
  id?: string;
  /** Drive-parameter overrides (VOH/VOL/Rout/ramp) passed to the translator. */
  pwl?: GpioPwlOptions;
}

/**
 * Build a `simulationRun` whose GPIO-driven nets carry the firmware's blink
 * waveform, ready for {@link deriveInstanceStates}. Composes the real #65
 * translator with the schematic-derived pin->net map and samples each PWL
 * source onto `time`. Pins with no net binding, or pins that only ever go
 * Hi-Z, contribute no signal (their nets float) — matching the translator.
 */
export function buildFirmwareDrivenRun(
  schematic: Schematic,
  events: readonly PinDriveEvent[],
  time: Float64Array,
  opts: BuildFirmwareRunOptions = {},
): SimulationRun {
  const pinNetMap = deriveEsp32PinNetMap(schematic);
  const { sources } = gpioEventsToPwl(pinNetMap, events, opts.pwl);

  const voltageSignals = sources.map((source) => {
    const samples = new Float64Array(time.length);
    for (let i = 0; i < time.length; i++) {
      samples[i] = evaluatePwl(source.breakpoints, time[i]!);
    }
    return { netId: source.net, unit: "V", samples: encodeSamples(samples) };
  });

  return {
    irVersion: IR_VERSION,
    kind: "simulationRun",
    id: opts.id ?? "sim_firmware_live",
    netlistId: `net_${schematic.id.replace(/^sch_/, "")}`,
    engine: "qemu",
    mode: "transient",
    status: "completed",
    results: {
      format: "waveform-v1",
      signals: [{ netId: "time", unit: "s", samples: encodeSamples(time) }, ...voltageSignals],
    },
    provenance: { source: "mcp-firmware-platformio", at: opts.now ?? new Date().toISOString() },
  } as SimulationRun;
}
