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
  /**
   * Progress callback: fires "compiling" when the netlist/deck is being built
   * and "simulating" immediately before the backend runs. Lets the store drive
   * user-facing run phase (issue #130) without leaking backend internals.
   */
  onPhase?: (phase: "compiling" | "simulating") => void;
}

export interface RunProjectSimulationResult {
  /** Absent when compilation or deck construction failed. */
  run?: SimulationRun;
  /** The SPICE deck that was (or would have been) simulated. */
  deck?: string;
  /** Non-fatal compiler warnings (e.g. instances without a simModel). */
  warnings: string[];
  consoleEntries: ConsoleEntry[];
  /**
   * The name of the backend that actually produced the run (e.g. "eecircuit"
   * or "mock"). Absent when no run happened (compile/config failure). For a
   * fallback backend this is the *effective* backend, not the composite name.
   */
  backendUsed?: string;
  /**
   * True when the run silently degraded from the primary (WASM) backend to the
   * deterministic mock backend — surfaced to the user so results are never
   * mistaken for a real simulation (issue #130).
   */
  usedMockFallback: boolean;
}

/**
 * A backend that can report, after `run()`, which of its inner backends
 * actually produced the results and whether that was a fallback.
 */
export interface FallbackSimBackend extends SimBackend {
  /** The inner backend name that produced the last run (undefined pre-run). */
  readonly lastUsedBackend: string | undefined;
  /** True when the last run fell through from primary to fallback. */
  readonly lastUsedFallback: boolean;
}

function isFallbackBackend(backend: SimBackend): backend is FallbackSimBackend {
  return "lastUsedBackend" in backend && "lastUsedFallback" in backend;
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
): FallbackSimBackend {
  let lastUsedBackend: string | undefined;
  let lastUsedFallback = false;
  return {
    name: `${primary.name}-with-${fallback.name}-fallback`,
    get lastUsedBackend() {
      return lastUsedBackend;
    },
    get lastUsedFallback() {
      return lastUsedFallback;
    },
    async run(deck, probes) {
      try {
        const result = await primary.run(deck, probes);
        lastUsedBackend = primary.name;
        lastUsedFallback = false;
        return result;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        log({
          level: "warn",
          text: `${primary.name} backend failed (${message}) — falling back to the ${fallback.name} backend`,
        });
        const result = await fallback.run(deck, probes);
        lastUsedBackend = fallback.name;
        lastUsedFallback = true;
        return result;
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

  opts.onPhase?.("compiling");

  const compiled = compileNetlist(bundle.schematic, getComponent);
  if (!compiled.ok) {
    for (const error of compiled.errors) {
      log({ level: "error", text: `compile error at ${error.path}: ${error.message}` });
    }
    return { warnings: [], consoleEntries, usedMockFallback: false };
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
    return { warnings, consoleEntries, usedMockFallback: false };
  }

  const backend =
    opts.backend ??
    (backendFactoryOverride !== null
      ? await backendFactoryOverride()
      : await createDefaultBackend(log));

  log({ level: "info", text: `transient ${duration} (step ${step}) on backend "${backend.name}"` });

  opts.onPhase?.("simulating");

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

  // Report which concrete backend ran. For a fallback backend, use its
  // effective inner backend + fallback flag; otherwise the backend's own name.
  const usedMockFallback = isFallbackBackend(backend) ? backend.lastUsedFallback : false;
  const backendUsed = isFallbackBackend(backend)
    ? (backend.lastUsedBackend ?? backend.name)
    : backend.name;

  if (usedMockFallback) {
    log({
      level: "warn",
      text: `results were produced by the "${backendUsed}" fallback backend — not the real WASM ngspice engine`,
    });
  }

  return { run, deck, warnings, consoleEntries, backendUsed, usedMockFallback };
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
