import { modelChips, type RunLogLine } from "./modelStrip.js";

export interface Citation {
  kind: string;
  segmentId: string | null;
  frameId: string | null;
  region: { x: number; y: number; w: number; h: number } | null;
}

export interface BriefEntry {
  id: string;
  category: string;
  text: string;
  speaker: string | null;
  citations: Citation[];
  flags: string[];
}

export interface Brief {
  createdAt: string;
  entries: BriefEntry[];
  flagged?: string[];
}

export interface TranscriptSegment {
  id: string;
  time: string;
  speaker: string;
  text: string;
}

export interface Frame {
  id: string;
  file: string;
  time: string;
  pngBase64?: string;
}

export interface PressureItem {
  id: string;
  text: string;
  segmentIds: string[];
}

export interface PayloadDemo {
  maskedText: string;
  fields?: { masked: string; meaning: string }[];
  note?: string;
}

export interface GlimmerLiveInfo {
  recall: string;
}

export interface RenderOpts {
  liveDev?: boolean;
  pressureFallback?: PressureItem[];
  payloadDemo?: PayloadDemo | null;
  glimmerLive?: GlimmerLiveInfo | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pressureItemsFor(
  brief: Brief,
  fallback: PressureItem[] = [],
): PressureItem[] {
  const derived = brief.entries
    .filter(
      (e) =>
        e.flags.some((f) => f.toLowerCase().includes("pressure")) ||
        e.category.toLowerCase().includes("pressure"),
    )
    .map((e) => ({
      id: e.id,
      text: e.text,
      segmentIds: e.citations
        .filter((c) => c.segmentId)
        .map((c) => c.segmentId as string),
    }));
  return derived.length > 0 ? derived : fallback;
}

export function heldText(badgeCount: number): string {
  return `Held: review the ${badgeCount} pressure item${badgeCount === 1 ? "" : "s"} first`;
}

function citationLink(c: Citation): string {
  if (c.kind === "frame" && c.frameId) {
    return `<a href="#frame-${esc(c.frameId)}">[${esc(c.frameId)}]</a>`;
  }
  if (c.segmentId) {
    return `<a href="#seg-${esc(c.segmentId)}">[${esc(c.segmentId)}]</a>`;
  }
  return "";
}

function conflictCard(brief: Brief): string {
  const entry = brief.entries.find(
    (e) =>
      e.category === "source_conflict" ||
      e.flags.includes("conflicting_sources"),
  );
  let body = "conflict not in fixture";
  if (entry && entry.text.includes("30th") && entry.text.includes("15th")) {
    body = esc(entry.text);
  }
  return `<section id="conflict"><h2>Conflict: delivery date</h2><p>Slide says the 30th; vendor later claimed the 15th.</p><blockquote>${body}</blockquote></section>`;
}

export function renderBriefPage(
  brief: Brief,
  transcriptSegments: TranscriptSegment[],
  frames: Frame[],
  runLog: RunLogLine[],
  opts: RenderOpts = {},
): string {
  const liveDev = opts.liveDev === true;
  const chips = modelChips(runLog);
  const pressure = pressureItemsFor(brief, opts.pressureFallback ?? []);
  const byCategory = new Map<string, BriefEntry[]>();
  for (const e of brief.entries) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  const flagged = brief.entries.filter((e) => e.flags.length > 0);

  const glimmerLive = opts.glimmerLive ?? null;
  const chipHtml = chips
    .map((c) => {
      if (c.stage === "glimmer-redact" && glimmerLive !== null) {
        return `<span class="model-chip" data-stage="glimmer-redact" data-status="live">glimmer-redact: live · recall ${esc(glimmerLive.recall)}</span>`;
      }
      return c.status === "run"
        ? `<span class="model-chip" data-stage="${esc(c.stage)}" data-status="run">${esc(c.stage)}: ${esc(c.model as string)}</span>`
        : `<span class="model-chip" data-stage="${esc(c.stage)}" data-status="not run">${esc(c.stage)}: not run</span>`;
    })
    .join("\n");

  const categoryHtml = [...byCategory.entries()]
    .map(
      ([cat, entries]) =>
        `<section class="category" data-category="${esc(cat)}"><h2>${esc(cat)}</h2>\n${entries
          .map(
            (e) =>
              `<article class="entry replay-item" id="entry-${esc(e.id)}"><p>${esc(e.text)}</p>` +
              (e.speaker ? `<p class="speaker">${esc(e.speaker)}</p>` : "") +
              (e.flags.length > 0
                ? `<p class="flags">flags: ${e.flags.map(esc).join(", ")}</p>`
                : "") +
              `<p class="citations">${e.citations.map(citationLink).join(" ")}</p></article>`,
          )
          .join("\n")}</section>`,
    )
    .join("\n");

  const flaggedHtml = `<section id="flagged"><h2>Flagged</h2>\n${flagged
    .map(
      (e) =>
        `<article class="entry" id="flagged-${esc(e.id)}"><p>${esc(e.text)}</p>` +
        `<p class="flags">flags: ${e.flags.map(esc).join(", ")}</p>` +
        `<p class="citations">${e.citations.map(citationLink).join(" ")}</p></article>`,
    )
    .join("\n")}</section>`;

  const badgeHtml = pressure
    .map((p) =>
      p.segmentIds
        .map(
          (s) =>
            `<a class="pressure-badge" href="#seg-${esc(s)}">pressure: ${esc(p.id)}</a>`,
        )
        .join("\n"),
    )
    .join("\n");

  const badgeCount = pressure.reduce((n, p) => n + p.segmentIds.length, 0);

  const frameById = new Map(frames.map((f) => [f.id, f]));
  const frameIds = new Set<string>();
  for (const e of brief.entries) {
    for (const c of e.citations) {
      if (c.kind === "frame" && c.frameId) frameIds.add(c.frameId);
    }
  }
  const frameHtml = [...frameIds]
    .map((fid) => {
      const f = frameById.get(fid);
      const region = brief.entries
        .flatMap((e) => e.citations)
        .find((c) => c.frameId === fid && c.region)?.region;
      const img =
        f?.pngBase64 && f.pngBase64.length > 0
          ? `<img src="data:image/png;base64,${f.pngBase64}" alt="${esc(f.file)}">`
          : `<span class="frame-missing">frame image missing</span>`;
      return (
        `<figure id="frame-${esc(fid)}"><figcaption>${esc(fid)}${f ? ` — ${esc(f.file)}` : ""}</figcaption>` +
        `<div class="frame-box">` +
        img +
        (region
          ? `<div class="region-overlay" style="left:${region.x}%;top:${region.y}%;width:${region.w}%;height:${region.h}%"></div>`
          : "") +
        `</div></figure>`
      );
    })
    .join("\n");

  const transcriptJson = JSON.stringify(transcriptSegments).replace(
    /</g,
    "\\u003c",
  );
  const segmentHtml = transcriptSegments
    .map(
      (s) =>
        `<li class="replay-item" id="seg-${esc(s.id)}" data-time="${esc(s.time)}"><strong>[${esc(s.time)}] ${esc(s.speaker)}:</strong> ${esc(s.text)}</li>`,
    )
    .join("\n");

  const pressureChecks = pressure
    .map(
      (p) =>
        `<label class="pressure-check"><input type="checkbox" class="pressure-review" data-pressure="${esc(p.id)}"> Reviewed: ${esc(p.text)} ` +
        p.segmentIds
          .map((s) => `<a href="#seg-${esc(s)}">[${esc(s)}]</a>`)
          .join(" ") +
        `</label>`,
    )
    .join("\n");

  const payload = opts.payloadDemo;
  const payloadHtml = payload
    ? `<section id="what-left-this-server"><h2>What left this server</h2><pre>${esc(payload.maskedText)}</pre>` +
      (payload.note ? `<p>${esc(payload.note)}</p>` : "") +
      `<label>Upload transcript (.vtt): <input type="file" id="upload-vtt" accept=".vtt"></label>\n` +
      `<label>Upload frame (.png): <input type="file" id="upload-png" accept=".png,image/png"></label></section>`
    : `<section id="what-left-this-server"><h2>What left this server</h2>` +
      `<label>Upload transcript (.vtt): <input type="file" id="upload-vtt" accept=".vtt"></label>\n` +
      `<label>Upload frame (.png): <input type="file" id="upload-png" accept=".png,image/png"></label></section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brief demo — Second Seat</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;line-height:1.5;color:#1a1a1a;background:#f7f7f5}
h1{font-size:1.5rem;margin:.5rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem}
.replay-label{margin:.25rem 0 .75rem;color:#333}
#model-strip{margin:.25rem 0}
.model-chip{display:inline-block;border:1px solid #555;border-radius:999px;padding:.1rem .6rem;margin:.15rem;font-size:.85rem;background:#fff}
.model-chip[data-status="live"]{border-color:#1c6b2a;background:#e9f5ec;color:#14501f}
#hero{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:.75rem 0}
#pressure-badges{grid-column:1/-1}
.pressure-badge{display:inline-block;background:#8f1d1d;color:#fff;border-radius:.3rem;padding:.15rem .6rem;margin:.15rem;text-decoration:none}
#conflict,#draft,.category,#flagged,#transcript,#frames,#what-left-this-server{background:#fff;border:1px solid #ddd;border-radius:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:1rem;margin:0 0 1rem;min-width:0}
#hero #conflict,#hero #draft{margin:0;min-width:0}
#conflict blockquote{margin:.5rem 0 0;padding:.5rem .75rem;border-left:3px solid #8f1d1d;background:#fafafa;border-radius:0 .4rem .4rem 0}
#draft-status{font-weight:600}
.pressure-check{display:block;margin:.35rem 0}
.region-overlay{position:absolute;border:2px solid red}
.frame-box{position:relative;min-height:4rem;background:#ddd}
img{max-width:100%;height:auto}
pre{white-space:pre-wrap;word-break:break-word}
button{margin:.25rem;padding:.4rem .9rem;font:inherit}
footer{margin-top:2rem;border-top:1px solid #999;padding-top:.5rem}
[hidden]{display:none!important}
@media (max-width:45rem){#hero{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>Vendor brief — demo</h1>
<p class="replay-label">Replay of recorded brief — Analysis precomputed ${esc(brief.createdAt)}</p>
<div id="model-strip">${chipHtml}</div>
<section id="hero" aria-label="Demo hero">
<div id="pressure-badges">${badgeHtml}</div>
${conflictCard(brief)}
<section id="draft">
<h2>Draft reply</h2>
<p id="draft-status">${esc(heldText(badgeCount))}</p>
${pressureChecks}
<p class="citations">${pressure.map((p) => p.segmentIds.map((s) => `<a href="#seg-${esc(s)}">[${esc(s)}]</a>`).join(" ")).join(" ")}</p>
<button type="button" id="btn-approve">Approve</button>
<button type="button" id="btn-edit">Edit</button>
<button type="button" id="btn-reject">Reject</button>
<button type="button" id="btn-copy" disabled>Copy</button>
<p id="draft-note"></p>
</section>
</section>
${categoryHtml}
${flaggedHtml}
<section id="transcript"><h2>Transcript</h2><ol id="transcript-lines">${segmentHtml}</ol></section>
<section id="frames"><h2>Frames</h2>${frameHtml}</section>
${payloadHtml}
${liveDev ? `<button type="button" id="live-call-btn">Start live call</button>` : ""}
<footer>Nothing is ever sent.</footer>
<script type="application/json" id="transcript-data">${transcriptJson}</script>
<script>
(function(){
var approved=false;
var copyBtn=document.getElementById("btn-copy");
var note=document.getElementById("draft-note");
var status=document.getElementById("draft-status");
function refresh(){
  var boxes=Array.prototype.slice.call(document.querySelectorAll(".pressure-review"));
  var allReviewed=boxes.length>0 && boxes.every(function(b){return b.checked;});
  copyBtn.disabled=!(approved&&allReviewed);
  if(!approved){var n=document.querySelectorAll(".pressure-badge").length;status.textContent="Held: review the "+n+" pressure item"+(n===1?"":"s")+" first";}
}
document.getElementById("btn-approve").addEventListener("click",function(){
  approved=true;note.textContent="Approved locally. Nothing was sent.";refresh();
});
document.getElementById("btn-edit").addEventListener("click",function(){
  note.textContent="Edit mode: adjust the draft text above, then Approve.";refresh();
});
document.getElementById("btn-reject").addEventListener("click",function(){
  approved=false;note.textContent="Rejected locally. Nothing was sent.";refresh();
});
Array.prototype.forEach.call(document.querySelectorAll(".pressure-review"),function(b){
  b.addEventListener("change",refresh);
});
copyBtn.addEventListener("click",function(){
  var text=status.textContent||"";
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);}
  else{var t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();document.execCommand("copy");document.body.removeChild(t);}
  note.textContent="Copied locally. Nothing was sent.";
});
var replayItems=document.querySelectorAll(".replay-item");
var reduceMotion=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
var staticMode=false;
try{staticMode=new URLSearchParams(window.location.search).get("static")==="1";}catch(e){}
if(!reduceMotion&&!staticMode){
  var i=0;
  for(var k=0;k<replayItems.length;k++){replayItems[k].hidden=true;}
  var timer=setInterval(function(){
    if(i>=replayItems.length){clearInterval(timer);return;}
    replayItems[i].hidden=false;i++;
  },250);
}
refresh();
})();
</script>
</body>
</html>`;
}
