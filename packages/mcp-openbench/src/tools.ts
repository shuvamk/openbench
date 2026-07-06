/**
 * Agent-control tool surface (spike #33 / ADR-0019 / issue #42).
 *
 * Ten transport-agnostic tool handlers — the product-level verbs an AI agent
 * (Claude Desktop, Cursor, or the in-app copilot) uses to author, wire,
 * simulate and read back a circuit through the IR. Each is a *thin translation*
 * of an existing pure function (`@openbench/schematic-ops` for authoring,
 * `netlist-compiler`, `erc`, `mcp-sim-ngspice`, `ir-schema` for derivation) —
 * **no new engine logic**. The server is stateless: every tool takes the
 * current IR document as an argument and returns the mutated document plus any
 * derived result (ADR-0019 §2).
 *
 * These handlers are exported (not just wired into the MCP server) so the
 * in-app copilot in `apps/web` can call the SAME implementation the external
 * MCP server does — one tool surface, never two divergent copies.
 *
 * Every handler returns the repo-standard never-throw discriminated result,
 * identical to `compileNetlist` / `mcp-sim-ngspice` (ADR-0019 §4):
 *
 *   { ok: true;  data: T; warnings?: string[] }
 *   { ok: false; errors: { path: string; message: string }[] }
 */
import { checkSchematic, type Violation } from "@openbench/erc";
import {
  validateSchematic,
  validateSimulationRun,
  type Component,
  type ComponentParameter,
  type Netlist,
  type Project,
  type Schematic,
  type SimulationRun,
  type ValidationError,
} from "@openbench/ir-schema";
import { compileNetlist } from "@openbench/netlist-compiler";
import { decodeSamples, MockBackend, runSimulation } from "@openbench/mcp-sim-ngspice";
import { getComponent, registryComponents } from "@openbench/registry";
import {
  connectPins,
  createProject,
  deleteSelection,
  placeInstance,
  setParameterOverride,
  type Point,
} from "@openbench/schematic-ops";

// ── Result contract ────────────────────────────────────────────────────────

export type ToolError = ValidationError;

export type ToolResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; errors: ToolError[] };

const ok = <T>(data: T, warnings?: string[]): ToolResult<T> =>
  warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data };

const fail = (errors: ToolError[]): ToolResult<never> => ({ ok: false, errors });

const failOne = (path: string, message: string): ToolResult<never> => fail([{ path, message }]);

/**
 * Wrap a handler body so an unexpected throw becomes a structured error — the
 * never-throw contract every adapter honours. Deliberate `fail(...)` returns
 * pass straight through.
 */
function guard<T>(run: () => ToolResult<T>): ToolResult<T> {
  try {
    return run();
  } catch (error) {
    return failOne("", error instanceof Error ? error.message : String(error));
  }
}

async function guardAsync<T>(run: () => Promise<ToolResult<T>>): Promise<ToolResult<T>> {
  try {
    return await run();
  } catch (error) {
    return failOne("", error instanceof Error ? error.message : String(error));
  }
}

/** IR-validate an incoming schematic; on failure short-circuit to `{ok:false}`. */
function requireSchematic(
  schematic: unknown,
): { ok: true; schematic: Schematic } | { ok: false; errors: ToolError[] } {
  const result = validateSchematic(schematic);
  if (!result.valid) return { ok: false, errors: result.errors };
  return { ok: true, schematic: schematic as Schematic };
}

const registryIds = (): string => registryComponents.map((c) => c.id).join(", ");

// ── Authoring ──────────────────────────────────────────────────────────────

export interface RegistryEntry {
  id: string;
  name: string;
  category: string;
  pins: { id: string; name: string }[];
  parameters: ComponentParameter[];
}

/** `create_project` — mint a fresh, valid ProjectBundle (empty schematic). */
export function createProjectTool(args: {
  name: string;
}): ToolResult<{ project: Project; schematic: Schematic }> {
  return guard(() => {
    const name = args.name;
    if (typeof name !== "string" || name.trim() === "") {
      return failOne("name", "project name must be a non-empty string");
    }
    const { project, schematic } = createProject(name);
    return ok({ project, schematic });
  });
}

/** `list_registry` — the parts an agent can place; optional case-insensitive filter. */
export function listRegistryTool(args: {
  query?: string;
}): ToolResult<{ components: RegistryEntry[] }> {
  return guard(() => {
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const entries: RegistryEntry[] = registryComponents
      .filter(
        (c) =>
          query === "" ||
          `${c.id} ${c.name} ${c.category}`.toLowerCase().includes(query),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        pins: c.pins.map((p) => ({ id: p.id, name: p.name })),
        parameters: c.parameters,
      }));
    return ok({ components: entries });
  });
}

