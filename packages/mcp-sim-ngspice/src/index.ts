/**
 * @openbench/mcp-sim-ngspice — ngspice engine adapter (issue #9, #36).
 *
 * netlist IR → SPICE deck → SimBackend (mock | eecircuit WASM) →
 * simulationRun IR with inline waveform-v1 results (ADR-0006/0007).
 * Modes: transient (#9), ac + dcSweep (#36).
 */
import {
  IR_VERSION,
  type Netlist,
  type SimulationRun,
  type WaveformSignal,
} from "@openbench/ir-schema";
import type { BackendResult, SimBackend } from "./backend";
import { buildSpiceDeck, type DeckConfig } from "./deck";
import { encodeSamples, encodeTextAsDataUri } from "./samples";

export {
  buildSpiceDeck,
  isSpiceTimeValue,
  NgspiceAdapterError,
  parseSpiceTime,
  type AcDeckConfig,
  type DcSweepDeckConfig,
  type DeckConfig,
  type OpDeckConfig,
  type TransientDeckConfig,
} from "./deck";
export { decodeSamples, encodeSamples, encodeTextAsDataUri } from "./samples";
export {
  EECircuitBackend,
  MockBackend,
  NativeNgspiceBackend,
  type BackendResult,
  type MockBackendOptions,
  type NativeNgspiceAvailability,
  type NativeNgspiceHooks,
  type SimBackend,
} from "./backend";
export {
  parseRawfile,
  serializeRawfile,
  type RawPlot,
  type RawVariable,
} from "./rawfile";

/** netIds to probe; defaults to every non-ground net (spiceNode !== "0"). */
interface WithProbes {
  probes?: string[];
}

export interface TransientRunConfig extends WithProbes {
  mode: "transient";
  duration: string;
  step: string;
}

/** AC small-signal sweep (issue #36). Results carry dB/deg over frequency (Hz). */
export interface AcRunConfig extends WithProbes {
  mode: "ac";
  sweep: "dec" | "oct" | "lin";
  points: number;
  fStart: string;
  fStop: string;
}

/** DC transfer sweep (issue #36). Result x-axis is the swept source, not time. */
export interface DcSweepRunConfig extends WithProbes {
  mode: "dcSweep";
  source: string;
  start: number;
  stop: number;
  step: number;
}

/** Operating-point analysis (issue #30). One DC-bias sample per net, no axis. */
export interface OpRunConfig extends WithProbes {
  mode: "op";
}

export type RunConfig = TransientRunConfig | AcRunConfig | DcSweepRunConfig | OpRunConfig;

export interface RunSimulationOptions {
  /** Injectable clock (ISO-8601) for deterministic provenance stamps. */
  now?: string;
}

const GROUND_SPICE_NODE = "0";

function randomSimId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) {
    return `sim_${cryptoObj.randomUUID().toLowerCase()}`;
  }
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 24; i++) {
    suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return `sim_${suffix}`;
}

/** Derive the deck config and the doc-stored `config` object from a run config. */
function deckConfigFor(config: RunConfig): { deck: DeckConfig; stored: Record<string, unknown> } {
  switch (config.mode) {
    case "ac":
      return {
        deck: {
          mode: "ac",
          sweep: config.sweep,
          points: config.points,
          fStart: config.fStart,
          fStop: config.fStop,
        },
        stored: {
          sweep: config.sweep,
          points: config.points,
          fStart: config.fStart,
          fStop: config.fStop,
        },
      };
    case "dcSweep":
      return {
        deck: {
          mode: "dcSweep",
          source: config.source,
          start: config.start,
          stop: config.stop,
          step: config.step,
        },
        stored: { source: config.source, start: config.start, stop: config.stop, step: config.step },
      };
    case "op":
      return { deck: { mode: "op" }, stored: {} };
    case "transient":
    default:
      return {
        deck: { mode: "transient", duration: config.duration, step: config.step },
        stored: { duration: config.duration, step: config.step },
      };
  }
}

/**
 * Shape a backend result into waveform-v1 signals for the run's mode:
 *  - transient: per-net V samples + a `time` (s) axis;
 *  - ac: per-net magnitude (dB) + phase (deg) + a `frequency` (Hz) axis;
 *  - dcSweep: per-net V samples + the swept source as the x-axis (unit V).
 */
