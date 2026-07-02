/**
 * MCP stdio server wrapper for the PlatformIO adapter (issue #20).
 *
 * Exposes generate_ini / build_firmware / generate_machine_config as MCP
 * tools. build_firmware uses the deterministic MockBackend by default;
 * passing { backend: "pio" } selects the real PioCliBackend (feature-detected
 * — an absent pio CLI resolves a structured engine-unavailable failure).
 * Malformed arguments are rejected by the SDK's zod input validation;
 * adapter-level failures come back as structured error JSON in the shared
 * `{ path, message }` shape, or as a buildStatus:"failed" firmwareTarget
 * document — a tool call never throws. Every tool returns content
 * [{ type: "text", text: <JSON> }].
 *
 * The tool callbacks are exported as `handlers` so tests can spot-check
 * delegation without a transport; buildServer() registers exactly these.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { validateFirmwareTarget, type FirmwareTarget } from "@openbench/ir-schema";
import { z } from "zod";
import { MockBackend, PioCliBackend } from "./backend";
import { buildFirmware } from "./index";
import { generatePlatformioIni, type PlatformioIniTarget } from "./ini";
import { generateVirtualMachineConfig } from "./machine";

const SERVER_NAME = "openbench-mcp-firmware-platformio";
const SERVER_VERSION = "0.1.0";

const FRAMEWORKS = ["arduino", "esp-idf", "zephyr"] as const;
type Framework = PlatformioIniTarget["framework"];

const isFramework = (value: string): value is Framework =>
  (FRAMEWORKS as readonly string[]).includes(value);

const jsonResult = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

const structuredFailure = (path: string, error: unknown): CallToolResult =>
  jsonResult({
    ok: false,
    errors: [{ path, message: error instanceof Error ? error.message : String(error) }],
  });

export const handlers = {
  generate_ini: async ({
    mcu,
    framework,
  }: {
    mcu: string;
    framework: string;
  }): Promise<CallToolResult> => {
    if (!isFramework(framework)) {
      return jsonResult({
        ok: false,
        errors: [
          {
            path: "framework",
            message: `framework "${framework}" is not supported (expected one of: ${FRAMEWORKS.join(", ")})`,
          },
        ],
      });
    }
    try {
      return jsonResult({ ok: true, ini: generatePlatformioIni({ mcu, framework }) });
    } catch (error) {
      // platformForMcu throws on out-of-scope MCU families; the tool contract never does.
      return structuredFailure("mcu", error);
    }
  },

  build_firmware: async ({
    target,
    backend,
  }: {
    target: Record<string, unknown>;
    backend?: "mock" | "pio";
  }): Promise<CallToolResult> => {
    const validation = validateFirmwareTarget(target);
    if (!validation.valid) return jsonResult({ ok: false, errors: validation.errors });
    const firmwareBackend = backend === "pio" ? new PioCliBackend() : new MockBackend();
    // buildFirmware never throws: engine failures yield buildStatus:"failed".
    const updated = await buildFirmware(target as unknown as FirmwareTarget, firmwareBackend);
    return jsonResult(updated);
  },

  generate_machine_config: async ({
    target,
  }: {
    target: Record<string, unknown>;
  }): Promise<CallToolResult> => {
    const mcu = target.mcu;
    if (typeof mcu !== "string" || mcu.length === 0) {
      return jsonResult({
        ok: false,
        errors: [{ path: "target.mcu", message: "target.mcu must be a non-empty string" }],
      });
    }
    try {
      return jsonResult({ ok: true, machineConfig: generateVirtualMachineConfig({ mcu }) });
    } catch (error) {
      return structuredFailure("target.mcu", error);
    }
  },
};

/** Build the PlatformIO MCP server (stdio transport is attached by the bin entry). */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "generate_ini",
    {
      description:
        "Generate a platformio.ini from an MCU + framework (Phase 1: esp32 family only). " +
        "Returns { ok: true, ini } or { ok: false, errors: [{ path, message }] }.",
      inputSchema: {
        mcu: z.string().describe('PlatformIO board id, e.g. "esp32dev" (esp32 family only)'),
        framework: z.string().describe(`One of: ${FRAMEWORKS.join(", ")}`),
      },
    },
    handlers.generate_ini,
  );

  server.registerTool(
    "build_firmware",
    {
      description:
        "Build the firmware described by a firmwareTarget IR document and return the updated " +
        "document (buildStatus success|failed, never a throw). Uses the deterministic mock " +
        'backend by default; pass backend: "pio" for the real PlatformIO CLI (feature-detected ' +
        "— an absent pio CLI yields a structured engine-unavailable failure).",
      inputSchema: {
        target: z
          .record(z.unknown())
          .describe("A firmwareTarget IR document (kind: firmwareTarget)"),
        backend: z
          .enum(["mock", "pio"])
          .optional()
          .describe('Build backend: "mock" (default) or "pio" (real PlatformIO CLI)'),
      },
    },
    handlers.build_firmware,
  );

  server.registerTool(
    "generate_machine_config",
    {
      description:
        "Generate the QEMU virtual-machine launch config for a firmwareTarget's MCU " +
        "(qemu-xtensa-esp32, ADR-0011 Phase 1 stub). Returns { ok: true, machineConfig } or " +
        "{ ok: false, errors: [{ path, message }] }.",
      inputSchema: {
        target: z
          .record(z.unknown())
          .describe("A firmwareTarget IR document (or any object with an mcu string)"),
      },
    },
    handlers.generate_machine_config,
  );

  return server;
}
