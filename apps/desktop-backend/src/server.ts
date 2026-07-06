import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  PioCliBackend,
  type FirmwareBackend,
} from "@openbench/mcp-firmware-platformio";
import { handleFirmwareBuild } from "./routes/firmware";

/** Injectable dependencies so tests can supply deterministic engine backends. */
export interface ServerOptions {
  /** Firmware build backend; defaults to the native `pio` CLI (feature-detected). */
  firmwareBackend?: FirmwareBackend;
}

/** Write a JSON response with the given status, never leaking a raw stack trace. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Collect a request body as a UTF-8 string (bounded by node's own limits). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { firmwareBackend: FirmwareBackend },
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const path = rawUrl.split("?", 1)[0];

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && path === "/firmware/build") {
    const body = await readBody(req);
    const { status, body: responseBody } = await handleFirmwareBuild(body, deps.firmwareBackend);
    sendJson(res, status, responseBody);
    return;
  }

  // Structured 404 for anything unrecognised — the client always gets JSON.
  sendJson(res, 404, { error: `no route for ${req.method ?? "?"} ${path}` });
}

/**
 * The local backend HTTP server (loopback engine host, ADR-0024). Framework-free
 * `node:http`; bind it with `.listen(0, "127.0.0.1")` for an OS-assigned port.
 * All handler errors are caught so a bad request can never crash the process or
 * surface a stack trace to the caller. Engine backends are injectable for tests.
 */
export function createServer(options: ServerOptions = {}): Server {
  const deps = { firmwareBackend: options.firmwareBackend ?? new PioCliBackend() };
  return createHttpServer((req, res) => {
    route(req, res, deps).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal server error" });
      } else {
        res.end();
      }
    });
  });
}
