import type { Netlist, ValidationError } from "@openbench/ir-schema";

/**
 * Structured adapter error (engine-status checklist: failure modes return
 * structured errors, never raw engine output). Carries the shared
 * `{ path, message }` error shape from @openbench/ir-schema.
 */
export class NgspiceAdapterError extends Error {
  readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[] = []) {
    super(message);
    this.name = "NgspiceAdapterError";
    this.errors = errors.length > 0 ? errors : [{ path: "", message }];
  }
}

export interface TransientDeckConfig {
  mode?: "transient";
  /** Total simulated time, e.g. "10ms". */
  duration: string;
  /** Output step, e.g. "1us". */
  step: string;
}

/** AC small-signal sweep (issue #36) → `.ac <sweep> <points> <fStart> <fStop>`. */
export interface AcDeckConfig {
  mode: "ac";
  /** Points spacing: per-decade, per-octave, or absolute linear count. */
  sweep: "dec" | "oct" | "lin";
  /** Points per decade/octave, or total linear points. */
  points: number;
  /** Start frequency in Hz (SPICE value, e.g. "1", "10", "1k"). */
  fStart: string;
  /** Stop frequency in Hz (SPICE value, e.g. "1meg"). */
  fStop: string;
}

/** DC transfer sweep (issue #36) → `.dc <source> <start> <stop> <step>`. */
export interface DcSweepDeckConfig {
  mode: "dcSweep";
  /** Independent source to sweep, e.g. "V1". */
  source: string;
  start: number;
  stop: number;
  step: number;
}

/** Operating-point analysis (issue #30) → a bare `.op` card, one sample per signal. */
export interface OpDeckConfig {
  mode: "op";
}

export type DeckConfig =
  | TransientDeckConfig
  | AcDeckConfig
  | DcSweepDeckConfig
  | OpDeckConfig;

const AC_SWEEPS = new Set(["dec", "oct", "lin"]);

/**
 * SPICE time value: a number with optional exponent and optional ngspice
 * scale suffix (f p n u m k meg g t), optionally ending in "s"
 * (e.g. "10ms", "1us", "100n", "5e-3", "0.5s", "2meg").
 * "meg" must be tried before "m" in the alternation.
 */
const SPICE_TIME = /^(\d+(?:\.\d+)?|\.\d+)(e[+-]?\d+)?(meg|f|p|n|u|m|k|g|t)?s?$/i;

const SCALE: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  meg: 1e6,
  g: 1e9,
  t: 1e12,
};

export function isSpiceTimeValue(value: string): boolean {
  return SPICE_TIME.test(value.trim());
}

/** Parse a SPICE time value to seconds. Throws NgspiceAdapterError when malformed. */
export function parseSpiceTime(value: string, path = "value"): number {
  const match = SPICE_TIME.exec(value.trim());
  if (!match) {
    throw new NgspiceAdapterError(`"${value}" is not a SPICE time value (expected e.g. 10ms, 1us)`, [
      { path, message: `"${value}" is not a SPICE time value (expected e.g. 10ms, 1us)` },
    ]);
  }
  const magnitude = Number(`${match[1]}${match[2] ?? ""}`);
  const suffix = (match[3] ?? "").toLowerCase();
  const scale = suffix === "" ? 1 : SCALE[suffix] ?? 1;
  return magnitude * scale;
}

/**
 * Build an ngspice deck from netlist IR. The analysis card is chosen by
 * `config.mode` (default "transient", issue #9; "ac"/"dcSweep" added #36):
 *
 *   * OpenBench <netlist.id>
 *   <one line per element spiceCard>
 *   <.tran <step> <duration> | .ac <sweep> <points> <fStart> <fStop>
 *    | .dc <source> <start> <stop> <step>>
 *   .end
 *
 * Bad config throws a structured NgspiceAdapterError (callers map it to a
 * status:"failed" run — the tool contract never surfaces a bare throw).
 */
