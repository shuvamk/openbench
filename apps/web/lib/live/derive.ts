import type { Component, Schematic, SimulationRun } from "@openbench/ir-schema";
import { decodeSamples } from "@openbench/mcp-sim-ngspice";
import { evaluateExpression } from "@openbench/netlist-compiler";

/**
 * Live-view physics (issue #24): turn a transient run's net-voltage waveforms
 * into per-instance electrical state a human can SEE — LED brightness, motor
 * speed, lamp glow, switch state. Pure functions, no React.
 *
 * Deliberate simplifications (visual fidelity, not SPICE fidelity):
 * - Diode current uses the same Shockley parameters as the registry models
 *   (Is=1e-14, n=2), clamped to 50mA; brightness scales against a 15mA
 *   nominal indicator current.
 * - Motor speed is |ΔV|/vnominal — no inertia or back-EMF.
 * - Lamp/buzzer intensity scales against a 0.25W nominal.
 */

export type LiveKind =
  | "led"
  | "rgb"
  | "motor"
  | "buzzer"
  | "lamp"
  | "resistor"
  | "capacitor"
  | "source"
  | "switch"
  | "unknown";

export interface InstanceTimeline {
  kind: LiveKind;
  /** Named series, each `time.length` long (e.g. brightness, current, rpmFraction). */
  series: Record<string, Float64Array>;
}

export type DeriveResult =
  | { ok: true; time: Float64Array; states: Map<string, InstanceTimeline> }
  | { ok: false; errors: Array<{ path: string; message: string }> };

const SHOCKLEY_IS = 1e-14;
const SHOCKLEY_N = 2;
const THERMAL_VOLTAGE = 0.02585;
const DIODE_CURRENT_CLAMP = 0.05;
/** Indicator-LED current that reads as "fully bright". */
export const LED_NOMINAL_CURRENT = 0.015;
/** Lamp/buzzer power that reads as "fully on". */
export const NOMINAL_POWER = 0.25;
const ON_THRESHOLD = 0.05;

const GROUND_NAMES = new Set(["GND", "AGND", "0"]);

function diodeCurrent(forwardVoltage: number): number {
  if (forwardVoltage <= 0) return 0;
  const clamped = Math.min(forwardVoltage, 1.6);
  const current = SHOCKLEY_IS * (Math.exp(clamped / (SHOCKLEY_N * THERMAL_VOLTAGE)) - 1);
  return Math.min(current, DIODE_CURRENT_CLAMP);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Resolve a parameter set: overrides over defaults, then derivedParams. */
function resolveParams(
  component: Component,
  overrides: Record<string, number | string | boolean> | undefined,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const parameter of component.parameters) {
    const raw = overrides?.[parameter.name] ?? parameter.default;
    if (typeof raw === "number") values.set(parameter.name, raw);
  }
  for (const [name, expression] of Object.entries(component.simModel?.derivedParams ?? {})) {
    const evaluated = evaluateExpression(expression, values);
    if (evaluated.ok) values.set(name, evaluated.value);
  }
  return values;
}

function liveKind(component: Component): LiveKind {
  switch (component.id) {
    case "cmp_led_generic":
    case "cmp_diode_generic":
      return "led";
    case "cmp_rgb_led":
      return "rgb";
    case "cmp_dc_motor":
      return "motor";
    case "cmp_buzzer":
      return "buzzer";
    case "cmp_lamp":
      return "lamp";
    case "cmp_pushbutton":
    case "cmp_switch_spst":
      return "switch";
    case "cmp_vsource_dc":
    case "cmp_vsource_pulse":
    case "cmp_vsource_sin":
      return "source";
    default:
      break;
  }
  const template = component.simModel?.template;
  if (template?.startsWith("R{ref}")) return "resistor";
  if (template?.startsWith("C{ref}")) return "capacitor";
  return "unknown";
}

/**
 * Live-visual kinds — the parts that visibly "do something" a beginner can
 * watch in Live mode (glow, spin, sound). Switches/sources/resistors get
 * overlays but no watch-it-happen payoff, so they don't count.
 */
export const LIVE_VISUAL_KINDS: ReadonlySet<LiveKind> = new Set<LiveKind>([
  "led",
  "rgb",
  "motor",
  "buzzer",
  "lamp",
]);

