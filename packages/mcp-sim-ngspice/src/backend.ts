import type { ResultType, Simulation } from "eecircuit-engine";
import { NgspiceAdapterError, parseSpiceTime } from "./deck";

/**
 * A backend run result (issue #36 generalized the transient-only shape).
 *
 * `x` is the independent axis: time (s) for transient, frequency (Hz) for AC,
 * or the swept source value for a DC sweep. For transient/dcSweep `signals`
 * holds real values per probe; for AC `signals` holds magnitude in dB and
 * `phase` (present only for AC) holds phase in degrees, keyed by the same
 * probe names.
 */
export interface BackendResult {
  x: Float64Array;
  signals: Record<string, Float64Array>;
  phase?: Record<string, Float64Array>;
}

/**
 * One interface, two execution backends (ADR-0006): WASM ngspice in-browser
 * (EECircuitBackend) and a deterministic mock for node unit tests. A native
 * ngspice CLI backend can be added behind this same interface later.
 */
export interface SimBackend {
  name: string;
  run(deck: string, probes: string[]): Promise<BackendResult>;
}

const MOCK_SAMPLE_COUNT = 256;

export interface MockBackendOptions {
  /** When set, run() rejects with this message (failure-path testing). */
  fail?: string;
}

/** Default corner when a deck carries no parseable R·C (AC mock fallback). */
const DEFAULT_CORNER_HZ = 1000;

/**
 * Deterministic, node-safe backend. Branches on the deck's analysis card:
 *  - `.tran` → 256 samples of a scaled, phase-shifted sine per probe (issue #9);
 *  - `.ac`   → a single-pole low-pass Bode (magnitude dB + phase deg) whose
 *              corner is the deck's first R·C, over the swept frequency grid (#36);
 *  - `.dc`   → a linear transfer (vout = 0.5·vin for the first probe) over the
 *              swept source values (#36).
 * Synthetic, not a real solve — same spirit as the transient mock: it exists so
 * node tests exercise the adapter's result shaping without loading the WASM engine.
 */
export class MockBackend implements SimBackend {
  readonly name = "mock";
  private readonly options: MockBackendOptions;

  constructor(options: MockBackendOptions = {}) {
    this.options = options;
  }

  async run(deck: string, probes: string[]): Promise<BackendResult> {
    if (this.options.fail !== undefined) {
      throw new NgspiceAdapterError(this.options.fail);
    }

    const ac = /^\.ac\s+(dec|oct|lin)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/im.exec(deck);
    if (ac) return this.runAc(deck, probes, ac);

    const dc = /^\.dc\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/im.exec(deck);
    if (dc) return this.runDcSweep(probes, dc);

    const tran = /^\.tran\s+(\S+)\s+(\S+)\s*$/im.exec(deck);
    if (tran) return this.runTransient(probes, tran);

    throw new NgspiceAdapterError("deck has no analysis card — cannot derive an axis", [
      { path: "deck", message: "missing .tran / .ac / .dc card" },
    ]);
  }

  private runTransient(probes: string[], tran: RegExpExecArray): BackendResult {
    const duration = parseSpiceTime(tran[2]!, "deck..tran.duration");
    const x = new Float64Array(MOCK_SAMPLE_COUNT);
    for (let i = 0; i < MOCK_SAMPLE_COUNT; i++) {
      x[i] = (i / (MOCK_SAMPLE_COUNT - 1)) * duration;
    }
    const signals: Record<string, Float64Array> = {};
    probes.forEach((probe, index) => {
      const wave = new Float64Array(MOCK_SAMPLE_COUNT);
      const amplitude = 1 + index * 0.5;
      const phase = (index * Math.PI) / 4;
      for (let i = 0; i < MOCK_SAMPLE_COUNT; i++) {
        // 3 full cycles over the run, scaled and phase-shifted per probe index.
        wave[i] = amplitude * Math.sin(2 * Math.PI * 3 * (i / (MOCK_SAMPLE_COUNT - 1)) + phase);
      }
      signals[probe] = wave;
    });
    return { x, signals };
  }