/** `add_instance` — place a registry component (auto grid slot) + apply params. */
export function addInstanceTool(args: {
  schematic: unknown;
  componentId: string;
  position?: Point;
  params?: Record<string, number | string | boolean>;
}): ToolResult<{ schematic: Schematic; instanceId: string }> {
  return guard(() => {
    const gate = requireSchematic(args.schematic);
    if (!gate.ok) return fail(gate.errors);

    const component: Component | undefined = getComponent(args.componentId);
    if (component === undefined) {
      return failOne(
        "componentId",
        `unknown componentId "${args.componentId}" — valid registry ids: ${registryIds()}`,
      );
    }

    // Auto-place on a fresh grid slot when the agent doesn't care about layout.
    const position: Point = args.position ?? { x: gate.schematic.instances.length * 40, y: 0 };
    let { schematic, instanceId } = placeInstance(gate.schematic, component, position);

    for (const [name, value] of Object.entries(args.params ?? {})) {
      schematic = setParameterOverride(schematic, instanceId, name, value);
    }
    return ok({ schematic, instanceId });
  });
}

/** `connect` — fold N pin refs onto one net; returns the surviving netId. */
export function connectTool(args: {
  schematic: unknown;
  pinRefs: { instanceId: string; pinId: string }[];
}): ToolResult<{ schematic: Schematic; netId: string }> {
  return guard(() => {
    const gate = requireSchematic(args.schematic);
    if (!gate.ok) return fail(gate.errors);

    const pinRefs = args.pinRefs;
    if (!Array.isArray(pinRefs) || pinRefs.length < 2) {
      return failOne("pinRefs", "connect requires at least two pin refs");
    }

    // Validate every ref against the schematic + registry so the agent gets a
    // clear "no such instance / pin" error instead of a later compile failure.
    const errors: ToolError[] = [];
    pinRefs.forEach((ref, index) => {
      const instance = gate.schematic.instances.find((i) => i.instanceId === ref.instanceId);
      if (instance === undefined) {
        errors.push({
          path: `pinRefs.${index}.instanceId`,
          message: `no instance "${ref.instanceId}" in schematic`,
        });
        return;
      }
      const component = getComponent(instance.componentId);
      if (component && !component.pins.some((p) => p.id === ref.pinId)) {
        errors.push({
          path: `pinRefs.${index}.pinId`,
          message: `component "${instance.componentId}" has no pin "${ref.pinId}" — pins: ${component.pins
            .map((p) => p.id)
            .join(", ")}`,
        });
      }
    });
    if (errors.length > 0) return fail(errors);

    // Fold connectPins pairwise: join every subsequent ref onto the first's net.
    const [head, ...rest] = pinRefs;
    let schematic = gate.schematic;
    for (const ref of rest) {
      schematic = connectPins(schematic, head!, ref);
    }
    const net = schematic.nets.find((n) =>
      n.connections.some((c) => c.instanceId === head!.instanceId && c.pinId === head!.pinId),
    );
    if (net === undefined) {
      return failOne("pinRefs", "connect produced no net (all refs were identical)");
    }
    return ok({ schematic, netId: net.netId });
  });
}

/** `set_param` — set (or, with a nullish value, unset) one parameter override. */
export function setParamTool(args: {
  schematic: unknown;
  instanceId: string;
  name: string;
  value: number | string | boolean;
}): ToolResult<{ schematic: Schematic }> {
  return guard(() => {
    const gate = requireSchematic(args.schematic);
    if (!gate.ok) return fail(gate.errors);
    if (!gate.schematic.instances.some((i) => i.instanceId === args.instanceId)) {
      return failOne("instanceId", `no instance "${args.instanceId}" in schematic`);
    }
    const schematic = setParameterOverride(gate.schematic, args.instanceId, args.name, args.value);
    return ok({ schematic });
  });
}

