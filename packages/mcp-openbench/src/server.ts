/**
 * MCP stdio server for the agent-control surface (issue #42 / ADR-0019).
 *
 * buildServer() registers the ten author→derive→inspect tools; each tool
 * callback is a thin wrapper that delegates to the transport-agnostic handler
 * in ./tools and JSON-encodes the never-throw `ToolResult` into the MCP
 * content envelope [{ type: "text", text: <JSON> }]. The callbacks are exported
 * as `handlers` so tests can spot-check delegation without a transport, mirroring
 * the existing engine adapters (mcp-kicad / mcp-sim-ngspice).
 *
 * The server is stateless (ADR-0019 §2): every tool takes the current IR
 * document(s) in its arguments and returns the mutated document plus any
 * derived result. It holds no session and no project map.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  addInstanceTool,
  compileNetlistTool,
  connectTool,
  createProjectTool,
  listRegistryTool,
  readWaveformTool,
  removeInstancesTool,
  runSimulationTool,
  setParamTool,
  validateSchematicTool,
} from "./tools";

const SERVER_NAME = "openbench-mcp-openbench";
const SERVER_VERSION = "0.1.0";

const jsonResult = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

const doc = (kind: string) => z.record(z.unknown()).describe(`A ${kind} IR document`);
const paramValue = z.union([z.number(), z.string(), z.boolean()]);
const pinRef = z.object({
  instanceId: z.string().describe("The instance the pin belongs to, e.g. R1"),
  pinId: z.string().describe("The component pin id, e.g. p1 / pos / gnd"),
});

export const handlers = {
  create_project: async ({ name }: { name: string }): Promise<CallToolResult> =>
    jsonResult(createProjectTool({ name })),

  list_registry: async ({ query }: { query?: string }): Promise<CallToolResult> =>
    jsonResult(listRegistryTool(query !== undefined ? { query } : {})),

  add_instance: async (args: {
    schematic: Record<string, unknown>;
    componentId: string;
    position?: { x: number; y: number };
    params?: Record<string, number | string | boolean>;
  }): Promise<CallToolResult> => jsonResult(addInstanceTool(args)),

  connect: async (args: {
    schematic: Record<string, unknown>;
    pinRefs: { instanceId: string; pinId: string }[];
  }): Promise<CallToolResult> => jsonResult(connectTool(args)),

  set_param: async (args: {
    schematic: Record<string, unknown>;
    instanceId: string;
    name: string;
    value: number | string | boolean;
  }): Promise<CallToolResult> => jsonResult(setParamTool(args)),

  remove_instances: async (args: {
    schematic: Record<string, unknown>;
    instanceIds: string[];
  }): Promise<CallToolResult> => jsonResult(removeInstancesTool(args)),

  validate_schematic: async (args: {
    schematic: Record<string, unknown>;
  }): Promise<CallToolResult> => jsonResult(validateSchematicTool(args)),

  compile_netlist: async (args: {
    schematic: Record<string, unknown>;
  }): Promise<CallToolResult> => jsonResult(compileNetlistTool(args)),

  run_simulation: async (args: {
    schematic?: Record<string, unknown>;
    netlist?: Record<string, unknown>;
    mode: "transient";
    config: { duration: string; step: string; probes?: string[] };
  }): Promise<CallToolResult> => jsonResult(await runSimulationTool(args)),

  read_waveform: async (args: {
    simulationRun: Record<string, unknown>;
    signal?: string;
  }): Promise<CallToolResult> => jsonResult(readWaveformTool(args)),
};

/** Build the agent-control MCP server (stdio transport attached by the bin entry). */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "create_project",
    {
      description:
        "Start a new project: returns { ok, data: { project, schematic } } — an empty, valid " +
        "ProjectBundle to author into. Thread data.schematic into subsequent tools.",
      inputSchema: { name: z.string().describe("Human-readable project name") },
    },
    handlers.create_project,
  );

  server.registerTool(
    "list_registry",
    {
      description:
        "List the registry components an agent can place, each with its pins (id + name) and " +
        "parameters. Optional case-insensitive `query` filters over id/name/category.",
      inputSchema: {
        query: z.string().optional().describe('Filter, e.g. "resistor" or "source"'),
      },
    },
    handlers.list_registry,
  );

  server.registerTool(
    "add_instance",
    {
      description:
        "Place a registry component into the schematic (auto grid slot if `position` omitted) " +
        "and apply optional `params`. Returns { ok, data: { schematic, instanceId } }. Unknown " +
        "componentId → structured error listing valid ids.",
      inputSchema: {
        schematic: doc("schematic"),
        componentId: z.string().describe("A registry component id, e.g. cmp_resistor_generic"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Canvas position; omit to auto-place"),
        params: z.record(paramValue).optional().describe("Parameter overrides by name"),
      },
    },
    handlers.add_instance,
  );

  server.registerTool(
    "connect",
    {
      description:
        "Wire a set of pins onto one net (folded pairwise). Returns { ok, data: { schematic, " +
        "netId } }. Flags refs to unknown instances or pins with a structured error.",
      inputSchema: {
        schematic: doc("schematic"),
        pinRefs: z.array(pinRef).describe("Two or more pins to join onto a single net"),
      },
    },
    handlers.connect,
  );

  server.registerTool(
    "set_param",
    {
      description:
        "Set one parameter override on an instance. Returns { ok, data: { schematic } }.",
      inputSchema: {
        schematic: doc("schematic"),
        instanceId: z.string(),
        name: z.string().describe("Parameter name, e.g. resistance"),
        value: paramValue,
      },
    },
    handlers.set_param,
  );

  server.registerTool(
    "remove_instances",
    {
      description:
        "Delete instances plus their net connections. Returns { ok, data: { schematic } }.",
      inputSchema: {
        schematic: doc("schematic"),
        instanceIds: z.array(z.string()),
      },
    },
    handlers.remove_instances,
  );

  server.registerTool(
    "validate_schematic",
    {
      description:
        "Pre-flight a schematic: fuses IR structural validation with ERC. Returns " +
        "{ ok, data: { valid, irErrors, ercViolations } } — the agent's cheap 'why won't this " +
        "work?' before spending a sim run.",
      inputSchema: { schematic: doc("schematic") },
    },
    handlers.validate_schematic,
  );

  server.registerTool(
    "compile_netlist",
    {
      description:
        "Compile a schematic IR into an engine-agnostic netlist IR. Returns " +
        "{ ok, data: { netlist }, warnings? } or { ok:false, errors }.",
      inputSchema: { schematic: doc("schematic") },
    },
    handlers.compile_netlist,
  );

  server.registerTool(
    "run_simulation",
    {
      description:
        "Run a transient simulation and return { ok, data: { simulationRun } }. Give a " +
        "`schematic` (compiled inside) or a pre-compiled `netlist`. Server-side this uses the " +
        "deterministic mock backend; a backend failure surfaces as status \"failed\", never a throw.",
      inputSchema: {
        schematic: doc("schematic").optional(),
        netlist: doc("netlist").optional(),
        mode: z.literal("transient").describe('Only "transient" is supported today'),
        config: z
          .object({
            duration: z.string().describe('Total simulated time, e.g. "20ms"'),
            step: z.string().describe('Output step, e.g. "10us"'),
            probes: z.array(z.string()).optional().describe("netIds to probe"),
          })
          .describe("Transient run configuration"),
      },
    },
    handlers.run_simulation,
  );

  server.registerTool(
    "read_waveform",
    {
      description:
        "Decode a simulationRun's inline samples into plain t/v arrays. Returns " +
        "{ ok, data: { signals: [{ netId, unit, t, v }] } }. `signal` filters to one net.",
      inputSchema: {
        simulationRun: doc("simulationRun"),
        signal: z.string().optional().describe("netId to read; omit for all probed nets"),
      },
    },
    handlers.read_waveform,
  );

  return server;
}
