/** Read-only payload inspector: GET /briefs/demo/payload and GET /health. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { snapshot } from "./payloadLog.js";
import { defaultRedactor } from "./redact.js";

export function createInspectorServer() {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/briefs/demo/payload") {
      const body = JSON.stringify(snapshot());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      void defaultRedactor()
        .health()
        .then((h) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(h));
        })
        .catch(() => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
        });
      return;
    }
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
  });
}
