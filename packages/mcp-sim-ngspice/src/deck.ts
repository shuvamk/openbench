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
  /** Total simulated time, e.g. "10ms". */
  duration: string;
  /** Output step, e.g. "1us". */
  step: string;
}

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
 * Build an ngspice transient deck from netlist IR (issue #9). Layout:
 *
 *   * OpenBench <netlist.id>
 *   <one line per element spiceCard>
 *   .tran <step> <duration>
 *   .end
 */
export function buildSpiceDeck(netlist: Netlist, config: TransientDeckConfig): string {
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
  if (errors.length > 0) {
    throw new NgspiceAdapterError("invalid transient config", errors);
  }

  const lines = [
    `* OpenBench ${netlist.id}`,
    ...netlist.elements.map((element) => element.spiceCard),
    `.tran ${config.step} ${config.duration}`,
    ".end",
  ];
  return `${lines.join("\n")}\n`;
}
