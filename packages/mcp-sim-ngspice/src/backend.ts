import type { ResultType, Simulation } from "eecircuit-engine";
import { NgspiceAdapterError, parseSpiceTime } from "./deck";
import { parseRawfile, type RawPlot } from "./rawfile";

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

    if (/^\.op\s*$/im.test(deck)) return this.runOp(probes);

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

  private runOp(probes: string[]): BackendResult {
    // Operating point: a single DC-bias sample per probe, no independent axis.
    const signals: Record<string, Float64Array> = {};
    probes.forEach((probe, index) => {
      signals[probe] = new Float64Array([1 + index * 0.5]);
    });
    return { x: new Float64Array([0]), signals };
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

/** Structured feature-detection result for the native CLI backend (issue #30). */
export interface NativeNgspiceAvailability {
  available: boolean;
  binaryPath?: string;
  reason?: string;
}

export interface NativeNgspiceHooks {
  /** Custom binary name/path to probe; defaults to `ngspice` on PATH. */
  binaryName?: string;
  /** Resolve the ngspice binary to an absolute path, or null if absent. Injectable for tests. */
  locate?: () => Promise<string | null>;
  /** Run a deck through ngspice in batch mode and return the ASCII rawfile text. Injectable for tests. */
  execute?: (binaryPath: string, deck: string) => Promise<string>;
}

/**
 * Native ngspice CLI backend (issue #30): feature-detects an `ngspice` binary,
 * runs a deck in batch mode, and parses the ASCII rawfile into a BackendResult.
 * Node-only — the default `locate`/`execute` lazily import node builtins so
 * importing this module never breaks a browser bundle (both hooks are injectable
 * for deterministic, binary-free unit tests).
 *
 * Absence is a first-class, structured state: `detect()` returns
 * `{ available: false, reason }` and never throws; `run()` on an unavailable
 * engine throws a structured `NgspiceAdapterError` (which `runSimulation` maps to
 * a `status: "failed"` run), so the seam never surfaces a raw engine crash.
 */
export class NativeNgspiceBackend implements SimBackend {
  readonly name = "ngspice-native";
  private readonly binaryName: string;
  private readonly locate: () => Promise<string | null>;
  private readonly execute: (binaryPath: string, deck: string) => Promise<string>;

  constructor(hooks: NativeNgspiceHooks = {}) {
    this.binaryName = hooks.binaryName ?? "ngspice";
    this.locate = hooks.locate ?? (() => defaultLocate(this.binaryName));
    this.execute = hooks.execute ?? ((binaryPath, deck) => defaultExecute(binaryPath, deck));
  }

  async detect(): Promise<NativeNgspiceAvailability> {
    try {
      const binaryPath = await this.locate();
      if (!binaryPath) {
        return { available: false, reason: `ngspice binary "${this.binaryName}" not found on PATH` };
      }
      return { available: true, binaryPath };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { available: false, reason: `ngspice feature-detection failed: ${message}` };
    }
  }

  async run(deck: string, probes: string[]): Promise<BackendResult> {
    const availability = await this.detect();
    if (!availability.available || !availability.binaryPath) {
      throw new NgspiceAdapterError(
        `ngspice engine unavailable: ${availability.reason ?? "unknown"}`,
        [{ path: "backend", message: "engine-unavailable" }],
      );
    }

    let rawText: string;
    try {
      rawText = await this.execute(availability.binaryPath, deck);
    } catch (cause) {
      throw new NgspiceAdapterError(
        `native ngspice run failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        [{ path: "backend", message: "native ngspice run failed" }],
      );
    }

    return shapeRawPlot(deck, parseRawfile(rawText), probes);
  }
}

/** Find a probe's vector in a rawfile, case-insensitively. */
function rawVector(plot: RawPlot, name: string): Float64Array {
  const key = Object.keys(plot.vectors).find((n) => n.toLowerCase() === name.toLowerCase());
  if (key === undefined) {
    const available = plot.variables.map((v) => v.name).join(", ");
    throw new NgspiceAdapterError(
      `probe "${name}" missing from ngspice rawfile (available: ${available})`,
      [{ path: "rawfile", message: `probe "${name}" not found` }],
    );
  }
  return plot.vectors[key]!;
}

/** Map a parsed real rawfile to a BackendResult, choosing the axis by the deck's analysis card. */
function shapeRawPlot(deck: string, plot: RawPlot, probes: string[]): BackendResult {
  if (/^\.ac\b/im.test(deck)) {
    throw new NgspiceAdapterError("native backend does not yet decode AC (complex) rawfiles", [
      { path: "backend", message: "AC not supported by the native rawfile parser" },
    ]);
  }

  const signals: Record<string, Float64Array> = {};
  for (const probe of probes) signals[probe] = rawVector(plot, probe);

  if (/^\.op\b/im.test(deck)) {
    // Operating point: no independent axis, one sample per probe.
    return { x: new Float64Array([0]), signals };
  }

  if (/^\.dc\b/im.test(deck)) {
    // Swept-source axis = the first variable that isn't a probed voltage.
    const axisVar =
      plot.variables.find((v) => !probes.some((p) => p.toLowerCase() === v.name.toLowerCase())) ??
      plot.variables[0]!;
    return { x: plot.vectors[axisVar.name]!, signals };
  }

  // Transient (default): the time variable is the axis.
  const timeVar =
    plot.variables.find((v) => v.type === "time" || v.name.toLowerCase() === "time") ??
    plot.variables[0]!;
  return { x: plot.vectors[timeVar.name]!, signals };
}

/** Default binary probe: `ngspice --version` exits 0 iff the binary is on PATH. */
async function defaultLocate(binaryName: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  return new Promise<string | null>((resolve) => {
    execFile(binaryName, ["--version"], { timeout: 5000 }, (err) => {
      resolve(err ? null : binaryName);
    });
  });
}

/** Default batch run: write the deck, run ngspice with an ASCII rawfile, read it back. */
async function defaultExecute(binaryPath: string, deck: string): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbench-ngspice-"));
  const deckPath = path.join(dir, "deck.cir");
  const rawPath = path.join(dir, "out.raw");
  await fs.writeFile(deckPath, deck, "utf8");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        binaryPath,
        ["-b", "-r", rawPath, deckPath],
        { env: { ...globalThis.process?.env, SPICE_ASCIIRAWFILE: "1" }, timeout: 60_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return await fs.readFile(rawPath, "utf8");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ── Native ngspice CLI backend (issue #118, desktop pivot ADR-0024) ──────────

/**
 * Parse ngspice `wrdata` ASCII output into `{ time, signals }`.
 *
 * `wrdata <file> <vec…>` writes a whitespace-separated column table. ngspice
 * prepends each vector with its own scale column, so P probes yield **2·P**
 * columns laid out `scale v1 scale v2 …` (the "interleaved" layout). Some
 * setups (a single shared scale) emit **P+1** columns instead — one leading
 * scale then one value column per probe. Both are accepted; anything else is a
 * structured error rather than a silent mis-parse.
 *
 * Pure and total in spirit: malformed input (empty, ragged, or an unrecognised
 * column count) throws a typed {@link NgspiceAdapterError} — never an unhandled
 * `TypeError` — so `run()` / `runSimulation` can map it to a structured failure.
 */
export function parseNgspiceOutput(
  text: string,
  probes: string[],
): { time: Float64Array; signals: Record<string, Float64Array> } {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Skip blanks and comment/annotation lines wrdata never emits as data.
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("*"))
    .map((line) => line.split(/\s+/).map(Number));

  if (rows.length === 0) {
    throw new NgspiceAdapterError("ngspice produced no data rows", [
      { path: "output", message: "empty wrdata output" },
    ]);
  }

  const cols = rows[0]!.length;
  if (rows.some((r) => r.length !== cols)) {
    throw new NgspiceAdapterError("ngspice wrdata rows have inconsistent column counts", [
      { path: "output", message: "ragged wrdata table" },
    ]);
  }
  if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) {
    throw new NgspiceAdapterError("ngspice wrdata contains non-numeric values", [
      { path: "output", message: "non-numeric wrdata cell" },
    ]);
  }

  const p = probes.length;
  // Column layout → (scale column index, value column index per probe).
  let scaleCol: number;
  let valueColOf: (i: number) => number;
  if (p > 0 && cols === 2 * p) {
    scaleCol = 0;
    valueColOf = (i) => 2 * i + 1; // interleaved: scale v1 scale v2 …
  } else if (p > 0 && cols === p + 1) {
    scaleCol = 0;
    valueColOf = (i) => i + 1; // shared scale, then one value per probe
  } else {
    throw new NgspiceAdapterError(
      `ngspice wrdata has ${cols} columns, which fits neither the interleaved (${2 * p}) ` +
        `nor shared-scale (${p + 1}) layout for ${p} probe(s)`,
      [{ path: "output", message: "unrecognised wrdata column count" }],
    );
  }

  const time = Float64Array.from(rows, (r) => r[scaleCol]!);
  const signals: Record<string, Float64Array> = {};
  probes.forEach((probe, i) => {
    signals[probe] = Float64Array.from(rows, (r) => r[valueColOf(i)]!);
  });
  return { time, signals };
}

/** Constructor options for {@link NgspiceCliBackend} — all injectable for tests. */
export interface NgspiceCliOptions {
  /** ngspice binary name or absolute path; defaults to `ngspice` on PATH. The
   * bundling issue points this at the bundled binary's absolute path. */
  ngspiceBinary?: string;
  /** Availability probe; defaults to `ngspiceBinary --version` exiting 0. */
  isAvailable?: () => boolean | Promise<boolean>;
  /** Run a deck through ngspice and return its `wrdata` ASCII text. Injectable. */
  execute?: (deck: string, probes: string[]) => Promise<string>;
}

/**
 * Desktop-facing native ngspice CLI backend (issue #118, ADR-0024). Feature-
 * detected exactly like `PioCliBackend`: an absent binary is a structured
 * `engine-unavailable` failure — `run()` throws a typed {@link NgspiceAdapterError}
 * that `runSimulation` maps to a `status:"failed"` run (never a raw crash).
 *
 * It differs from the pre-existing `NativeNgspiceBackend` (#30) only in the wire
 * format it reads back: this one appends a `wrdata` control block and parses the
 * plain ASCII column table ({@link parseNgspiceOutput}), which is simpler and
 * more version-robust than the binary rawfile. The two native paths are expected
 * to converge once the desktop backend settles on one (tracked as a follow-up).
 */
export class NgspiceCliBackend implements SimBackend {
  readonly name = "ngspice-cli";
  private readonly ngspiceBinary: string;
  private readonly isAvailable: () => boolean | Promise<boolean>;
  private readonly execute: (deck: string, probes: string[]) => Promise<string>;

  constructor(options: NgspiceCliOptions = {}) {
    this.ngspiceBinary = options.ngspiceBinary ?? "ngspice";
    this.isAvailable = options.isAvailable ?? (() => defaultCliAvailable(this.ngspiceBinary));
    this.execute =
      options.execute ?? ((deck, probes) => defaultCliExecute(this.ngspiceBinary, deck, probes));
  }

  async run(deck: string, probes: string[]): Promise<BackendResult> {
    if (!(await this.isAvailable())) {
      throw new NgspiceAdapterError(
        `ngspice CLI engine-unavailable: binary "${this.ngspiceBinary}" not found on PATH`,
        [{ path: "backend", message: "engine-unavailable" }],
      );
    }

    let rawText: string;
    try {
      rawText = await this.execute(deck, probes);
    } catch (cause) {
      throw new NgspiceAdapterError(
        `ngspice CLI run failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        [{ path: "backend", message: "ngspice CLI run failed" }],
      );
    }

    if (/^\.ac\b/im.test(deck)) {
      throw new NgspiceAdapterError("ngspice CLI backend does not yet decode AC (complex) output", [
        { path: "backend", message: "AC not supported by the wrdata parser" },
      ]);
    }

    const { time, signals } = parseNgspiceOutput(rawText, probes);
    // Transient/DC/OP all put the independent axis in the scale column. (OP is a
    // single row; DC's scale is the swept source — both read back as `time`.)
    return { x: time, signals };
  }
}

/** `ngspice --version` exits 0 iff the binary resolves — mirrors `PioCliBackend`. */
async function defaultCliAvailable(binary: string): Promise<boolean> {
  const { spawnSync } = await import("node:child_process");
  try {
    const probe = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000 });
    return probe.error === undefined && probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Batch run producing `wrdata` ASCII: write the deck with a `.control` block that
 * runs the analysis and dumps the probes, invoke `ngspice -b`, read the table.
 * Node-only (lazily imports builtins) and untested in CI — the binary is absent —
 * exactly like `NativeNgspiceBackend`'s default executor; the bundling issue's
 * smoke test exercises the real binary.
 */
async function defaultCliExecute(binary: string, deck: string, probes: string[]): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbench-ngspice-cli-"));
  const outPath = path.join(dir, "out.txt");
  // Strip a trailing `.end` so the control block runs before the deck closes.
  const body = deck.replace(/^\s*\.end\s*$/im, "").trimEnd();
  // `wr_singlescale` → one shared scale column (P+1 layout), which
  // parseNgspiceOutput reads directly. No `wr_vecnames`: a name header would be
  // a non-numeric row the parser rejects.
  const control = `\n.control\nrun\nset wr_singlescale\nwrdata ${outPath} ${probes.join(" ")}\n.endc\n.end\n`;
  const deckPath = path.join(dir, "deck.cir");
  await fs.writeFile(deckPath, `${body}${control}`, "utf8");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(binary, ["-b", deckPath], { timeout: 60_000 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    return await fs.readFile(outPath, "utf8");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
