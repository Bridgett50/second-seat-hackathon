import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { createPrivacyGate, type PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MockRedactor } from "@second-seat/bot/dist/src/private/redact.js";
import { buildOfflineBrief, createSessionStore } from "./session.js";
import { resolveAnalysisConfig } from "./liveConfig.js";
import { installNetGuard, outboundStats, recordAnalyzerCall } from "./netGuard.js";
import { loadDemo } from "./loadFixtures.js";
import { renderBriefPage, renderSessionPage } from "./render.js";

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
 * is text-only; the privacy-gate flow (/api/prepare, /api/correct,
 * /api/approve, /api/send) accepts only its named fields. Any other body
 * field on any POST is unknown and rejected with 400.
 */
export const POST_FIELD_ALLOWLISTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "/api/prepare": new Set(["text"]),
  "/api/correct": new Set(["runId", "editedText"]),
  "/api/approve": new Set(["runId", "text"]),
  "/api/send": new Set(["runId", "approvalToken"]),
  "/api/session": new Set([]),
  "/api/session/transcript": new Set(["sessionId", "text"]),
  "/api/session/redact": new Set(["sessionId"]),
  "/api/session/correct": new Set(["sessionId", "text"]),
  "/api/session/approve": new Set(["sessionId"]),
  "/api/session/analyze": new Set(["sessionId"]),
  "/api/session/draft": new Set(["sessionId", "text"]),
  "/api/session/draft/approve": new Set(["sessionId", "text"]),
  "/api/session/draft/reject": new Set(["sessionId"]),
};

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

