import type { AddressInfo } from "node:net";
import { createServer } from "./server.js";

export interface BackendHandle {
  /** The OS-assigned ephemeral port the server is listening on. */
  port: number;
  /** Close the listening socket; resolves once the socket is fully closed. */
  stop: () => Promise<void>;
}

export interface StartBackendOptions {
  /**
   * Port to bind. Defaults to `0` (OS-assigned ephemeral port) — there is no
   * hardcoded port anywhere; the Electron main process learns it via `onReady`.
   */
  port?: number;
  /** Host to bind. Defaults to loopback only (`127.0.0.1`). */
  host?: string;
  /**
   * Called once the server is listening, with the assigned port. This is the
   * handshake #116's Electron main process consumes to reach the backend.
   */
  onReady?: (port: number) => void;
}

/**
 * Start the local backend and resolve once it is listening. The Electron main
 * process calls this on launch and `stop()` on quit.
 */
export function startBackend(
  options: StartBackendOptions = {},
): Promise<BackendHandle> {
  const { port = 0, host = "127.0.0.1", onReady } = options;
  const server = createServer();

  return new Promise<BackendHandle>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("desktop-backend: could not determine the assigned port"));
        return;
      }

      const assignedPort = (address as AddressInfo).port;
      const stop = (): Promise<void> =>
        new Promise<void>((resolveStop, rejectStop) => {
          server.close((err) => (err ? rejectStop(err) : resolveStop()));
        });

      onReady?.(assignedPort);
      resolve({ port: assignedPort, stop });
    });
  });
}