/** `remove_instances` — delete instances plus their net connections. */
export function removeInstancesTool(args: {
  schematic: unknown;
  instanceIds: string[];
}): ToolResult<{ schematic: Schematic }> {
  return guard(() => {
    const gate = requireSchematic(args.schematic);
    if (!gate.ok) return fail(gate.errors);
    if (!Array.isArray(args.instanceIds)) {
      return failOne("instanceIds", "instanceIds must be an array of instance ids");
    }
    const schematic = deleteSelection(gate.schematic, args.instanceIds);
    return ok({ schematic });
  });
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** `validate_schematic` — cheap pre-flight: IR structural validation fused with ERC. */
export function validateSchematicTool(args: { schematic: unknown }): ToolResult<{
  valid: boolean;
  irErrors: ValidationError[];
  ercViolations: Violation[];
}> {
  return guard<{ valid: boolean; irErrors: ValidationError[]; ercViolations: Violation[] }>(() => {
    const ir = validateSchematic(args.schematic);
    if (!ir.valid) {
      return ok({ valid: false, irErrors: ir.errors, ercViolations: [] });
    }
    const erc = checkSchematic(args.schematic as Schematic, getComponent);
    const hasErcError = erc.violations.some((v) => v.severity === "error");
    return ok({ valid: !hasErcError, irErrors: [], ercViolations: erc.violations });
  });
}

/** `compile_netlist` — schematic IR → engine-agnostic netlist IR. */
export function compileNetlistTool(args: {
  schematic: unknown;
}): ToolResult<{ netlist: Netlist }> {
  return guard(() => {
    const gate = requireSchematic(args.schematic);
    if (!gate.ok) return fail(gate.errors);
    const result = compileNetlist(gate.schematic, getComponent);
    if (!result.ok) return fail(result.errors);
    return ok({ netlist: result.netlist }, result.warnings);
  });
}

/**
 * `run_simulation` — run a transient on the deterministic MockBackend (Phase-1).
 * Accepts a schematic (compiled inside) or a pre-compiled netlist. A backend
 * failure surfaces as a `status:"failed"` simulationRun document, never a throw.
 */
export function runSimulationTool(args: {
  schematic?: unknown;
  netlist?: unknown;
  mode: "transient";
  config: { duration: string; step: string; probes?: string[] };
}): Promise<ToolResult<{ simulationRun: SimulationRun }>> {
  return guardAsync(async () => {
    if (args.mode !== "transient") {
      return failOne("mode", `unsupported mode "${args.mode}" — only "transient" is available`);
    }
    const config = args.config;
    if (!config || typeof config.duration !== "string" || typeof config.step !== "string") {
      return failOne("config", "config requires string `duration` and `step` SPICE time values");
    }

    // Resolve a netlist: compile a schematic, or take one directly.
    let netlist: Netlist;
    const warnings: string[] = [];
    if (args.netlist !== undefined) {
      netlist = args.netlist as Netlist;
    } else if (args.schematic !== undefined) {
      const gate = requireSchematic(args.schematic);
      if (!gate.ok) return fail(gate.errors);
      const compiled = compileNetlist(gate.schematic, getComponent);
      if (!compiled.ok) return fail(compiled.errors);
      netlist = compiled.netlist;
      warnings.push(...compiled.warnings);
    } else {
      return failOne("schematic", "run_simulation needs a `schematic` or a `netlist`");
    }

    const run = await runSimulation(
      netlist,
      {
        mode: "transient",
        duration: config.duration,
        step: config.step,
        ...(config.probes !== undefined ? { probes: config.probes } : {}),
      },
      new MockBackend(),
    );
    return ok({ simulationRun: run }, warnings);
  });
}

// ── Inspection ───────────────────────────────────────────────────────────────

export interface DecodedSignal {
  netId: string;
  unit: string;
  t: number[];
  v: number[];
}

/**
 * `read_waveform` — decode a simulationRun's inline base64 samples into plain
 * `t`/`v` arrays an agent can reason over. The independent axis (time /
 * frequency / swept source) is the last signal; every other signal is paired
 * with it. `signal` filters to one net.
 */
export function readWaveformTool(args: {
  simulationRun: unknown;
  signal?: string;
}): ToolResult<{ signals: DecodedSignal[] }> {
  return guard(() => {
    const validation = validateSimulationRun(args.simulationRun);
    if (!validation.valid) return fail(validation.errors);

    const run = args.simulationRun as SimulationRun;
    if (run.status !== "completed" || run.results === undefined) {
      return failOne("simulationRun", `simulation has no results (status: ${run.status})`);
    }

    const all = run.results.signals;
    if (all.length < 2) {
      return failOne("simulationRun", "simulationRun has no waveform axis to read against");
    }
    const axis = all[all.length - 1]!;
    const valueSignals = all.slice(0, -1);

    const selected =
      args.signal !== undefined
        ? valueSignals.filter((s) => s.netId === args.signal)
        : valueSignals;
    if (args.signal !== undefined && selected.length === 0) {
      return failOne(
        "signal",
        `no signal for net "${args.signal}" — available: ${valueSignals
          .map((s) => s.netId)
          .join(", ")}`,
      );
    }

    const t = Array.from(decodeSamples(axis.samples));
    const signals: DecodedSignal[] = selected.map((s) => ({
      netId: s.netId,
      unit: s.unit,
      t,
      v: Array.from(decodeSamples(s.samples)),
    }));
    return ok({ signals });
  });
}
