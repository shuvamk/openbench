import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "./server";

// Listen on an OS-assigned ephemeral port; resolve with the assigned port.
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

async function getJson(
  port: number,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

describe("createServer", () => {
  let server: Server | undefined;

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      }),
  );

  it("listens on an OS-assigned ephemeral port > 0", async () => {
    server = createServer();
    const port = await listen(server);
    expect(port).toBeGreaterThan(0);
  });

  it("GET /health returns 200 with JSON body { status: 'ok' }", async () => {
    server = createServer();
    const port = await listen(server);
    const { status, body } = await getJson(port, "/health");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /unknown-route returns 404 with a structured { error } body, not a raw stack trace", async () => {
    server = createServer();
    const port = await listen(server);
    const { status, body } = await getJson(port, "/unknown-route");
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});
