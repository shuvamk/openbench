/**
 * MCP stdio server wrapper for the ngspice adapter (issue #20).
 *
 * Exposes build_deck / run_simulation / validate as MCP tools. Server-side
 * simulation uses the deterministic MockBackend (ADR-0006: the real WASM
 * ngspice backend, eecircuit-engine, runs in-browser only — it is never
 * loaded in this node process). Malformed arguments are rejected by the
 * SDK's zod input validation; adapter-level failures come back as structured
 * error JSON in the shared `{ path, message }` shape, or as a
 * status:"failed" simulationRun document — a tool call never throws. Every
 * tool returns content [{ type: "text", text: <JSON> }].
 *
 * The tool callbacks are exported as `handlers` so tests can spot-check
 * delegation without a transport; buildServer() registers exactly these.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { validateNetlist, type Netlist } from "@openbench/ir-schema";
import { z } from "zod";
import { MockBackend } from "./backend";
import { buildSpiceDeck, NgspiceAdapterError } from "./deck";
import { runSimulation } from "./index";

const SERVER_NAME = "openbench-mcp-sim-ngspice";
const SERVER_VERSION = "0.1.0";

const jsonResult = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

const structuredFailure = (error: unknown): CallToolResult =>
  jsonResult({
    ok: false,
    errors:
      error instanceof NgspiceAdapterError
        ? error.errors
        : [{ path: "", message: error instanceof Error ? error.message : String(error) }],
  });

export const handlers = {
  build_deck: async ({
    netlist,
    duration,
    step,
  }: {
    netlist: Record<string, unknown>;
    duration: string;
    step: string;
  }): Promise<CallToolResult> => {
    const validation = validateNetlist(netlist);
    if (!validation.valid) return jsonResult({ ok: false, errors: validation.errors });
    try {
      const deck = buildSpiceDeck(netlist as unknown as Netlist, { duration, step });
      return jsonResult({ ok: true, deck });
    } catch (error) {
      // buildSpiceDeck throws NgspiceAdapterError; the tool contract never does.
      return structuredFailure(error);
    }
  },

  run_simulation: async ({
    netlist,
    duration,
    step,
    probes,
  }: {
    netlist: Record<string, unknown>;
    duration: string;
    step: string;
    probes?: string[];
  }): Promise<CallToolResult> => {
    const validation = validateNetlist(netlist);
    if (!validation.valid) return jsonResult({ ok: false, errors: validation.errors });
    // runSimulation never throws: bad configs/probes yield status:"failed".
    const run = await runSimulation(
      netlist as unknown as Netlist,
      { mode: "transient", duration, step, ...(probes !== undefined ? { probes } : {}) },
      new MockBackend(),
    );
    return jsonResult(run);
  },

  validate: async ({ document }: { document: Record<string, unknown> }): Promise<CallToolResult> =>
    jsonResult(validateNetlist(document)),
};

/** Build the ngspice MCP server (stdio transport is attached by the bin entry). */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "build_deck",
    {
      description:
        "Build an ngspice transient SPICE deck from a netlist IR document. " +
        "Returns { ok: true, deck } or { ok: false, errors: [{ path, message }] }.",
      inputSchema: {
        netlist: z.record(z.unknown()).describe("A netlist IR document (kind: netlist)"),
        duration: z.string().describe('Total simulated time as a SPICE time value, e.g. "10ms"'),
        step: z.string().describe('Output step as a SPICE time value, e.g. "1us"'),
      },
    },
    handlers.build_deck,
  );

  server.registerTool(
    "run_simulation",
    {
      description:
        "Run a transient simulation of a netlist IR document and return a simulationRun IR " +
        "document (failures surface as status \"failed\", never a throw). Server-side this " +
        "uses the deterministic mock backend — the real WASM ngspice backend " +
        "(eecircuit-engine) runs in-browser only.",
      inputSchema: {
        netlist: z.record(z.unknown()).describe("A netlist IR document (kind: netlist)"),
        duration: z.string().describe('Total simulated time as a SPICE time value, e.g. "10ms"'),
        step: z.string().describe('Output step as a SPICE time value, e.g. "1us"'),
        probes: z
          .array(z.string())
          .optional()
          .describe("netIds to probe; defaults to every non-ground net"),
      },
    },
    handlers.run_simulation,
  );

  server.registerTool(
    "validate",
    {
      description:
        "Validate a document against the canonical netlist IR schema. " +
        "Returns { valid, errors: [{ path, message }] }.",
      inputSchema: {
        document: z.record(z.unknown()).describe("Candidate netlist IR document"),
      },
    },
    handlers.validate,
  );

  return server;
}