export interface WebServerDeps {
  /** Privacy gate; defaults to fixture mode with MockRedactor. */
  gate?: PrivacyGate;
  /** Stubbed sender: receives only reviewed redacted text. Defaults to a recorder. */
  sender?: (text: string) => Promise<unknown> | unknown;
  /** Last text handed to the sender by /api/send (redacted only, never raw). */
  lastSent?: { text: string };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Privacy-gate review page: redacted preview in an editable textarea, then Approve. Editing clears approval. */
export function renderGatePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Privacy gate — Second Seat</title></head>
<body>
<h1>Privacy gate</h1>
<p>Raw text is redacted on private infrastructure before any analysis. Review the redacted preview, then approve.</p>
<label>Transcript to analyse:<textarea id="gate-raw" rows="4" cols="60"></textarea></label>
<div><button type="button" id="gate-prepare">Prepare redacted preview</button></div>
<label>Redacted preview (editable):<textarea id="gate-preview" rows="4" cols="60" readonly></textarea></label>
<div><button type="button" id="gate-approve" disabled>Approve</button>
<button type="button" id="gate-send" disabled>Send for analysis</button></div>
<p id="gate-status" role="status"></p>
<script>
(function(){
var runId=null,approvalToken=null,approved=false;
var raw=document.getElementById("gate-raw"),preview=document.getElementById("gate-preview");
var approveBtn=document.getElementById("gate-approve"),sendBtn=document.getElementById("gate-send");
var status=document.getElementById("gate-status");
function setStatus(t){status.textContent=t;}
function refresh(){approveBtn.disabled=!(runId&&!approved);sendBtn.disabled=!(runId&&approved&&approvalToken);}
function call(path,body){return fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(b){return {ok:r.ok,body:b};});});}
document.getElementById("gate-prepare").addEventListener("click",function(){
  runId=null;approvalToken=null;approved=false;refresh();
  call("/api/prepare",{text:raw.value}).then(function(r){
    if(!r.ok){setStatus("Prepare failed.");return;}
    runId=r.body.runId;preview.readOnly=false;preview.value=r.body.redactedText;
    setStatus("Redacted preview ready. Review it, then approve.");refresh();
  });
});
preview.addEventListener("input",function(){
  if(!runId)return;
  approved=false;approvalToken=null;refresh();
  call("/api/correct",{runId:runId,editedText:preview.value}).then(function(){
    setStatus("Edited: prior approval cleared. Review, then approve again.");refresh();
  });
});
approveBtn.addEventListener("click",function(){
  if(!runId)return;
  call("/api/approve",{runId:runId,text:preview.value}).then(function(r){
    if(!r.ok){setStatus("Approve failed.");return;}
    approvalToken=r.body.approvalToken;approved=true;
    setStatus("Approved. Only the redacted preview will be sent.");refresh();
  });
});
sendBtn.addEventListener("click",function(){
  if(!runId||!approvalToken)return;
  call("/api/send",{runId:runId,approvalToken:approvalToken}).then(function(r){
    if(!r.ok){approved=false;approvalToken=null;setStatus("Send refused.");refresh();return;}
    setStatus("Sent for analysis. Only the approved redacted text left this page.");
  });
});
refresh();
})();
</script>
</body>
</html>`;
}

export function createWebServer(deps?: WebServerDeps) {
  installNetGuard();
  const testMode = process.env.SECOND_SEAT_TEST_MODE === "1";
  const analysisConfig = testMode ? { mode: "offline" as const } : resolveAnalysisConfig(process.env);
  const sessions =
    testMode || analysisConfig.mode === "offline"
      ? testMode
        ? createSessionStore({
            offline: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            redactor: new MockRedactor() as any,
            analyzer: async (approvedText: string) => {
              if (approvedText.includes("[[slow]]")) {
                await new Promise((r) => setTimeout(r, 1500));
              }
              recordAnalyzerCall(approvedText);
              return buildOfflineBrief(approvedText, []);
            },
          })
        : createSessionStore()
      : createSessionStore({
          offline: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          redactor: analysisConfig.redactor as any,
          gate: analysisConfig.gate,
          analyzer: analysisConfig.analyzer,
          analyzerLabel: analysisConfig.analyzerLabel,
        });
  const gate = deps?.gate ?? createPrivacyGate({ mode: "fixture", redactor: new MockRedactor() });
  const sent: { text: string } = deps?.lastSent ?? { text: "" };
  const sender =
    deps?.sender ??
    ((text: string): void => {
      sent.text = text;
    });
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
    if (req.method === "GET" && (url.pathname === "/session" || url.pathname === "/session/")) {
      const sessionId = sessions.createSession();
      const html = renderSessionPage(sessions.getState(sessionId));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/gate") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderGatePage());
      return;
    }
    if (url.pathname === "/api/test/outbound" || url.pathname === "/api/test/expire-approvals") {
      if (!testMode) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/test/outbound") {
        json(res, 200, outboundStats());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/test/expire-approvals") {
        sessions.expireApprovals();
        json(res, 200, { expired: true });
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session/state") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        json(res, 400, { error: 'query "sessionId" is required' });
        return;
      }
      try {
        json(res, 200, sessions.getState(sessionId));
      } catch (err: unknown) {
        json(res, 404, { error: err instanceof Error ? err.message : "unknown session" });
      }
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
          const body = asRecord(parsed);
          if (url.pathname === "/api/prepare") {
            const text = body?.["text"];
            if (typeof text !== "string" || text === "") {
              json(res, 400, { error: "field \"text\" must be a non-empty string" });
              return;
            }
            // Raw text goes only to the gate's redactor; it is never logged.
            gate
              .prepare(text)
              .then((prepared) => {
                json(res, 200, {
                  runId: prepared.runId,
                  redactedText: prepared.redactedText,
                  needsReview: prepared.needsReview,
                });
              })
              .catch((err: unknown) => json(res, 400, { error: err instanceof Error ? err.message : "prepare failed" }));
            return;
          }
          if (url.pathname === "/api/correct") {
            const runId = body?.["runId"];
            const editedText = body?.["editedText"];
            if (typeof runId !== "string" || typeof editedText !== "string") {
              json(res, 400, { error: "fields \"runId\" and \"editedText\" must be strings" });
              return;
            }
            try {
              const redactedText = gate.correct(runId, editedText);
              json(res, 200, { runId, redactedText });
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "correct failed" });
            }
            return;
          }
          if (url.pathname === "/api/approve") {
            const runId = body?.["runId"];
            const text = body?.["text"];
            if (typeof runId !== "string" || typeof text !== "string") {
              json(res, 400, { error: "fields \"runId\" and \"text\" must be strings" });
              return;
            }
            try {
              const approvalToken = gate.approve(runId, text);
              json(res, 200, { runId, approvalToken });
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "approve failed" });
            }
            return;
          }
          if (url.pathname === "/api/send") {
            const runId = body?.["runId"];
            const approvalToken = body?.["approvalToken"];
            if (typeof runId !== "string" || typeof approvalToken !== "string") {
              json(res, 400, { error: "fields \"runId\" and \"approvalToken\" must be strings" });
              return;
            }
            // The stubbed sender receives only the reviewed redacted text.
            gate
              .send(runId, approvalToken, async (gated) => {
                await sender(gated.text);
                return gated.text;
              })
              .then((sentText) => {
                json(res, 200, { runId, sentText });
              })
              .catch((err: unknown) => json(res, 400, { error: err instanceof Error ? err.message : "send failed" }));
            return;
          }
          if (url.pathname === "/api/session") {
            const sessionId = sessions.createSession();
            json(res, 200, { sessionId });
            return;
          }
          if (url.pathname === "/api/session/transcript") {
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            try {
              json(res, 200, sessions.setTranscript(sessionId, text));
            } catch (err: unknown) {
              json(res, 404, { error: err instanceof Error ? err.message : "unknown session" });
            }
            return;
          }
          if (url.pathname === "/api/session/redact") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            sessions
              .redact(sessionId)
              .then((state) => json(res, 200, state))
              .catch((err: unknown) =>
                json(res, 404, { error: err instanceof Error ? err.message : "redact failed" }),
              );
            return;
          }
          if (url.pathname === "/api/session/correct") {
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            try {
              json(res, 200, sessions.correct(sessionId, text));
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "correct failed" });
            }
            return;
          }
          if (url.pathname === "/api/session/approve") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            try {
              json(res, 200, sessions.approve(sessionId));
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "approve failed" });
            }
            return;
          }
          if (url.pathname === "/api/session/analyze") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            sessions
              .analyze(sessionId)
              .then((state) => json(res, 200, state))
              .catch((err: unknown) =>
                json(res, 404, { error: err instanceof Error ? err.message : "analyze failed" }),
              );
            return;
          }
          if (url.pathname === "/api/session/draft") {
            // draft routes
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            try {
              json(res, 200, sessions.editDraft(sessionId, text));
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "draft failed" });
            }
            return;
          }
          if (url.pathname === "/api/session/draft/approve") {
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            try {
              json(res, 200, sessions.approveDraft(sessionId, text));
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "approve failed";
              const status = msg === "draft changed; review again" ? 409 : 400;
              json(res, status, { error: msg });
            }
            return;
          }
          if (url.pathname === "/api/session/draft/reject") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            try {
              json(res, 200, sessions.rejectDraft(sessionId));
            } catch (err: unknown) {
              json(res, 404, { error: err instanceof Error ? err.message : "reject failed" });
            }
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
