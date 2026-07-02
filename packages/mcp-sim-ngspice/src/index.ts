/**
 * @openbench/mcp-sim-ngspice — ngspice engine adapter (issue #9).
 *
 * netlist IR → SPICE deck → SimBackend (mock | eecircuit WASM) →
 * simulationRun IR with inline waveform-v1 results (ADR-0006/0007).
 */
import {
  IR_VERSION,
  type Netlist,
  type SimulationRun,
  type WaveformSignal,
} from "@openbench/ir-schema";
import type { SimBackend } from "./backend";
import { buildSpiceDeck } from "./deck";
import { encodeSamples, encodeTextAsDataUri } from "./samples";

export {
  buildSpiceDeck,
  isSpiceTimeValue,
  NgspiceAdapterError,
  parseSpiceTime,
  type TransientDeckConfig,
} from "./deck";
export { decodeSamples, encodeSamples, encodeTextAsDataUri } from "./samples";
export { EECircuitBackend, MockBackend, type MockBackendOptions, type SimBackend } from "./backend";

export interface TransientRunConfig {
  mode: "transient";
  duration: string;
  step: string;
  /** netIds to probe; defaults to every non-ground net (spiceNode !== "0"). */
  probes?: string[];
}

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

/**
 * Run a transient simulation of a netlist IR document against a backend and
 * return a `simulationRun` IR document. Never throws: any failure (bad
 * config, unknown probe, backend rejection) yields a `status: "failed"` run
 * with the message inlined in `logs` (engine-status checklist: structured
 * failures, never raw engine throws).
 */
export async function runSimulation(
  netlist: Netlist,
  config: TransientRunConfig,
  backend: SimBackend,
  opts: RunSimulationOptions = {},
): Promise<SimulationRun> {
  const base = {
    irVersion: IR_VERSION,
    kind: "simulationRun" as const,
    id: randomSimId(),
    netlistId: netlist.id,
    engine: "ngspice" as const,
    mode: config.mode,
    config: { duration: config.duration, step: config.step },
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

    const deck = buildSpiceDeck(netlist, { duration: config.duration, step: config.step });
    const { time, signals } = await backend.run(
      deck,
      probePairs.map((pair) => pair.probe),
    );

    // Map spice probe names back to netIds in the results.
    const waveformSignals: WaveformSignal[] = probePairs.map(({ netId, probe }) => {
      const samples = signals[probe];
      if (samples === undefined) {
        throw new Error(`backend "${backend.name}" returned no samples for probe "${probe}"`);
      }
      return { netId, unit: "V", samples: encodeSamples(samples) };
    });
    waveformSignals.push({ netId: "time", unit: "s", samples: encodeSamples(time) });

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