  private runAc(deck: string, probes: string[], ac: RegExpExecArray): BackendResult {
    const sweep = ac[1]! as "dec" | "oct" | "lin";
    const points = Number(ac[2]);
    const fStart = parseSpiceTime(ac[3]!, "deck..ac.fStart");
    const fStop = parseSpiceTime(ac[4]!, "deck..ac.fStop");
    const x = acFrequencyGrid(sweep, points, fStart, fStop);
    const fc = deckCornerHz(deck);

    const signals: Record<string, Float64Array> = {};
    const phase: Record<string, Float64Array> = {};
    for (const probe of probes) {
      const mag = new Float64Array(x.length);
      const ph = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const ratio = x[i]! / fc;
        mag[i] = -10 * Math.log10(1 + ratio * ratio); // 20·log10(1/√(1+r²))
        ph[i] = -Math.atan(ratio) * (180 / Math.PI);
      }
      signals[probe] = mag;
      phase[probe] = ph;
    }
    return { x, signals, phase };
  }

  private runDcSweep(probes: string[], dc: RegExpExecArray): BackendResult {
    const start = Number(dc[2]);
    const stop = Number(dc[3]);
    const step = Number(dc[4]);
    const count = Math.round(Math.abs((stop - start) / step)) + 1;
    const x = new Float64Array(count);
    for (let i = 0; i < count; i++) x[i] = start + i * step;

    const signals: Record<string, Float64Array> = {};
    probes.forEach((probe, index) => {
      // First probe is an exact 2:1 divider (slope 0.5); later probes stay
      // distinct via a shrinking gain, same spirit as the transient mock.
      const gain = 0.5 / (index + 1);
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) out[i] = gain * x[i]!;
      signals[probe] = out;
    });
    return { x, signals };
  }
}

/** ngspice `.ac` frequency grid: dec/oct = points-per-decade/octave, lin = total points. */
function acFrequencyGrid(
  sweep: "dec" | "oct" | "lin",
  points: number,
  fStart: number,
  fStop: number,
): Float64Array {
  if (sweep === "lin") {
    const n = Math.max(2, Math.round(points));
    const grid = new Float64Array(n);
    for (let i = 0; i < n; i++) grid[i] = fStart + ((fStop - fStart) * i) / (n - 1);
    return grid;
  }
  const base = sweep === "dec" ? 10 : 2;
  const spans = Math.log(fStop / fStart) / Math.log(base); // decades or octaves
  const count = Math.round(points * spans);
  const grid = new Float64Array(count + 1);
  for (let i = 0; i <= count; i++) grid[i] = fStart * base ** (i / points);
  grid[count] = fStop; // pin the endpoint exactly
  return grid;
}

/** Corner frequency 1/(2π·R·C) from the deck's first resistor and capacitor cards. */
function deckCornerHz(deck: string): number {
  const r = /^R\S*\s+\S+\s+\S+\s+(\S+)/im.exec(deck);
  const c = /^C\S*\s+\S+\s+\S+\s+(\S+)/im.exec(deck);
  if (!r || !c) return DEFAULT_CORNER_HZ;
  try {
    const rValue = parseSpiceTime(r[1]!, "deck.R");
    const cValue = parseSpiceTime(c[1]!, "deck.C");
    if (rValue > 0 && cValue > 0) return 1 / (2 * Math.PI * rValue * cValue);
  } catch {
    // fall through to default on an unparseable value
  }
  return DEFAULT_CORNER_HZ;
}

/** Minimal structural view of eecircuit-engine's ResultType (feature-detected). */
interface VectorLike {
  name: string;
  type?: string;
  values: unknown[];
}

function isVectorArray(data: unknown): data is VectorLike[] {
  return (
    Array.isArray(data) &&
    data.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as VectorLike).name === "string" &&
        Array.isArray((entry as VectorLike).values),
    )
  );
}

function toFloat64(values: unknown[], name: string): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const re = complexReal(value);
    if (re === null) {
      throw new NgspiceAdapterError(
        `vector "${name}" contains non-numeric values`,
        [{ path: `result.${name}`, message: "expected real (number) sample values" }],
      );
    }
    out[i] = re;
  }
  return out;
}

/** Real part of an eecircuit sample: a bare number, or the real of a complex `{real, img}`. */
function complexReal(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const real = (value as Record<string, unknown>).real ?? (value as Record<string, unknown>).re;
    if (typeof real === "number") return real;
  }
  return null;
}

/** Imaginary part of an eecircuit sample (`img`/`imag`/`im`); 0 for a bare real. */
function complexImag(value: unknown): number {
  if (typeof value === "number") return 0;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const im = o.img ?? o.imag ?? o.im;
    if (typeof im === "number") return im;
  }
  return 0;
}

