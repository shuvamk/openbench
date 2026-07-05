import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateFirmwareTarget, type FirmwareTarget } from "@openbench/ir-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCli, distEntry } from "../build.mjs";
import { buildServer, handlers } from "../src/server";

const pkgDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * MCP stdio server wrapper for the PlatformIO adapter (issue #20).
 * buildServer() registers generate_ini / build_firmware /
 * generate_machine_config; the tool callbacks are exported as `handlers` so
 * delegation is testable without a transport. build_firmware uses the
 * deterministic MockBackend by default and PioCliBackend when
 * { backend: "pio" } is passed. Every tool returns content
 * [{ type: "text", text: <JSON> }]; adapter failures are structured error
 * JSON or a buildStatus:"failed" document — never a throw.
 */

const baseTarget: FirmwareTarget = {
  irVersion: "0.1.0",
  kind: "firmwareTarget",
  id: "fw_server_test",
  projectId: "proj_server_test",
  mcu: "esp32dev",
  framework: "arduino",
  sourceRef: "git+https://github.com/openbench/blink#src",
  buildStatus: "pending",
  flashTarget: { kind: "virtual", engine: "qemu" },
  provenance: { source: "frontend", at: "2026-07-02T00:00:00Z" },
};

const target = baseTarget as unknown as Record<string, unknown>;

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

describe("mcp-firmware-platformio buildServer", () => {
  it("returns an McpServer", () => {
    expect(buildServer()).toBeInstanceOf(McpServer);
  });

  it("registers exactly the adapter contract tools", () => {
    expect(registeredToolNames(buildServer())).toEqual([
      "build_firmware",
      "generate_ini",
      "generate_machine_config",
    ]);
  });
});

describe("mcp-firmware-platformio handlers (delegation)", () => {
  it("generate_ini delegates to generatePlatformioIni", async () => {
    const payload = parsePayload(
      await handlers.generate_ini({ mcu: "esp32dev", framework: "arduino" }),
    );
    expect(payload.ok).toBe(true);
    expect(payload.ini).toContain("platform = espressif32");
    expect(payload.ini).toContain("framework = arduino");
  });

  it("generate_ini returns structured errors for an out-of-scope MCU (never throws)", async () => {
    const payload = parsePayload(
      await handlers.generate_ini({ mcu: "atmega328p", framework: "arduino" }),
    );
    expect(payload.ok).toBe(false);
    const errors = payload.errors as Array<{ path: string; message: string }>;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toHaveProperty("path");
    expect(errors[0]).toHaveProperty("message");
  });

  it("generate_ini returns structured errors for an unknown framework (never throws)", async () => {
    const payload = parsePayload(
      await handlers.generate_ini({ mcu: "esp32dev", framework: "rtos-max" }),
    );
    expect(payload.ok).toBe(false);
  });

  it("build_firmware defaults to the MockBackend and returns the updated document", async () => {
    const payload = parsePayload(await handlers.build_firmware({ target }));
    const updated = payload as unknown as FirmwareTarget;
    expect(updated.buildStatus).toBe("success");
    expect(updated.artifact).toEqual({
      binary: "/virtual/out/firmware.bin",
      elf: "/virtual/out/firmware.elf",
    });
    expect(updated.provenance.source).toBe("mcp-firmware-platformio");
    expect(validateFirmwareTarget(updated).valid).toBe(true);
  });

  it('build_firmware with { backend: "pio" } uses the PioCliBackend seam', async () => {
    const payload = parsePayload(await handlers.build_firmware({ target, backend: "pio" }));
    const updated = payload as unknown as FirmwareTarget;
    // Environment-agnostic: with pio installed this is a real build; without
    // it the backend resolves a structured engine-unavailable failure. Either
    // way the result is a valid, provenance-stamped firmwareTarget document.
    expect(["success", "failed"]).toContain(updated.buildStatus);
    expect(updated.provenance.source).toBe("mcp-firmware-platformio");
    expect(validateFirmwareTarget(updated).valid).toBe(true);
  });

  it("build_firmware returns structured errors for an invalid target (never throws)", async () => {
    const payload = parsePayload(await handlers.build_firmware({ target: {} }));
    expect(payload.ok).toBe(false);
    expect(Array.isArray(payload.errors)).toBe(true);
  });

  it("generate_machine_config delegates to generateVirtualMachineConfig", async () => {
    const payload = parsePayload(await handlers.generate_machine_config({ target }));
    expect(payload.ok).toBe(true);
    const machineConfig = payload.machineConfig as { engine: string; config: string };
    expect(machineConfig.engine).toBe("qemu");
    expect(machineConfig.config).toContain("qemu-system-xtensa");
  });

  it("generate_machine_config returns structured errors for a target without an mcu", async () => {
    const payload = parsePayload(await handlers.generate_machine_config({ target: {} }));
    expect(payload.ok).toBe(false);
    const errors = payload.errors as Array<{ path: string; message: string }>;
    expect(errors[0]!.path).toBe("target.mcu");
  });
});

describe("mcp-firmware-platformio publishable stdio bin (issue #31)", () => {
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

  it("starts over stdio and lists the PlatformIO adapter tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "build_firmware",
      "generate_ini",
      "generate_machine_config",
    ]);
  });
});
