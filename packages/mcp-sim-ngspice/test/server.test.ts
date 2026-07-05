import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SimulationRun } from "@openbench/ir-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCli, distEntry } from "../build.mjs";
import { buildServer, handlers } from "../src/server";
import { rcNetlist } from "./fixture";

const pkgDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * MCP stdio server wrapper for the ngspice adapter (issue #20). buildServer()
 * registers build_deck / run_simulation / validate; the tool callbacks are
 * exported as `handlers` so delegation is testable without a transport.
 * run_simulation uses the deterministic MockBackend server-side (the WASM
 * backend runs in-browser only). Every tool returns content
 * [{ type: "text", text: <JSON> }]; adapter failures are structured error
 * JSON or a status:"failed" run document — never a throw.
 */

const netlist = rcNetlist as unknown as Record<string, unknown>;

const registeredToolNames = (server: McpServer): string[] =>
  Object.keys(
    (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
  ).sort();

interface ContentItem {
  type: string;
  text?: string;
}

const parsePayload = (result: { content: ContentItem[] }): Record<string, unknown> => {
  expect(result.content).toHaveLength(1);
  const item = result.content[0]!;
  expect(item.type).toBe("text");
  return JSON.parse(item.text!) as Record<string, unknown>;
};

describe("mcp-sim-ngspice buildServer", () => {
  it("returns an McpServer", () => {
    expect(buildServer()).toBeInstanceOf(McpServer);
  });

  it("registers exactly the adapter contract tools", () => {
    expect(registeredToolNames(buildServer())).toEqual([
      "build_deck",
      "run_simulation",
      "validate",
    ]);
  });

  it("documents that the server-side backend is the mock (WASM runs in-browser)", () => {
    const tools = (
      buildServer() as unknown as {
        _registeredTools: Record<string, { description?: string }>;
      }
    )._registeredTools;
    expect(tools.run_simulation!.description).toMatch(/mock/i);
    expect(tools.run_simulation!.description).toMatch(/in-browser/i);
  });
});

describe("mcp-sim-ngspice handlers (delegation)", () => {
  it("build_deck delegates to buildSpiceDeck", async () => {
    const payload = parsePayload(
      await handlers.build_deck({ netlist, duration: "10ms", step: "1us" }),
    );
    expect(payload.ok).toBe(true);
    expect(payload.deck).toContain(".tran 1us 10ms");
  });

  it("build_deck returns structured errors for a bad config (never throws)", async () => {
    const payload = parsePayload(
      await handlers.build_deck({ netlist, duration: "not-a-time", step: "1us" }),
    );
    expect(payload.ok).toBe(false);
    const errors = payload.errors as Array<{ path: string; message: string }>;
    expect(errors.some((error) => error.path === "config.duration")).toBe(true);
  });

  it("run_simulation runs the MockBackend and returns a simulationRun document", async () => {
    const payload = parsePayload(
      await handlers.run_simulation({
        netlist,
        duration: "10ms",
        step: "1us",
        probes: ["net_vout"],
      }),
    );
    const run = payload as unknown as SimulationRun;
    expect(run.kind).toBe("simulationRun");
    expect(run.status).toBe("completed");
    expect(run.provenance.source).toBe("mcp-sim-ngspice");
    expect(run.results!.signals.map((signal) => signal.netId)).toEqual(["net_vout", "time"]);
  });

  it("run_simulation returns structured errors for an invalid netlist (never throws)", async () => {
    const payload = parsePayload(
      await handlers.run_simulation({ netlist: {}, duration: "10ms", step: "1us" }),
    );
    expect(payload.ok).toBe(false);
    expect(Array.isArray(payload.errors)).toBe(true);
  });

  it("validate delegates to the canonical IR validator", async () => {
    const valid = parsePayload(await handlers.validate({ document: netlist }));
    expect(valid).toEqual({ valid: true, errors: [] });
    const invalid = parsePayload(await handlers.validate({ document: { kind: "netlist" } }));
    expect(invalid.valid).toBe(false);
  });
});

describe("mcp-sim-ngspice publishable stdio bin (issue #31)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    await buildCli(pkgDir);
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [distEntry(pkgDir)],
    });
    client = new Client({ name: "smoke-test", version: "0.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("starts over stdio and lists the ngspice adapter-contract tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "build_deck",
      "run_simulation",
      "validate",
    ]);
  });
});
