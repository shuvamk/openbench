/**
 * Simulation orchestration for the editor (issue #13):
 * schematic IR → netlist IR (@openbench/netlist-compiler + registry resolver)
 * → SPICE deck → SimBackend → simulationRun IR.
 *
 * Compile and config failures come back as console entries — nothing throws.
 */
import type { Schematic, SimulationRun } from "@openbench/ir-schema";
import { compileNetlist } from "@openbench/netlist-compiler";
import {
  NgspiceAdapterError,
  buildSpiceDeck,
  runSimulation,
  type SimBackend,
} from "@openbench/mcp-sim-ngspice";
import { getComponent } from "@openbench/registry";
import type { ProjectBundle } from "../project-store/types";

export const DEFAULT_DURATION = "10ms";
export const DEFAULT_STEP = "10us";

export interface ConsoleEntry {
  level: "info" | "warn" | "error";
  text: string;
}

export interface RunProjectSimulationOptions {
  /** Transient duration, e.g. "10ms". */
  duration?: string;
  /** Transient step, e.g. "10us". */
  step?: string;
  /** netIds to probe; defaults to every non-ground net. */
  probes?: string[];
  /** Backend override (tests / callers with their own engine). */
  backend?: SimBackend;
  /** Injectable clock for deterministic provenance stamps. */
  now?: string;
}

export interface RunProjectSimulationResult {
  /** Absent when compilation or deck construction failed. */
  run?: SimulationRun;
  /** The SPICE deck that was (or would have been) simulated. */
  deck?: string;
  /** Non-fatal compiler warnings (e.g. instances without a simModel). */
  warnings: string[];
  consoleEntries: ConsoleEntry[];
}

type BackendFactory = () => SimBackend | Promise<SimBackend>;

let backendFactoryOverride: BackendFactory | null = null;

/** Tests inject a deterministic backend here (null restores the default). */
export function __setSimBackendFactoryForTests(factory: BackendFactory | null): void {
  backendFactoryOverride = factory;
}

/**
 * A backend that tries `primary` and, if construction/run fails, logs a
 * console entry and re-runs on `fallback`. This is how the browser prefers
 * WASM ngspice but degrades to the deterministic mock (ADR-0006).
 */
export function createFallbackBackend(
  primary: SimBackend,
  fallback: SimBackend,
  log: (entry: ConsoleEntry) => void,
): SimBackend {
  return {
    name: `${primary.name}-with-${fallback.name}-fallback`,
    async run(deck, probes) {
      try {
        return await primary.run(deck, probes);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        log({
          level: "warn",
          text: `${primary.name} backend failed (${message}) — falling back to the ${fallback.name} backend`,
        });
        return fallback.run(deck, probes);
      }
    },
  };
}

/**
 * Default backend: eecircuit (WASM ngspice, loaded lazily in the browser)
 * with the mock backend as a fallback. The adapter module is imported
 * dynamically so the editor bundle only pays for it when a run happens.
 */
async function createDefaultBackend(log: (entry: ConsoleEntry) => void): Promise<SimBackend> {
  const mod = await import("@openbench/mcp-sim-ngspice");
  return createFallbackBackend(new mod.EECircuitBackend(), new mod.MockBackend(), log);
}

/** Ground heuristic mirroring the netlist compiler (names GND/AGND/0 or a cmp_ground pin). */
export function defaultProbeNetIds(schematic: Schematic): string[] {
  const groundInstances = new Set(
    schematic.instances
      .filter((instance) => instance.componentId === "cmp_ground")
      .map((instance) => instance.instanceId),
  );
  return schematic.nets
    .filter(
      (net) =>
        !(net.name !== undefined && ["GND", "AGND", "0"].includes(net.name.toUpperCase())) &&
        !net.connections.some((c) => groundInstances.has(c.instanceId)),
    )
    .map((net) => net.netId);
}

/**
 * Compile the bundle's schematic and run a transient simulation. Never
 * throws: compile/config errors come back as `level: "error"` console
 * entries with no `run`; backend failures yield a `status: "failed"` run.
 */
export async function runProjectSimulation(
  bundle: ProjectBundle,
  opts: RunProjectSimulationOptions = {},
): Promise<RunProjectSimulationResult> {
  const duration = opts.duration ?? DEFAULT_DURATION;
  const step = opts.step ?? DEFAULT_STEP;
  const consoleEntries: ConsoleEntry[] = [];
  const log = (entry: ConsoleEntry) => consoleEntries.push(entry);

  const compiled = compileNetlist(bundle.schematic, getComponent);
  if (!compiled.ok) {
    for (const error of compiled.errors) {
      log({ level: "error", text: `compile error at ${error.path}: ${error.message}` });
    }
    return { warnings: [], consoleEntries };
  }

  const warnings = compiled.warnings;
  for (const warning of warnings) {
    log({ level: "warn", text: warning });
  }

  let deck: string;
  try {
    deck = buildSpiceDeck(compiled.netlist, { duration, step });
  } catch (cause) {
    if (cause instanceof NgspiceAdapterError) {
      for (const error of cause.errors) {
        log({ level: "error", text: `${error.path}: ${error.message}` });
      }
    } else {
      log({ level: "error", text: cause instanceof Error ? cause.message : String(cause) });
    }
    return { warnings, consoleEntries };
  }

  const backend =
    opts.backend ??
    (backendFactoryOverride !== null
      ? await backendFactoryOverride()
      : await createDefaultBackend(log));

  log({ level: "info", text: `transient ${duration} (step ${step}) on backend "${backend.name}"` });

  const run = await runSimulation(
    compiled.netlist,
    { mode: "transient", duration, step, probes: opts.probes },
    backend,
    { now: opts.now },
  );

  if (run.status === "failed") {
    log({ level: "error", text: `simulation ${run.id} failed${describeLogs(run.logs)}` });
  } else {
    const signalCount = run.results?.signals.length ?? 0;
    log({ level: "info", text: `simulation ${run.id} completed with ${signalCount} signals` });
  }

  return { run, deck, warnings, consoleEntries };
}

/** Decode an inline data:text/plain;base64 log for display (best effort). */
function describeLogs(logs: string | undefined): string {
  if (logs === undefined) return "";
  const match = /^data:text\/plain;base64,(.*)$/.exec(logs);
  if (!match) return `: ${logs}`;
  try {
    return `: ${atob(match[1]!)}`;
  } catch {
    return "";
  }
}
