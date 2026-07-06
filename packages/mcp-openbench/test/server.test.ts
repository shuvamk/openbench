import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCli, distEntry } from "../build.mjs";
import { buildServer, handlers } from "../src/server";

const pkgDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * MCP stdio server wrapper for the agent-control surface (issue #42).
 * buildServer() registers the ten author→derive→inspect tools; the callbacks
 * are exported as `handlers` so delegation is testable without a transport.
 * Every tool returns content [{ type: "text", text: <JSON> }]; failures come
 * back as structured error JSON — a tool call never throws.
 */

const TOOL_NAMES = [
  "add_instance",
  "compile_netlist",
  "connect",
  "create_project",
  "list_registry",
  "read_waveform",
  "remove_instances",
  "run_simulation",
  "set_param",
  "validate_schematic",
];

/** Tool names registered on an McpServer (SDK keeps them in _registeredTools). */
const registeredToolNames = (server: McpServer): string[] =>
  Object.keys(
    (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
  ).sort();

interface ContentItem {
  type: string;
  text?: string;
}

/** Assert the [{ type: "text", text }] envelope and parse the JSON payload. */
const parsePayload = (result: { content: ContentItem[] }): Record<string, unknown> => {
  expect(result.content).toHaveLength(1);
  const item = result.content[0]!;
  expect(item.type).toBe("text");
  return JSON.parse(item.text!) as Record<string, unknown>;
};

describe("mcp-openbench buildServer", () => {
  it("returns an McpServer", () => {
    expect(buildServer()).toBeInstanceOf(McpServer);
  });

  it("registers exactly the ten agent-control tools", () => {
    expect(registeredToolNames(buildServer())).toEqual(TOOL_NAMES);
  });
});

describe("mcp-openbench handlers (delegation + envelope)", () => {
  it("create_project returns the JSON envelope with a valid bundle", async () => {
    const payload = parsePayload(await handlers.create_project({ name: "demo" }));
    expect(payload.ok).toBe(true);
    expect((payload.data as { project: { name: string } }).project.name).toBe("demo");
  });

  it("list_registry returns components", async () => {
    const payload = parsePayload(await handlers.list_registry({}));
    expect(payload.ok).toBe(true);
    expect((payload.data as { components: unknown[] }).components.length).toBeGreaterThan(0);
  });

  it("add_instance with an unknown componentId returns a structured error (never throws)", async () => {
    const created = parsePayload(await handlers.create_project({ name: "demo" }));
    const schematic = (created.data as { schematic: Record<string, unknown> }).schematic;
    const payload = parsePayload(
      await handlers.add_instance({ schematic, componentId: "cmp_nope" }),
    );
    expect(payload.ok).toBe(false);
    const errors = payload.errors as Array<{ path: string; message: string }>;
    expect(errors[0]).toHaveProperty("path");
    expect(errors[0]).toHaveProperty("message");
  });
});

describe("mcp-openbench publishable stdio bin", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // `npm run build` (node build.mjs) bundles src/server-cli.ts → dist/server-cli.js.
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

  it("starts over stdio and lists the ten agent-control tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
  });
});
