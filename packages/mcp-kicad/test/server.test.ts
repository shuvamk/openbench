import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Schematic } from "@openbench/ir-schema";
import { describe, expect, it } from "vitest";
import { exportSchematic } from "../src/index";
import { buildServer, handlers } from "../src/server";

/**
 * MCP stdio server wrapper for the KiCad adapter (issue #20). buildServer()
 * registers the adapter contract tools (import/export/validate); the tool
 * callbacks are exported as `handlers` so delegation is testable without a
 * transport. Every tool returns content [{ type: "text", text: <JSON> }];
 * adapter-level failures come back as structured error JSON — never a throw.
 */

const schematic: Schematic = {
  irVersion: "0.1.0",
  kind: "schematic",
  id: "sch_server_test",
  projectId: "proj_server_test",
  instances: [{ instanceId: "R1", componentId: "cmp_resistor_generic" }],
  nets: [],
  provenance: { source: "test", at: "2026-07-02T00:00:00Z" },
};

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

describe("mcp-kicad buildServer", () => {
  it("returns an McpServer", () => {
    expect(buildServer()).toBeInstanceOf(McpServer);
  });

  it("registers exactly the adapter contract tools", () => {
    expect(registeredToolNames(buildServer())).toEqual([
      "export_schematic",
      "import_schematic",
      "validate",
    ]);
  });
});

describe("mcp-kicad handlers (delegation)", () => {
  it("import_schematic delegates to importSchematic", async () => {
    const kicadSch = exportSchematic(schematic, { now: "2026-07-02T12:00:00Z" });
    const payload = parsePayload(await handlers.import_schematic({ kicadSch }));
    expect(payload.ok).toBe(true);
    expect((payload.schematic as Schematic).id).toBe(schematic.id);
  });

  it("import_schematic returns structured errors for malformed input (never throws)", async () => {
    const payload = parsePayload(await handlers.import_schematic({ kicadSch: "(((" }));
    expect(payload.ok).toBe(false);
    expect(Array.isArray(payload.errors)).toBe(true);
  });

  it("export_schematic delegates to exportSchematic", async () => {
    const payload = parsePayload(
      await handlers.export_schematic({ schematic: schematic as unknown as Record<string, unknown> }),
    );
    expect(payload.ok).toBe(true);
    expect(payload.kicadSch).toContain("kicad_sch");
  });

  it("export_schematic returns structured errors for an invalid schematic (never throws)", async () => {
    const payload = parsePayload(await handlers.export_schematic({ schematic: {} }));
    expect(payload.ok).toBe(false);
    const errors = payload.errors as Array<{ path: string; message: string }>;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toHaveProperty("path");
    expect(errors[0]).toHaveProperty("message");
  });

  it("validate delegates to the canonical IR validator", async () => {
    const valid = parsePayload(
      await handlers.validate({ document: schematic as unknown as Record<string, unknown> }),
    );
    expect(valid).toEqual({ valid: true, errors: [] });
    const invalid = parsePayload(await handlers.validate({ document: { kind: "schematic" } }));
    expect(invalid.valid).toBe(false);
  });
});

describe("mcp-kicad server-cli.mjs", () => {
  it("exits 1 with a build-step-pending message (packaging follow-up)", () => {
    const cli = fileURLToPath(new URL("../src/server-cli.mjs", import.meta.url));
    const run = spawnSync(process.execPath, [cli], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain("build step pending");
  });
});
