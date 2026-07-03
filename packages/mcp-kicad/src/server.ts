/**
 * MCP stdio server wrapper for the KiCad adapter (issue #20).
 *
 * Exposes the adapter contract (.context/interchange-format.md §adapter
 * contract) as MCP tools: import_schematic / export_schematic / validate.
 * Malformed arguments are rejected by the SDK's zod input validation;
 * adapter-level failures come back as structured error JSON in the shared
 * `{ path, message }` shape — a tool call never throws. Every tool returns
 * content [{ type: "text", text: <JSON> }].
 *
 * The tool callbacks are exported as `handlers` so tests can spot-check
 * delegation without a transport; buildServer() registers exactly these.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Schematic } from "@openbench/ir-schema";
import { z } from "zod";
import { exportSchematic, importSchematic, validate } from "./index";

const SERVER_NAME = "openbench-mcp-kicad";
const SERVER_VERSION = "0.1.0";

const jsonResult = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

const structuredFailure = (error: unknown): CallToolResult =>
  jsonResult({
    ok: false,
    errors: [{ path: "", message: error instanceof Error ? error.message : String(error) }],
  });

export const handlers = {
  import_schematic: async ({ kicadSch }: { kicadSch: string }): Promise<CallToolResult> =>
    // importSchematic never throws: failures are { ok: false, errors }.
    jsonResult(importSchematic(kicadSch)),

  export_schematic: async ({
    schematic,
  }: {
    schematic: Record<string, unknown>;
  }): Promise<CallToolResult> => {
    const validation = validate(schematic);
    if (!validation.valid) return jsonResult({ ok: false, errors: validation.errors });
    try {
      return jsonResult({ ok: true, kicadSch: exportSchematic(schematic as unknown as Schematic) });
    } catch (error) {
      // exportSchematic throws on invalid IR; the tool contract never does.
      return structuredFailure(error);
    }
  },

  validate: async ({ document }: { document: Record<string, unknown> }): Promise<CallToolResult> =>
    jsonResult(validate(document)),
};

/** Build the KiCad MCP server (stdio transport is attached by the bin entry). */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "import_schematic",
    {
      description:
        "Parse a KiCad .kicad_sch file (flat single sheet) into a schematic IR document. " +
        "Returns { ok: true, schematic, warnings } or { ok: false, errors: [{ path, message }] }.",
      inputSchema: { kicadSch: z.string().describe("Raw .kicad_sch file contents") },
    },
    handlers.import_schematic,
  );

  server.registerTool(
    "export_schematic",
    {
      description:
        "Serialize a schematic IR document to a flat single-sheet .kicad_sch file. " +
        "Returns { ok: true, kicadSch } or { ok: false, errors: [{ path, message }] }.",
      inputSchema: {
        schematic: z.record(z.unknown()).describe("A schematic IR document (kind: schematic)"),
      },
    },
    handlers.export_schematic,
  );

  server.registerTool(
    "validate",
    {
      description:
        "Validate a document against the canonical schematic IR schema. " +
        "Returns { valid, errors: [{ path, message }] }.",
      inputSchema: {
        document: z.record(z.unknown()).describe("Candidate schematic IR document"),
      },
    },
    handlers.validate,
  );

  return server;
}