function shapeSignals(
  config: RunConfig,
  probePairs: { netId: string; probe: string }[],
  result: BackendResult,
  backendName: string,
): WaveformSignal[] {
  const sampleFor = (probe: string, bank: Record<string, Float64Array>, what: string): Float64Array => {
    const samples = bank[probe];
    if (samples === undefined) {
      throw new Error(`backend "${backendName}" returned no ${what} for probe "${probe}"`);
    }
    return samples;
  };

  const out: WaveformSignal[] = [];
  if (config.mode === "op") {
    // Operating point: one V sample per net, no independent axis.
    for (const { netId, probe } of probePairs) {
      out.push({ netId, unit: "V", samples: encodeSamples(sampleFor(probe, result.signals, "samples")) });
    }
    return out;
  }
  if (config.mode === "ac") {
    if (result.phase === undefined) {
      throw new Error(`backend "${backendName}" returned no phase data for an AC run`);
    }
    for (const { netId, probe } of probePairs) {
      out.push({ netId, unit: "dB", samples: encodeSamples(sampleFor(probe, result.signals, "magnitude")) });
      out.push({ netId, unit: "deg", samples: encodeSamples(sampleFor(probe, result.phase, "phase")) });
    }
    out.push({ netId: "frequency", unit: "Hz", samples: encodeSamples(result.x) });
    return out;
  }

  for (const { netId, probe } of probePairs) {
    out.push({ netId, unit: "V", samples: encodeSamples(sampleFor(probe, result.signals, "samples")) });
  }
  if (config.mode === "dcSweep") {
    // x-axis is the swept independent source (a voltage), not time.
    out.push({ netId: config.source, unit: "V", samples: encodeSamples(result.x) });
  } else {
    out.push({ netId: "time", unit: "s", samples: encodeSamples(result.x) });
  }
  return out;
}

/**
 * Run a simulation of a netlist IR document against a backend and return a
 * `simulationRun` IR document. `config.mode` selects transient (#9), ac,
 * dcSweep (#36), or op (#30). Never throws: any failure (bad config, unknown probe, backend
 * rejection) yields a `status: "failed"` run with the message inlined in `logs`
 * (engine-status checklist: structured failures, never raw engine throws).
 */
export async function runSimulation(
  netlist: Netlist,
  config: RunConfig,
  backend: SimBackend,
  opts: RunSimulationOptions = {},
): Promise<SimulationRun> {
  const { deck: deckConfig, stored } = deckConfigFor(config);
  const base = {
    irVersion: IR_VERSION,
    kind: "simulationRun" as const,
    id: randomSimId(),
    netlistId: netlist.id,
    engine: "ngspice" as const,
    mode: config.mode,
    config: stored,
    provenance: { source: "mcp-sim-ngspice", at: opts.now ?? new Date().toISOString() },
  };

  try {
    // Default probes: every non-ground net declared in the netlist.
    const probeNetIds =
      config.probes ?? netlist.nodes.filter((n) => n.spiceNode !== GROUND_SPICE_NODE).map((n) => n.netId);

    // Map netId → spice probe name "v(<spiceNode>)" for the backend.
    const spiceNodeByNetId = new Map(netlist.nodes.map((n) => [n.netId, n.spiceNode]));
    const probePairs = probeNetIds.map((netId) => {
      const spiceNode = spiceNodeByNetId.get(netId);
      if (spiceNode === undefined) {
        throw new Error(`probe references unknown net "${netId}" — not declared in netlist ${netlist.id}`);
      }
      return { netId, probe: `v(${spiceNode})` };
    });

    const deck = buildSpiceDeck(netlist, deckConfig);
    const result = await backend.run(
      deck,
      probePairs.map((pair) => pair.probe),
    );

    const waveformSignals = shapeSignals(config, probePairs, result, backend.name);

    return {
      ...base,
      status: "completed",
      results: { format: "waveform-v1", signals: waveformSignals },
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ...base,
      status: "failed",
      logs: encodeTextAsDataUri(message),
    };
  }
}
