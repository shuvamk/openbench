import type { ResultType, Simulation } from "eecircuit-engine";
import { NgspiceAdapterError, parseSpiceTime } from "./deck";

/**
 * One interface, two execution backends (ADR-0006): WASM ngspice in-browser
 * (EECircuitBackend) and a deterministic mock for node unit tests. A native
 * ngspice CLI backend can be added behind this same interface later.
 */
export interface SimBackend {
  name: string;
  run(
    deck: string,
    probes: string[],
  ): Promise<{ time: Float64Array; signals: Record<string, Float64Array> }>;
}

const MOCK_SAMPLE_COUNT = 256;

export interface MockBackendOptions {
  /** When set, run() rejects with this message (failure-path testing). */
  fail?: string;
}

/**
 * Deterministic, node-safe backend. Parses the deck's `.tran <step> <duration>`
 * card and generates 256 samples over the duration; probe i gets a scaled sine
 * with an index-based phase so every probe's waveform is distinct.
 */
export class MockBackend implements SimBackend {
  readonly name = "mock";
  private readonly options: MockBackendOptions;

  constructor(options: MockBackendOptions = {}) {
    this.options = options;
  }

  async run(
    deck: string,
    probes: string[],
  ): Promise<{ time: Float64Array; signals: Record<string, Float64Array> }> {
    if (this.options.fail !== undefined) {
      throw new NgspiceAdapterError(this.options.fail);
    }
    const tran = /^\.tran\s+(\S+)\s+(\S+)\s*$/im.exec(deck);
    if (!tran) {
      throw new NgspiceAdapterError("deck has no .tran card — cannot derive a time base", [
        { path: "deck", message: "missing .tran <step> <duration> card" },
      ]);
    }
    const duration = parseSpiceTime(tran[2]!, "deck..tran.duration");

    const time = new Float64Array(MOCK_SAMPLE_COUNT);
    for (let i = 0; i < MOCK_SAMPLE_COUNT; i++) {
      time[i] = (i / (MOCK_SAMPLE_COUNT - 1)) * duration;
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
    return { time, signals };
  }
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
    if (typeof value !== "number") {
      throw new NgspiceAdapterError(
        `vector "${name}" contains non-real values — transient analysis expects real data`,
        [{ path: `result.${name}`, message: "expected real (number) sample values" }],
      );
    }
    out[i] = value;
  }
  return out;
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

  async run(
    deck: string,
    probes: string[],
  ): Promise<{ time: Float64Array; signals: Record<string, Float64Array> }> {
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

    const timeVector = data.find((v) => v.type === "time" || v.name.toLowerCase() === "time");
    if (!timeVector) {
      throw new NgspiceAdapterError("simulation result has no time vector", [
        { path: "result.data", message: "no vector of type/name 'time'" },
      ]);
    }

    const signals: Record<string, Float64Array> = {};
    for (const probe of probes) {
      const vector = data.find((v) => v.name.toLowerCase() === probe.toLowerCase());
      if (!vector) {
        const available = data.map((v) => v.name).join(", ");
        throw new NgspiceAdapterError(
          `probe "${probe}" missing from simulation result (available: ${available})`,
          [{ path: "result.data", message: `probe "${probe}" not found` }],
        );
      }
      signals[probe] = toFloat64(vector.values, vector.name);
    }
    return { time: toFloat64(timeVector.values, timeVector.name), signals };
  }
}
