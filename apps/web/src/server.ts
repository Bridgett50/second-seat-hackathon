import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadDemo } from "./loadFixtures.js";
import { renderBriefPage } from "./render.js";

const PORT = Number(process.env.PORT ?? 4173);
const LIVE_DEV = process.env.LIVE_DEV === "1";

/**
 * Text-only core flow: no POST route accepts image or frame-sidecar inputs.
 * Body fields that always carry (or name) image data, matched
 * case-insensitively ("frameSidecar" -> "framesidecar").
 */
export const IMAGE_BODY_FIELDS: ReadonlySet<string> = new Set([
  "image",
  "images",
  "frame",
  "frames",
  "sidecar",
  "framesidecar",
  "screenshot",
  "png",
]);

/**
 * Allowlist of accepted JSON body fields for each POST route. The core flow
 * is text-only and read-only, so no POST route exists here: any body field on
 * any POST is unknown and rejected with 400.
 */
export const POST_FIELD_ALLOWLISTS: Readonly<Record<string, ReadonlySet<string>>> = {};

const MAX_BODY_BYTES = 1_000_000;

/** Non-null means reject with HTTP 400 and this JSON error message. */
export function validatePostBody(
  pathname: string,
  contentType: string,
  rawBody: string,
  parsedBody: unknown,
): string | null {
  const ct = contentType.toLowerCase();
  if (ct.includes("multipart/") || /(^|[\s;,])image\//.test(ct)) {
    return "image uploads are not accepted: the core flow is text-only";
  }
  if (rawBody.includes("data:image/")) {
    return "base64 image data is not accepted: the core flow is text-only";
  }
  if (parsedBody !== null && typeof parsedBody === "object") {
    const record = parsedBody as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (IMAGE_BODY_FIELDS.has(key.toLowerCase())) {
        return `field "${key}" is not accepted: the core flow is text-only`;
      }
    }
    if (Object.values(record).some((v) => typeof v === "string" && v.includes("data:image/"))) {
      return "base64 image data is not accepted: the core flow is text-only";
    }
    const allowlist = POST_FIELD_ALLOWLISTS[pathname];
    for (const key of Object.keys(record)) {
      if (allowlist === undefined || !allowlist.has(key)) {
        return `unknown field "${key}" for POST ${pathname}`;
      }
    }
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createWebServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && (url.pathname === "/briefs/demo" || url.pathname === "/briefs/demo/")) {
      const demo = loadDemo();
      const html = renderBriefPage(
        demo.brief,
        demo.segments,
        demo.frames,
        demo.runLog,
        {
          liveDev: LIVE_DEV,
          pressureFallback: demo.pressureFallback,
          payloadDemo: demo.payloadDemo,
          glimmerLive: demo.glimmerLive,
          briefScore: demo.briefScore,
          seededScore: demo.seededScore,
          heroChain: demo.heroChain,
        },
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "POST") {
      void readBody(req).then(
        (raw) => {
          let parsed: unknown = null;
          if (raw !== "") {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          const error = validatePostBody(
            url.pathname,
            req.headers["content-type"] ?? "",
            raw,
            parsed,
          );
          if (error !== null) {
            json(res, 400, { error });
            return;
          }
          json(res, 404, { error: "not found" });
        },
        () => json(res, 400, { error: "unreadable body" }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createWebServer().listen(PORT, () => {
    console.log(`web demo on http://localhost:${PORT}/briefs/demo`);
  });
}
