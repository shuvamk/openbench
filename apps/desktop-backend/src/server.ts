import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

/** Write a JSON response with the given status, never leaking a raw stack trace. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function route(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url ?? "/";
  const path = rawUrl.split("?", 1)[0];

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // Structured 404 for anything unrecognised — the client always gets JSON.
  sendJson(res, 404, { error: `no route for ${req.method ?? "?"} ${path}` });
}

/**
 * The local backend HTTP server (loopback engine host, ADR-0024). Framework-free
 * `node:http`; bind it with `.listen(0, "127.0.0.1")` for an OS-assigned port.
 * All handler errors are caught so a bad request can never crash the process or
 * surface a stack trace to the caller.
 */
export function createServer(): Server {
  return createHttpServer((req, res) => {
    try {
      route(req, res);
    } catch {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal server error" });
      } else {
        res.end();
      }
    }
  });
}
