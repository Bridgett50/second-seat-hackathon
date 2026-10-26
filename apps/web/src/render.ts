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

export interface GlimmerAttemptInfo {
  label?: string;
  mode?: "live" | "mock";
  runId?: string;
  sourceRevision?: string;
  ranAt?: string;
  status?: "complete" | "incomplete" | "invalid";
  completedK?: number;
  completedN?: number;
  recallK?: number;
  recallN?: number;
  fullK?: number;
  fullN?: number;
}

export interface GlimmerLiveInfo extends GlimmerAttemptInfo {
  recall: string;
  n?: number;
  attempts?: GlimmerAttemptInfo[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatAttemptDate(ranAt: string): string {
  const d = new Date(ranAt);
  const month = MONTHS[d.getUTCMonth()] ?? "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${d.getUTCFullYear()} ${hour}:${min} UTC`;
}

export function attemptMetaLine(a: GlimmerAttemptInfo): string {
  return (
    `mode ${a.mode ?? "live"} · run ${a.runId ?? "unknown"} · ` +
    `revision ${a.sourceRevision ?? "unknown"} · status ${a.status ?? "unknown"}`
  );
}

export function glimmerHeadline(a: GlimmerLiveInfo): string | null {
  if (
    a.status === undefined || a.completedK === undefined || a.completedN === undefined ||
    a.recallK === undefined || a.recallN === undefined ||
    a.fullK === undefined || a.fullN === undefined || a.ranAt === undefined
  ) {
    return null;
  }
  return (
    `Latest attempt ${formatAttemptDate(a.ranAt)} — ${a.status}: ` +
    `${a.completedK}/${a.completedN} cases completed · ` +
    `${a.recallK}/${a.recallN} legacy entity disappearance on completed cases · ` +
    `${a.fullK}/${a.fullN} full batch`
  );
}

export function isMockOrFailedRun(line: RunLogLine | undefined): boolean {
  if (line === undefined) return false;
  return (
    /mock/i.test(line.model ?? "") ||
    /mock/i.test(line.note ?? "") ||
    /\b(fail|failed|error)\b/i.test(line.note ?? "")
  );
}

export interface SeededScore {
  catchK: number;
  catchN: number;
  catchLo: number;
  catchHi: number;
  falseK: number;
  falseN: number;
}

export function seededScoreLine(score: SeededScore): string {
  return (
    `Seeded errors caught ${score.catchK}/${score.catchN} ` +
    `(95% CI ${score.catchLo.toFixed(2)}–${score.catchHi.toFixed(2)}), ` +
    `false alarms ${score.falseK}/${score.falseN}`
  );
}

export interface BriefScore {
  briefEntries: number;
  truthEntries: number;
  validatorClean: number;
  matched: number;
  categoryAgree: number;
}

export function briefScoreLine(score: BriefScore): string {
  return (
    `categories ${score.categoryAgree}/${score.matched} · ` +
    `truth entry match ${score.matched}/${score.truthEntries} · ` +
    `citations resolved ${score.validatorClean}/${score.briefEntries}`
  );
}

export interface HeroChainProof {
  /** Base64 PNG of the synthetic hero slide. */
  pngBase64: string;
  /** SAM box as CSS percentages for the overlay. */
  boxPercent: { x: number; y: number; w: number; h: number };
  /** Date read by muse-spark-1.3 in the region, if any. */
  date?: string | null;
  /** True when the slide PNG came from a model (muse-image-1.0). */
  modelGenerated: boolean;
}

export interface RenderOpts {
  /** Deprecated, ignored: the core flow is text-only and has no live-call control. */
  liveDev?: boolean;
  pressureFallback?: PressureItem[];
  payloadDemo?: PayloadDemo | null;
  glimmerLive?: GlimmerLiveInfo | null;
  briefScore?: BriefScore | null;
  seededScore?: SeededScore | null;
  heroChain?: HeroChainProof | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function dedupePressureItems(items: PressureItem[]): PressureItem[] {
  const seen = new Set<string>();
  const out: PressureItem[] = [];
  for (const item of items) {
    if (item.id === undefined || item.id === null || item.id === "") {
      out.push(item);
      continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
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
  return dedupePressureItems(derived.length > 0 ? derived : fallback);
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

export function conflictEntries(brief: Brief): BriefEntry[] {
  return brief.entries.filter(
    (e) =>
      e.category === "source_conflict" ||
      e.flags.includes("conflicting_sources"),
  );
}

function conflictsSection(brief: Brief): string {
  const conflicts = conflictEntries(brief);
  const items = conflicts
    .map(
      (e) =>
        `<article class="entry" id="entry-${esc(e.id)}"><p>${esc(e.text)}</p>` +
        `<p class="citations">${e.citations.map(citationLink).join(" ")}</p></article>`,
    )
    .join("\n");
  const body =
    conflicts.length > 0 ? items : `<p id="empty-state">No conflicting sources found.</p>`;
  return `<section id="conflicts"><h2>Conflicting sources</h2>${body}</section>`;
}

export function renderBriefPage(
  brief: Brief,
  transcriptSegments: TranscriptSegment[],
  frames: Frame[],
  runLog: RunLogLine[],
  opts: RenderOpts = {},
): string {
  void opts.liveDev; // deprecated, ignored: no live-call control in the text-only core flow.
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
  const lastByStage = new Map<string, RunLogLine>();
  for (const line of runLog) lastByStage.set(line.stage, line);
  const chipHtml = chips
    .map((c) => {
      if (c.stage === "glimmer-redact" && glimmerLive !== null) {
        const live =
          glimmerLive.status === "complete" &&
          glimmerLive.mode !== "mock" &&
          !isMockOrFailedRun(lastByStage.get(c.stage));
        if (live) {
          const suffix = glimmerLive.n !== undefined ? ` (n=${glimmerLive.n})` : "";
          return `<span class="model-chip" data-stage="glimmer-redact" data-status="live">glimmer-redact: live · legacy entity disappearance ${esc(glimmerLive.recall)}${suffix}</span>`;
        }
        return `<span class="model-chip" data-stage="glimmer-redact" data-status="incomplete">glimmer-redact: incomplete</span>`;
      }
      if (c.status === "run" && isMockOrFailedRun(lastByStage.get(c.stage))) {
        return `<span class="model-chip" data-stage="${esc(c.stage)}" data-status="not run">${esc(c.stage)}: not run</span>`;
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

  const renderedBadges = pressure.filter((p) => p.segmentIds.length > 0);
  const badgeHtml = renderedBadges
    .map(
      (p) =>
        `<a class="pressure-badge" href="#seg-${esc(p.segmentIds[0] as string)}">pressure: ${esc(p.id)}</a>`,
    )
    .join("\n");

  const badgeCount = renderedBadges.length;

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

  const pressureChecks = renderedBadges
    .map(
      (p) =>
        `<label class="pressure-check"><input type="checkbox" class="pressure-review" data-pressure="${esc(p.id)}"> Reviewed: ${esc(p.text)} ` +
        p.segmentIds
          .map((s) => `<a href="#seg-${esc(s)}">[${esc(s)}]</a>`)
          .join(" ") +
        `</label>`,
    )
    .join("\n");

  const draftMeetingId =
    brief.createdAt.length > 0 ? brief.createdAt : "demo-meeting";
  const draftRunId = `run-${draftMeetingId}`;
  const draftInitial =
    brief.entries[0]?.text ??
    "Thanks for sharing the details. I will review and follow up.";
  const draftInitialAttr = esc(draftInitial);
  const draftInitialHtml = draftInitialAttr.replace(
    /<\/textarea/gi,
    "&lt;/textarea",
  );

  const briefScore = opts.briefScore ?? null;
  const scoreLines: string[] = [];
  if (briefScore !== null) {
    scoreLines.push(
      `<p id="scores-brief">${esc(briefScoreLine(briefScore))}</p>`,
    );
  }
  let glimmerRunsHtml = "";
  if (glimmerLive !== null) {
    const headline = glimmerHeadline(glimmerLive);
    if (headline !== null) {
      scoreLines.push(
        `<p id="scores-glimmer">Glimmer legacy entity disappearance ${glimmerLive.recallK}/${glimmerLive.recallN} on completed cases · latest attempt ${esc(glimmerLive.status ?? "unknown")} (${glimmerLive.completedK}/${glimmerLive.completedN} cases, ${glimmerLive.fullK}/${glimmerLive.fullN} full batch)</p>`,
      );
      const spanNote = (glimmerLive as { spanNote?: string }).spanNote;
      if (spanNote) scoreLines.push(`<p id="scores-glimmer-span">requests ${glimmerLive.completedK}/${glimmerLive.completedN} · legacy ${glimmerLive.recallK}/${glimmerLive.recallN} completed · ${glimmerLive.fullK}/${glimmerLive.fullN} end-to-end · ${esc(spanNote)}</p>`);
      const previous = (glimmerLive.attempts ?? []).filter((a) => a.ranAt !== glimmerLive.ranAt);
      const previousHtml =
        previous.length > 0
          ? `<div id="scores-glimmer-previous"><h3>Previous runs</h3><ul>` +
            previous
              .map(
                (a) =>
                  `<li>${esc(a.label ?? a.ranAt ?? "run")} — ${esc(a.status ?? "unknown")}: ` +
                  `${a.completedK ?? "?"}/${a.completedN ?? "?"} cases completed · ` +
                  `${a.recallK ?? "?"}/${a.recallN ?? "?"} legacy entity disappearance · ` +
                  `${esc(attemptMetaLine(a))}</li>`,
              )
              .join("") +
            `</ul></div>`
          : "";
      glimmerRunsHtml =
        `<section id="glimmer-runs" aria-label="Glimmer runs"><h2>Glimmer runs</h2>` +
        `<p>${esc(headline)}</p>` +
        `<p id="scores-glimmer-meta">${esc(attemptMetaLine(glimmerLive))}</p>` +
        previousHtml +
        `</section>`;
    } else {
      const suffix = glimmerLive.n !== undefined ? ` (n=${glimmerLive.n})` : "";
      scoreLines.push(
        `<p id="scores-glimmer">Glimmer legacy entity disappearance ${esc(glimmerLive.recall)}${suffix}</p>`,
      );
    }
  }
  const seededScore = opts.seededScore ?? null;
  if (seededScore !== null) {
    scoreLines.push(
      `<p id="scores-seeded">${esc(seededScoreLine(seededScore))}</p>`,
    );
  }
  const scoresHtml =
    scoreLines.length > 0
      ? `<section id="scores" aria-label="Scores"><h2>Scores</h2>${scoreLines.join("\n")}</section>`
      : "";

  const heroChain = opts.heroChain ?? null;
  const heroChainHtml =
    heroChain === null
      ? ""
      : `<section id="hero-chain"><h2>Hero chain — synthetic slide</h2>` +
        `<p>${heroChain.modelGenerated ? "Model-generated synthetic image (muse-image-1.0)." : "Hand-made synthetic fallback (image generation unavailable)."}` +
        (heroChain.date ? ` Spark read the date: ${esc(heroChain.date)}.` : "") +
        `</p><div class="frame-box">` +
        `<img src="data:image/png;base64,${heroChain.pngBase64}" alt="synthetic vendor slide">` +
        `<div class="region-overlay" data-sam-box="true" style="left:${heroChain.boxPercent.x}%;top:${heroChain.boxPercent.y}%;width:${heroChain.boxPercent.w}%;height:${heroChain.boxPercent.h}%"></div>` +
        `</div></section>`;

  const payload = opts.payloadDemo;
  const payloadHtml = payload
    ? `<section id="what-left-this-server"><h2>Example payload</h2><p>Example payload (recorded fixture), not from this session.</p><pre>${esc(payload.maskedText)}</pre>` +
      (payload.note ? `<p>${esc(payload.note)}</p>` : "") +
      `<label>Upload transcript (.vtt): <input type="file" id="upload-vtt" accept=".vtt"></label></section>`
    : `<section id="what-left-this-server"><h2>Example payload</h2><p>Example payload (recorded fixture), not from this session.</p>` +
      `<label>Upload transcript (.vtt): <input type="file" id="upload-vtt" accept=".vtt"></label></section>`;

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
#conflicts,#draft,.category,#flagged,#transcript,#frames,#hero-chain,#what-left-this-server,#scores{background:#fff;border:1px solid #ddd;border-radius:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:1rem;margin:0 0 1rem;min-width:0}
#hero #scores{grid-column:1/-1;margin:0}
#scores p{margin:.25rem 0;font-size:.9rem}
#hero #conflicts,#hero #draft{margin:0;min-width:0}
#conflicts blockquote{margin:.5rem 0 0;padding:.5rem .75rem;border-left:3px solid #8f1d1d;background:#fafafa;border-radius:0 .4rem .4rem 0}
#draft-status{font-weight:600}#draft-text{display:block;width:100%;box-sizing:border-box}#draft label{font-size:.85rem}#draft p{margin:.3rem 0}#draft-advisory{font-size:.8rem;color:#555}
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
${conflictsSection(brief)}
<section id="draft" data-run-id="${esc(draftRunId)}">
<h2>Draft reply</h2>
<p id="draft-status">${esc(heldText(badgeCount))}</p>
<label for="draft-text">Draft reply text</label>
<textarea id="draft-text" rows="2">${draftInitialHtml}</textarea>
<label for="meeting-select">Meeting</label>
<select id="meeting-select">
<option value="${esc(draftMeetingId)}" data-flags="${badgeCount}" data-draft="${draftInitialAttr}" selected>${esc(draftMeetingId)}</option>
<option value="" data-flags="0" data-draft="">blank meeting</option>
</select>
${pressureChecks}
<p class="citations">${pressure.map((p) => p.segmentIds.map((s) => `<a href="#seg-${esc(s)}">[${esc(s)}]</a>`).join(" ")).join(" ")}</p>
<p id="draft-advisory">Commitment checks are advisory.</p>
<button type="button" id="btn-approve">Approve</button>
<button type="button" id="btn-reject">Reject</button>
<button type="button" id="btn-copy" disabled>Copy</button>
<p id="draft-note"></p>
</section>
${scoresHtml}
</section>
${glimmerRunsHtml}
${categoryHtml}
${flaggedHtml}
<section id="transcript"><h2>Transcript</h2><ol id="transcript-lines">${segmentHtml}</ol></section>
<section id="frames"><h2>Frames</h2>${frameHtml}</section>
${heroChainHtml}
${payloadHtml}
<footer>Second Seat never sends a reply to the vendor.</footer>
<script type="application/json" id="transcript-data">${transcriptJson}</script>
<script>
(function(){
function hashDraft(text){var h=0x811c9dc5;for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(16);}
var section=document.getElementById("draft");
var meetingSelect=document.getElementById("meeting-select");
var draftText=document.getElementById("draft-text");
var approveBtn=document.getElementById("btn-approve");
var copyBtn=document.getElementById("btn-copy");
var note=document.getElementById("draft-note");
var status=document.getElementById("draft-status");
var state={meetingId:meetingSelect.value,runId:section.getAttribute("data-run-id")||"demo-run",draft:draftText.value,approval:null};
function selectedOption(){if(meetingSelect.selectedOptions&&meetingSelect.selectedOptions[0]){return meetingSelect.selectedOptions[0];}return meetingSelect.options[meetingSelect.selectedIndex];}
function isApproved(){return state.approval!==null&&state.approval.draftHash===hashDraft(state.draft)&&state.approval.runId===state.runId&&state.approval.meetingId===state.meetingId;}
function refresh(){
  var boxes=Array.prototype.slice.call(document.querySelectorAll(".pressure-review"));
  var opt=selectedOption();
  var zeroFlags=opt&&opt.getAttribute("data-flags")==="0";
  var allReviewed=boxes.every(function(b){return b.checked;});
  var approved=isApproved();
  approveBtn.disabled=!(zeroFlags||allReviewed)||approved;
  copyBtn.disabled=!approved;
  if(approved){status.textContent="Approved \u2014 copy and send it yourself.";}
  else{var n=document.querySelectorAll(".pressure-badge").length;status.textContent="Held: review the "+n+" pressure item"+(n===1?"":"s")+" first";}
}
approveBtn.addEventListener("click",function(){
  state.draft=draftText.value;state.approval={draftHash:hashDraft(state.draft),runId:state.runId,meetingId:state.meetingId};note.textContent="Approved locally. Nothing was sent.";refresh();
});
document.getElementById("btn-reject").addEventListener("click",function(){
  state.approval=null;note.textContent="Rejected locally. Nothing was sent.";refresh();
});
draftText.addEventListener("input",function(){
  state.draft=draftText.value;state.approval=null;refresh();
});
meetingSelect.addEventListener("change",function(){
  var opt=selectedOption();
  state.meetingId=meetingSelect.value;state.draft=(opt&&opt.getAttribute("data-draft"))||"";draftText.value=state.draft;state.approval=null;note.textContent="Meeting changed locally. Approval cancelled.";refresh();
});
Array.prototype.forEach.call(document.querySelectorAll(".pressure-review"),function(b){
  b.addEventListener("change",refresh);
});
copyBtn.addEventListener("click",function(){
  if(!isApproved()){return;}
  var text=draftText.value;
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

export type SessionPageSnapshot = {
  state: string;
  reason?: string;
  segments: { id: string; text: string }[];
  redactedText: string;
  approved: boolean;
  result: { offline: boolean; entries: { kind: string; text: string; segmentIds: string[] }[] } | null;
  payload: { approvedText: string; status: string } | null;
  offline: boolean;
};

export function sessionStateLabel(snap: SessionPageSnapshot): string {
  switch (snap.state) {
    case "input": return "Input — paste a transcript to begin.";
    case "redaction_pending": return "Redaction pending…";
    case "review_required": return "Review required — check the redacted preview, then approve.";
    case "approved": return "Approved — ready to analyze.";
    case "analysis_pending": return "Analysis pending…";
    case "completed": return "Completed — findings below.";
    case "blocked": return `Blocked — ${snap.reason ?? "a policy or approval check refused the request"}`;
    case "error": return snap.reason ? `Error — ${snap.reason}` : "Error — something went wrong.";
    default: return snap.state;
  }
}

function sessionFindingsHtml(snap: SessionPageSnapshot): string {
  if (snap.result === null) {
    return `<p id="empty-state">No findings yet — paste a transcript and run analysis.</p>`;
  }
  if (snap.result.entries.length === 0) {
    return `<p id="empty-state">No findings in the approved transcript.</p>`;
  }
  return snap.result.entries
    .map(
      (e, i) =>
        `<article class="result" id="result-${i}"><p>${esc(e.text)}</p>` +
        `<p class="citations">${e.segmentIds.map((id) => `<a href="#${esc(id)}">[${esc(id)}]</a>`).join(" ")}</p></article>`,
    )
    .join("\n");
}

function sessionPayloadHtml(snap: SessionPageSnapshot): string {
  if (snap.payload === null) {
    return `<pre id="payload-text"></pre><p id="payload-status">Not prepared yet</p>`;
  }
  const status = snap.payload.status === "sent" ? "Sent to analyzer" : "Prepared — not sent";
  return `<pre id="payload-text">${esc(snap.payload.approvedText)}</pre><p id="payload-status">${status}</p>`;
}

export function renderSessionPage(snap: SessionPageSnapshot): string {
  const canRedact = snap.state !== "redaction_pending" && snap.state !== "analysis_pending";
  const dis = (off: boolean): string => (off ? " disabled" : "");
  const segmentHtml = snap.segments
    .map((s) => `<li id="${esc(s.id)}">${esc(s.text)}</li>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session — Second Seat</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;line-height:1.5;color:#1a1a1a;background:#f7f7f5}
h1{font-size:1.5rem;margin:.5rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem}
section{background:#fff;border:1px solid #ddd;border-radius:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:1rem;margin:0 0 1rem}
textarea{width:100%;font:inherit}
pre{white-space:pre-wrap;word-break:break-word}
button{margin:.25rem;padding:.4rem .9rem;font:inherit}
</style>
</head>
<body>
<h1>Vendor brief — session</h1>
${snap.offline ? `<p id="offline-label">Offline demo</p>` : ""}
<p id="session-state" role="status">${esc(sessionStateLabel(snap))}</p>
<section id="input-section" aria-label="Transcript input">
<h2>Transcript</h2>
<label>Paste transcript:<textarea id="transcript-input" rows="4" cols="60"></textarea></label>
<div><button type="button" id="btn-redact"${dis(!canRedact)}>Redact</button></div>
<label>Redacted preview (editable):<textarea id="redacted-text" rows="4" cols="60">${esc(snap.redactedText)}</textarea></label>
<div><button type="button" id="btn-approve"${dis(snap.state !== "review_required")}>Approve</button>
<button type="button" id="btn-analyze"${dis(snap.state !== "approved" && snap.state !== "completed")}>Analyze</button></div>
</section>
<section id="findings" aria-label="Findings"><h2>Findings</h2><div id="results">${sessionFindingsHtml(snap)}</div></section>
<section id="transcript" aria-label="Approved transcript"><h2>Approved transcript segments</h2><ol id="segments">${segmentHtml}</ol></section>
<section id="payload-panel" aria-label="Payload"><h2>Payload</h2>${sessionPayloadHtml(snap)}</section>
<footer>Second Seat never sends a reply to the vendor.</footer>
<script>
(function(){
var sessionId=null,pending=false,lastRedacted="";
var input=document.getElementById("transcript-input"),redacted=document.getElementById("redacted-text");
var btnRedact=document.getElementById("btn-redact"),btnApprove=document.getElementById("btn-approve"),btnAnalyze=document.getElementById("btn-analyze");
var stateEl=document.getElementById("session-state"),resultsEl=document.getElementById("results");
var segmentsEl=document.getElementById("segments"),payloadText=document.getElementById("payload-text"),payloadStatus=document.getElementById("payload-status");
var offlineLabel=document.getElementById("offline-label");
var LABELS={"input":"Input — paste a transcript to begin.","redaction_pending":"Redaction pending…","review_required":"Review required — check the redacted preview, then approve.","approved":"Approved — ready to analyze.","analysis_pending":"Analysis pending…","completed":"Completed — findings below."};
function labelFor(s){if(s.state==="blocked")return "Blocked — "+(s.reason||"a policy or approval check refused the request");if(s.state==="error")return s.reason?("Error — "+s.reason):"Error — something went wrong.";return LABELS[s.state]||s.state;}
function el(tag,attrs,text){var n=document.createElement(tag);for(var k in attrs){n.setAttribute(k,attrs[k]);}if(text!==undefined)n.textContent=text;return n;}
function render(s){
  stateEl.textContent=labelFor(s);
  if(offlineLabel)offlineLabel.hidden=!s.offline;
  lastRedacted=s.redactedText||"";if(document.activeElement!==redacted)redacted.value=lastRedacted;
  var canRedact=s.state!=="redaction_pending"&&s.state!=="analysis_pending";
  btnRedact.disabled=pending||!canRedact||!input.value.trim();
  btnApprove.disabled=pending||s.state!=="review_required";
  btnAnalyze.disabled=pending||(s.state!=="approved"&&s.state!=="completed");
  while(segmentsEl.firstChild)segmentsEl.removeChild(segmentsEl.firstChild);
  (s.segments||[]).forEach(function(g){segmentsEl.appendChild(el("li",{id:g.id},g.text));});
  while(resultsEl.firstChild)resultsEl.removeChild(resultsEl.firstChild);
  if(!s.result){resultsEl.appendChild(el("p",{id:"empty-state"},"No findings yet — paste a transcript and run analysis."));}
  else if(s.result.entries.length===0){resultsEl.appendChild(el("p",{id:"empty-state"},"No findings in the approved transcript."));}
  else{s.result.entries.forEach(function(e,i){
    var a=el("article",{"class":"result",id:"result-"+i});
    a.appendChild(el("p",{},e.text));
    var c=el("p",{"class":"citations"});
    (e.segmentIds||[]).forEach(function(id){var link=el("a",{href:"#"+id},"["+id+"]");c.appendChild(link);c.appendChild(document.createTextNode(" "));});
    a.appendChild(c);resultsEl.appendChild(a);});}
  if(!s.payload){payloadText.textContent="";payloadStatus.textContent="Not prepared yet";}
  else{payloadText.textContent=s.payload.approvedText;payloadStatus.textContent=s.payload.status==="sent"?"Sent to analyzer":"Prepared — not sent";}
}
function call(path,body){return fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(b){return {ok:r.ok,body:b};});});}
function refresh(){if(!sessionId)return;pending=true;updateButtons();fetch("/api/session/state?sessionId="+encodeURIComponent(sessionId)).then(function(r){return r.json();}).then(function(s){pending=false;render(s);}).catch(function(){pending=false;updateButtons();});}
function updateButtons(){btnRedact.disabled=true;btnApprove.disabled=true;btnAnalyze.disabled=true;}
function run(promise){pending=true;updateButtons();return promise.then(function(r){pending=false;if(r.ok)render(r.body);else if(r.body&&r.body.state)render(r.body);else refresh();}).catch(function(){pending=false;refresh();});}
var deb=null;
input.addEventListener("input",function(){btnRedact.disabled=pending||!input.value.trim();if(deb)clearTimeout(deb);deb=setTimeout(function(){if(!sessionId||!input.value.trim())return;run(call("/api/session/transcript",{sessionId:sessionId,text:input.value}));},300);});
btnRedact.addEventListener("click",function(){if(btnRedact.disabled||!sessionId)return;if(deb){clearTimeout(deb);deb=null;}pending=true;updateButtons();run(call("/api/session/transcript",{sessionId:sessionId,text:input.value}).then(function(t){if(!t.ok)return t;return call("/api/session/redact",{sessionId:sessionId});}));});
/* corrections are sent with Approve (avoids blur/click race) */
btnApprove.addEventListener("click",function(){if(btnApprove.disabled)return;var txt=redacted.value,needs=txt!==lastRedacted;pending=true;updateButtons();run((needs?call("/api/session/correct",{sessionId:sessionId,text:txt}):Promise.resolve({ok:true})).then(function(c){if(!c.ok)return c;return call("/api/session/approve",{sessionId:sessionId});}));});
btnAnalyze.addEventListener("click",function(){if(btnAnalyze.disabled)return;run(call("/api/session/analyze",{sessionId:sessionId}));});
fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(function(r){return r.json();}).then(function(b){sessionId=b.sessionId;refresh();});
})();
</script>
</body>
</html>`;
}