export function buildSpiceDeck(netlist: Netlist, config: DeckConfig): string {
  const analysisCard = buildAnalysisCard(config);
  const lines = [
    `* OpenBench ${netlist.id}`,
    ...netlist.elements.map((element) => element.spiceCard),
    analysisCard,
    ".end",
  ];
  return `${lines.join("\n")}\n`;
}

function buildAnalysisCard(config: DeckConfig): string {
  switch (config.mode) {
    case "ac":
      return buildAcCard(config);
    case "dcSweep":
      return buildDcSweepCard(config);
    case "op":
      return ".op";
    case undefined:
    case "transient":
      return buildTransientCard(config);
    default: {
      const mode = (config as { mode?: unknown }).mode;
      throw new NgspiceAdapterError(`unknown simulation mode "${String(mode)}"`, [
        { path: "config.mode", message: `unknown simulation mode "${String(mode)}"` },
      ]);
    }
  }
}

function buildTransientCard(config: TransientDeckConfig): string {
  const errors: ValidationError[] = [];
  if (typeof config.duration !== "string" || !isSpiceTimeValue(config.duration)) {
    errors.push({
      path: "config.duration",
      message: `duration "${config.duration}" is not a SPICE time value (expected e.g. 10ms, 1us)`,
    });
  }
  if (typeof config.step !== "string" || !isSpiceTimeValue(config.step)) {
    errors.push({
      path: "config.step",
      message: `step "${config.step}" is not a SPICE time value (expected e.g. 10ms, 1us)`,
    });
  }
  if (errors.length > 0) throw new NgspiceAdapterError("invalid transient config", errors);
  return `.tran ${config.step} ${config.duration}`;
}

function buildAcCard(config: AcDeckConfig): string {
  const errors: ValidationError[] = [];
  if (!AC_SWEEPS.has(config.sweep)) {
    errors.push({
      path: "config.sweep",
      message: `sweep "${config.sweep}" must be one of dec, oct, lin`,
    });
  }
  if (!Number.isInteger(config.points) || config.points <= 0) {
    errors.push({ path: "config.points", message: `points must be a positive integer` });
  }
  const fStartValid = typeof config.fStart === "string" && isSpiceTimeValue(config.fStart);
  const fStopValid = typeof config.fStop === "string" && isSpiceTimeValue(config.fStop);
  if (!fStartValid) {
    errors.push({
      path: "config.fStart",
      message: `fStart "${config.fStart}" is not a SPICE frequency value (expected e.g. 1, 10k, 1meg)`,
    });
  }
  if (!fStopValid) {
    errors.push({
      path: "config.fStop",
      message: `fStop "${config.fStop}" is not a SPICE frequency value (expected e.g. 1, 10k, 1meg)`,
    });
  }
  if (fStartValid && fStopValid && parseSpiceTime(config.fStop, "config.fStop") <= parseSpiceTime(config.fStart, "config.fStart")) {
    errors.push({
      path: "config.fStop",
      message: `fStop (${config.fStop}) must be greater than fStart (${config.fStart})`,
    });
  }
  if (errors.length > 0) throw new NgspiceAdapterError("invalid AC config", errors);
  return `.ac ${config.sweep} ${config.points} ${config.fStart} ${config.fStop}`;
}

function buildDcSweepCard(config: DcSweepDeckConfig): string {
  const errors: ValidationError[] = [];
  if (typeof config.source !== "string" || config.source.trim() === "") {
    errors.push({ path: "config.source", message: `source must be a non-empty source name, e.g. "V1"` });
  }
  for (const key of ["start", "stop", "step"] as const) {
    if (typeof config[key] !== "number" || !Number.isFinite(config[key])) {
      errors.push({ path: `config.${key}`, message: `${key} must be a finite number` });
    }
  }
  if (config.step === 0) {
    errors.push({ path: "config.step", message: `step must be non-zero` });
  }
  if (errors.length > 0) throw new NgspiceAdapterError("invalid DC-sweep config", errors);
  return `.dc ${config.source} ${config.start} ${config.stop} ${config.step}`;
}