/**
 * Issue #73: does this schematic contain anything Live mode can visualize?
 * Reuses the same {@link liveKind} classification the overlays derive from, so
 * new live-visual parts light up the Design→Live nudge automatically. Pure.
 */
export function hasLiveVisual(
  schematic: Schematic,
  resolveComponent: (componentId: string) => Component | undefined,
): boolean {
  return schematic.instances.some((instance) => {
    const component = resolveComponent(instance.componentId);
    return component !== undefined && LIVE_VISUAL_KINDS.has(liveKind(component));
  });
}

export function deriveInstanceStates(
  schematic: Schematic,
  resolveComponent: (componentId: string) => Component | undefined,
  run: SimulationRun,
): DeriveResult {
  const signals = run.results?.signals ?? [];
  const timeSignal = signals.find((signal) => signal.netId === "time");
  if (!timeSignal) {
    return { ok: false, errors: [{ path: "results.signals", message: "run has no time signal" }] };
  }
  let time: Float64Array;
  try {
    time = decodeSamples(timeSignal.samples);
  } catch (cause) {
    return {
      ok: false,
      errors: [{ path: "results.signals.time", message: cause instanceof Error ? cause.message : String(cause) }],
    };
  }

  // Ground nets read as a constant 0V; probed nets decode their waveform.
  const groundInstances = new Set(
    schematic.instances.filter((i) => i.componentId === "cmp_ground").map((i) => i.instanceId),
  );
  const netVoltages = new Map<string, Float64Array>();
  const zeros = new Float64Array(time.length);
  for (const net of schematic.nets) {
    const isGround =
      (net.name !== undefined && GROUND_NAMES.has(net.name.toUpperCase())) ||
      net.connections.some((connection) => groundInstances.has(connection.instanceId));
    if (isGround) {
      netVoltages.set(net.netId, zeros);
      continue;
    }
    const signal = signals.find((s) => s.netId === net.netId);
    if (!signal) continue; // unprobed → instances touching it degrade to "unknown"
    try {
      netVoltages.set(net.netId, decodeSamples(signal.samples));
    } catch {
      // undecodable (e.g. remote URL) → treat as unprobed
    }
  }

  const pinNet = new Map<string, string>();
  for (const net of schematic.nets) {
    for (const connection of net.connections) {
      pinNet.set(`${connection.instanceId} ${connection.pinId}`, net.netId);
    }
  }
  const pinVoltage = (instanceId: string, pinId: string): Float64Array | undefined => {
    const netId = pinNet.get(`${instanceId} ${pinId}`);
    return netId === undefined ? undefined : netVoltages.get(netId);
  };

  const states = new Map<string, InstanceTimeline>();

  for (const instance of schematic.instances) {
    const component = resolveComponent(instance.componentId);
    if (!component) {
      states.set(instance.instanceId, { kind: "unknown", series: {} });
      continue;
    }
    const kind = liveKind(component);
    const params = resolveParams(
      component,
      instance.parameterOverrides as Record<string, number | string | boolean> | undefined,
    );

    const twoPin = (aId: string, bId: string): Float64Array | undefined => {
      const a = pinVoltage(instance.instanceId, aId);
      const b = pinVoltage(instance.instanceId, bId);
      if (!a || !b) return undefined;
      const dv = new Float64Array(time.length);
      for (let i = 0; i < time.length; i++) dv[i] = a[i]! - b[i]!;
      return dv;
    };

    const series: Record<string, Float64Array> = {};
    let resolvedKind: LiveKind = kind;

    switch (kind) {
      case "led": {
        const pinIds = component.pins.map((p) => p.id);
        const dv = twoPin(pinIds[0]!, pinIds[1]!);
        if (!dv) {
          resolvedKind = "unknown";
          break;
        }
        const current = new Float64Array(time.length);
        const brightness = new Float64Array(time.length);
        for (let i = 0; i < time.length; i++) {
          current[i] = diodeCurrent(dv[i]!);
          brightness[i] = clamp01(current[i]! / LED_NOMINAL_CURRENT);
        }
        series.voltage = dv;
        series.current = current;
        series.brightness = brightness;
        break;
      }
      case "rgb": {
        let missing = false;
        for (const channel of ["r", "g", "b"] as const) {
          const dv = twoPin(channel, "com");
          if (!dv) {
            missing = true;
            break;
          }
          const brightness = new Float64Array(time.length);
          for (let i = 0; i < time.length; i++) brightness[i] = clamp01(diodeCurrent(dv[i]!) / LED_NOMINAL_CURRENT);
          series[`brightness_${channel}`] = brightness;
        }
        if (missing) resolvedKind = "unknown";
        break;
      }
      case "motor": {
        const dv = twoPin("p1", "p2");
        const vnominal = params.get("vnominal") ?? 6;
        if (!dv || vnominal <= 0) {
          resolvedKind = "unknown";
          break;
        }
        const rpm = new Float64Array(time.length);
        for (let i = 0; i < time.length; i++) rpm[i] = clamp01(Math.abs(dv[i]!) / vnominal);
        series.voltage = dv;
        series.rpmFraction = rpm;
        break;
      }
      case "buzzer":
      case "lamp": {
        const dv = twoPin("p1", "p2");
        const resistance = params.get("r") ?? 60;
        if (!dv || resistance <= 0) {
          resolvedKind = "unknown";
          break;
        }
        const intensity = new Float64Array(time.length);
        const on = new Float64Array(time.length);
        for (let i = 0; i < time.length; i++) {
          const power = (dv[i]! * dv[i]!) / resistance;
          intensity[i] = clamp01(power / NOMINAL_POWER);
          on[i] = intensity[i]! > ON_THRESHOLD ? 1 : 0;
        }
        series.voltage = dv;
        series.intensity = intensity;
        series.on = on;
        break;
      }
      case "switch": {
        const ronoff = params.get("ronoff");
        const closed = new Float64Array(time.length).fill(ronoff !== undefined && ronoff < 1 ? 1 : 0);
        series.closed = closed;
        break;
      }
      case "source": {
        const pinIds = component.pins.map((p) => p.id);
        const dv = twoPin(pinIds[0]!, pinIds[1]!);
        if (dv) series.voltage = dv;
        break;
      }
      case "resistor": {
        const pinIds = component.pins.map((p) => p.id);
        const dv = twoPin(pinIds[0]!, pinIds[1]!);
        if (!dv) {
          resolvedKind = "unknown";
          break;
        }
        // Effective resistance: single-R templates expose exactly one usable value.
        const resistance =
          params.get("resistance") ?? params.get("r") ?? params.get("rwinding") ?? params.get("ronoff");
        series.voltage = dv;
        if (resistance !== undefined && resistance > 0) {
          const current = new Float64Array(time.length);
          const power = new Float64Array(time.length);
          for (let i = 0; i < time.length; i++) {
            current[i] = dv[i]! / resistance;
            power[i] = (dv[i]! * dv[i]!) / resistance;
          }
          series.current = current;
          series.power = power;
        }
        break;
      }
      case "capacitor": {
        const pinIds = component.pins.map((p) => p.id);
        const dv = twoPin(pinIds[0]!, pinIds[1]!);
        if (!dv) {
          resolvedKind = "unknown";
          break;
        }
        // Voltage across the cap is what its interactiveHint watches (issue #174).
        series.voltage = dv;
        // Displacement current i = C·dv/dt (backward difference; first sample
        // forward-filled). Visual fidelity, not SPICE fidelity — like the others.
        const capacitance = params.get("capacitance");
        if (capacitance !== undefined && capacitance > 0) {
          const current = new Float64Array(time.length);
          for (let i = 1; i < time.length; i++) {
            const dt = time[i]! - time[i - 1]!;
            current[i] = dt > 0 ? (capacitance * (dv[i]! - dv[i - 1]!)) / dt : 0;
          }
          if (time.length > 1) current[0] = current[1]!;
          series.current = current;
        }
        break;
      }
      default:
        resolvedKind = "unknown";
        break;
    }

    states.set(instance.instanceId, { kind: resolvedKind, series });
  }

  return { ok: true, time, states };
}

/** Sample a timeline series at a moment (nearest index; clamped to the window). */
export function sampleAt(time: Float64Array, series: Float64Array, t: number): number {
  if (time.length === 0 || series.length === 0) return 0;
  const end = time[time.length - 1]!;
  const clamped = Math.min(Math.max(t, time[0]!), end);
  // time is monotonic — binary search for the nearest sample
  let lo = 0;
  let hi = time.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid]! <= clamped) lo = mid;
    else hi = mid;
  }
  const nearest = Math.abs(time[lo]! - clamped) <= Math.abs(time[hi]! - clamped) ? lo : hi;
  return series[Math.min(nearest, series.length - 1)] ?? 0;
}
