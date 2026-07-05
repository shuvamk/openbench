import { describe, expect, it } from "vitest";
import { connect } from "node:net";
import { startBackend } from "./lifecycle";

// Resolve iff a TCP connection to the port is refused (server is down).
function connectRefused(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`expected connect to port ${port} to be refused, but it succeeded`));
    });
    socket.once("error", () => resolve());
  });
}

describe("startBackend", () => {
  it("returns { port, stop } with an OS-assigned port > 0", async () => {
    const backend = await startBackend();
    try {
      expect(backend.port).toBeGreaterThan(0);
      expect(typeof backend.stop).toBe("function");
    } finally {
      await backend.stop();
    }
  });

  it("stop() closes the listening socket (a subsequent connect is refused)", async () => {
    const backend = await startBackend();
    const { port } = backend;
    // Reachable while up.
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await backend.stop();
    await expect(connectRefused(port)).resolves.toBeUndefined();
  });

  it("invokes onReady(port) with the OS-assigned port — the handshake, no hardcoded port", async () => {
    let reported: number | undefined;
    const backend = await startBackend({ onReady: (p) => (reported = p) });
    try {
      expect(reported).toBe(backend.port);
      expect(reported).toBeGreaterThan(0);
    } finally {
      await backend.stop();
    }
  });
});