/** Complex AC vector → magnitude (dB) + phase (deg) Float64Arrays. */
function toMagPhaseDb(values: unknown[], name: string): { mag: Float64Array; phase: Float64Array } {
  const mag = new Float64Array(values.length);
  const phase = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const re = complexReal(values[i]);
    if (re === null) {
      throw new NgspiceAdapterError(`vector "${name}" contains non-numeric values`, [
        { path: `result.${name}`, message: "expected complex or real sample values" },
      ]);
    }
    const im = complexImag(values[i]);
    mag[i] = 20 * Math.log10(Math.hypot(re, im));
    phase[i] = Math.atan2(im, re) * (180 / Math.PI);
  }
  return { mag, phase };
}

/**
 * WASM ngspice backend wrapping the `eecircuit-engine` npm package.
 *
 * NOTE: exercised in the browser — deliberately EXCLUDED from node unit
 * tests. The engine is loaded via dynamic import inside run() so importing
 * this module never pulls in the WASM bundle; node test runs stay pure.
 */
export class EECircuitBackend implements SimBackend {
  readonly name = "eecircuit";

  async run(deck: string, probes: string[]): Promise<BackendResult> {
    let engineModule: { Simulation?: new () => Simulation };
    try {
      engineModule = (await import("eecircuit-engine")) as { Simulation?: new () => Simulation };
    } catch (cause) {
      throw new NgspiceAdapterError(
        `eecircuit-engine failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
        [{ path: "backend", message: "eecircuit-engine failed to load" }],
      );
    }
    if (typeof engineModule.Simulation !== "function") {
      throw new NgspiceAdapterError("eecircuit-engine does not expose a Simulation class", [
        { path: "backend", message: "unexpected eecircuit-engine module shape" },
      ]);
    }

    let result: ResultType;
    try {
      const simulation = new engineModule.Simulation();
      await simulation.start();
      simulation.setNetList(deck);
      result = await simulation.runSim();
    } catch (cause) {
      throw new NgspiceAdapterError(
        `ngspice (WASM) run failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        [{ path: "backend", message: "ngspice (WASM) run failed" }],
      );
    }

    const data: unknown = (result as { data?: unknown }).data;
    if (!isVectorArray(data)) {
      throw new NgspiceAdapterError("eecircuit-engine returned an unexpected result shape", [
        { path: "result.data", message: "expected an array of named vectors" },
      ]);
    }

    const findProbe = (probe: string): VectorLike => {
      const vector = data.find((v) => v.name.toLowerCase() === probe.toLowerCase());
      if (!vector) {
        const available = data.map((v) => v.name).join(", ");
        throw new NgspiceAdapterError(
          `probe "${probe}" missing from simulation result (available: ${available})`,
          [{ path: "result.data", message: `probe "${probe}" not found` }],
        );
      }
      return vector;
    };

    // AC analysis: complex vectors over a frequency axis → magnitude(dB)+phase(deg).
    if (/^\.ac\b/im.test(deck)) {
      const freqVector = data.find(
        (v) => v.type === "frequency" || v.name.toLowerCase() === "frequency",
      );
      if (!freqVector) {
        throw new NgspiceAdapterError("AC result has no frequency vector", [
          { path: "result.data", message: "no vector of type/name 'frequency'" },
        ]);
      }
      const signals: Record<string, Float64Array> = {};
      const phase: Record<string, Float64Array> = {};
      for (const probe of probes) {
        const { mag, phase: ph } = toMagPhaseDb(findProbe(probe).values, probe);
        signals[probe] = mag;
        phase[probe] = ph;
      }
      return { x: toFloat64(freqVector.values, freqVector.name), signals, phase };
    }

    // DC sweep: real vectors over the swept-source axis (its default scale vector).
    if (/^\.dc\b/im.test(deck)) {
      const axis =
        data.find((v) => v.type === "voltage" && !probes.includes(v.name)) ?? data[0]!;
      const signals: Record<string, Float64Array> = {};
      for (const probe of probes) signals[probe] = toFloat64(findProbe(probe).values, probe);
      return { x: toFloat64(axis.values, axis.name), signals };
    }

    // Transient (default): real vectors over a time axis.
    const timeVector = data.find((v) => v.type === "time" || v.name.toLowerCase() === "time");
    if (!timeVector) {
      throw new NgspiceAdapterError("simulation result has no time vector", [
        { path: "result.data", message: "no vector of type/name 'time'" },
      ]);
    }
    const signals: Record<string, Float64Array> = {};
    for (const probe of probes) signals[probe] = toFloat64(findProbe(probe).values, probe);
    return { x: toFloat64(timeVector.values, timeVector.name), signals };
  }
}
