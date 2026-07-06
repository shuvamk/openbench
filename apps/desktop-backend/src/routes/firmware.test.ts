import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MockBackend } from "@openbench/mcp-firmware-platformio";
import type { FirmwareTarget } from "@openbench/ir-schema";
import { createServer } from "../server";

/**
 * Acceptance test for issue #119 — the desktop backend's firmware build route.
 * `POST /firmware/build` takes a firmwareTarget IR body, runs the injected
 * firmware backend, and returns the FirmwareBuildResult. Tested with the
 * deterministic MockBackend — no real `pio`/`qemu` in CI.
 */

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

const AT = "2026-07-06T00:00:00Z";
const validTarget = (): FirmwareTarget => ({
  irVersion: "0.1.0",
  kind: "firmwareTarget",
  id: "fw_demo",
  projectId: "proj_demo",
  mcu: "esp32",
  framework: "arduino",
  sourceRef: "/virtual/src",
  buildStatus: "pending",
  flashTarget: { kind: "virtual", engine: "qemu" },
  provenance: { source: "test", at: AT },
});

describe("POST /firmware/build", () => {
  let server: Server | undefined;
  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      }),
  );

  it("builds a firmwareTarget through the injected backend and returns a FirmwareBuildResult", async () => {
    server = createServer({ firmwareBackend: new MockBackend() });
    const port = await listen(server);
    const { status, body } = await postJson(port, "/firmware/build", {
      firmwareTarget: validTarget(),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      binaryPath: expect.any(String),
      elfPath: expect.any(String),
      log: expect.any(String),
    });
  });

  it("returns a structured 400 (not a crash) for a malformed firmwareTarget body", async () => {
    server = createServer({ firmwareBackend: new MockBackend() });
    const port = await listen(server);
    const { status, body } = await postJson(port, "/firmware/build", { firmwareTarget: { nope: 1 } });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("surfaces a backend build failure as ok:false with the log", async () => {
    server = createServer({ firmwareBackend: new MockBackend({ fail: "compile error" }) });
    const port = await listen(server);
    const { status, body } = await postJson(port, "/firmware/build", {
      firmwareTarget: validTarget(),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.log).toContain("compile error");
  });
});
