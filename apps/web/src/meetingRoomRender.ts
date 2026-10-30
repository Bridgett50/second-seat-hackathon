// Server-rendered twin meeting room page (session B2).
//
// Plain TypeScript returning HTML strings, like render.ts. All dynamic text
// and attribute values are escaped with the local `esc`. T2 labels come only
// from `@second-seat/bot/dist/src/t2-room.js`; the snapshot type comes from
// `./meetingRoom.js`. No frameworks, no dependencies, no external resources.

import {
  A11Y_LABELS,
  A11Y_LIVE_REGION,
  A11Y_REGION_ORDER,
  MAILTO_LABEL,
  pluginControlId,
  pluginControlLabel,
} from "@second-seat/bot/dist/src/t2-room.js";
import { THEME_CSS } from "./theme.js";
import type { MeetingRoomSnapshot } from "./meetingRoom.js";

/** Escape dynamic text and attribute values for HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headingFor(region: string, snap: MeetingRoomSnapshot): string {
  switch (region) {
    case "meeting":
      return snap.view.twinIdentity;
    case "demo":
      return "Guided demo";
    case "stream":
      return "Live transcript";
    case "guidance":
      return "Guide the twin";
    case "takeover":
      return "Take over";
    case "package":
      return "Draft follow-up package";
    case "plugins":
      return "Plugins";
    case "approval":
      return "Approve and send";
    case "compare":
      return "Imported email comparison";
    case "evidence":
      return "Evidence record";
    default:
      return region;
  }
}

function sectionOpen(region: string): string {
  return `<section aria-labelledby="mr-${region}-heading">` +
    `<h2 id="mr-${region}-heading">`;
}

function meetingSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const options = view.meetings
    .map(
      (m) =>
        `<option value="${esc(m.id)}"${m.id === view.selectedMeetingId ? " selected" : ""}>${esc(m.title)}</option>`,
    )
    .join("");
  const restored = snap.restored
    ? `<p>Restored from the shared room store (draft, send state and approval stay while this server keeps the room).</p>`
    : "";
  return (
    `${sectionOpen("meeting")}${esc(headingFor("meeting", snap))}</h2>` +
    `<p>Owner: ${esc(view.ownerName)} · Meeting: ${esc(view.selectedMeetingTitle)} · Twin: ${esc(view.twinStatus)}</p>` +
    restored +
    `<label>Meeting:<select id="meeting-picker" aria-label="${esc(A11Y_LABELS["meeting-picker"])}" data-mr-action="select-meeting">${options}</select></label>` +
    `</section>`
  );
}

function demoSection(snap: MeetingRoomSnapshot): string {
  const demo = snap.demo;
  if (demo === null) return "";
  const label = demo.stepLabel ?? "Demo complete";
  const caption = demo.done ? "Demo complete" : (demo.caption ?? "");
  const dis = demo.done ? " disabled" : "";
  return (
    `${sectionOpen("demo")}${esc(headingFor("demo", snap))}</h2>` +
    `<p>Synthetic walkthrough of the twin room. Nothing here is real data and nothing is really sent.</p>` +
    `<p id="demo-status" role="status" aria-label="${esc(label)}">${esc(caption)}</p>` +
    `<p id="demo-progress">${demo.completed} / ${demo.total}</p>` +
    (demo.sendNote === null ? "" : `<p id="demo-send-note" role="note">${esc(demo.sendNote)}</p>`) +
    `<div><button type="button" id="demo-next" aria-label="${esc(A11Y_LABELS["demo-next"])}" data-mr-action="demo-next"${dis}>Next step</button> ` +
    `<button type="button" id="demo-restart" aria-label="${esc(A11Y_LABELS["demo-restart"])}" data-mr-action="demo-restart">Restart demo</button></div>` +
    `<p>Shortcuts: Right arrow or N advances one step, R restarts. Keys typed in inputs are ignored.</p>` +
    `</section>`
  );
}

function streamSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const steered = new Set(view.steeredLines);
  const items = view.transcript
    .map(
      (line, i) =>
        `<li>${esc(line)}${steered.has(i) ? ` <span>· steered by your guidance (private)</span>` : ""}</li>`,
    )
    .join("");
  const empty =
    view.transcript.length === 0
      ? `<p>Waiting for the first scripted line…</p>`
      : "";
  return (
    `${sectionOpen("stream")}${esc(headingFor("stream", snap))}</h2>` +
    empty +
    `<ol id="mr-transcript">${items}</ol>` +
    `<div><button type="button" id="stream-next" aria-label="${esc(A11Y_LABELS["stream-next"])}" data-mr-action="stream-next">Stream next line</button></div>` +
    `</section>`
  );
}

function guidanceSection(snap: MeetingRoomSnapshot): string {
  const items = snap.view.guidance.map((g) => `<li>${esc(g)}</li>`).join("");
  const list =
    snap.view.guidance.length > 0
      ? `<p>Private guidance (only you see this)</p><ul>${items}</ul>`
      : "";
  return (
    `${sectionOpen("guidance")}${esc(headingFor("guidance", snap))}</h2>` +
    `<p>Private guidance for the twin. It stays private to the owner.</p>` +
    `<div><input id="guidance-input" type="text" value="" aria-label="${esc(A11Y_LABELS["guidance-input"])}" placeholder="Guide the twin…"> ` +
    `<button type="button" id="guidance-send" aria-label="${esc(A11Y_LABELS["guidance-send"])}" data-mr-action="guide">Guide</button></div>` +
    list +
    `</section>`
  );
}

function takeoverSection(snap: MeetingRoomSnapshot): string {
  const takenOver = snap.view.twinStatus !== "active";
  const dis = takenOver ? " disabled" : "";
  const note = takenOver ? `<p>You took over. The twin is paused.</p>` : "";
  return (
    `${sectionOpen("takeover")}${esc(headingFor("takeover", snap))}</h2>` +
    `<p>Pause the twin and take over the meeting yourself.</p>` +
    note +
    `<div><button type="button" id="takeover" aria-label="${esc(A11Y_LABELS.takeover)}" data-mr-action="takeover"${dis}>Take over</button></div>` +
    `</section>`
  );
}

function packageSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const locked = view.draft.sendState === "sent";
  const dis = locked ? " disabled" : "";
  const lockNote = locked
    ? `<p>Sent — package locked. Export, edit, and re-approve are disabled; the evidence record below stays.</p>`
    : "";
  const approvalNote =
    snap.approvalNote !== null ? `<p>${esc(snap.approvalNote)}</p>` : "";
  return (
    `${sectionOpen("package")}${esc(headingFor("package", snap))}</h2>` +
    `<p>sha256: ${esc(view.draft.sha256)}</p>` +
    approvalNote +
    lockNote +
    `<p id="package-dirty" hidden>Unsaved edit. Save it, then review and approve before sending.</p>` +
    `<pre>${esc(view.draft.body)}</pre>` +
    `<p id="package-base-note">The editor holds your text only. Included plugin sections are added after it and managed with Include and Exclude; the full package is shown above.</p>` +
    `<label>Draft edit:<textarea id="package-editor" rows="8" cols="60" aria-label="${esc(A11Y_LABELS["package-editor"])}"${dis}>${esc(view.draft.base)}</textarea></label>` +
    `<div><button type="button" id="package-save" aria-label="${esc(A11Y_LABELS["package-save"])}" data-mr-action="edit-draft"${dis}>Save edit</button></div>` +
    `</section>`
  );
}

function pluginsSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const runnable = view.twinStatus === "active" && view.draft.sendState === "unsent";
  const runBtn =
    `<p><button type="button" id="run-plugins" aria-label="${esc(A11Y_LABELS["run-plugins"])}" ` +
    `data-mr-action="run-plugins"${runnable ? "" : " disabled"}>Run plugins</button></p>`;
  const hint =
    view.plugins.length === 0
      ? `<p>No plugin outputs yet. Stream transcript lines, then Run plugins.</p>`
      : "";
  const rows = view.plugins
    .map((p) => {
      const lines = p.lines.length > 0 ? `<pre>${esc([p.title, ...p.lines].join("\n"))}</pre>` : "";
      const status = `<p>Status: ${esc(p.status)}${p.stale ? " · stale: newer lines available" : ""}</p>`;
      const includeBtn =
        `<button type="button" id="${esc(pluginControlId("include", p.id))}" ` +
        `aria-label="${esc(pluginControlLabel("include", p.id))}" ` +
        `data-mr-action="plugin-include" data-mr-id="${esc(p.id)}">Include</button>`;
      const excludeBtn =
        `<button type="button" id="${esc(pluginControlId("exclude", p.id))}" ` +
        `aria-label="${esc(pluginControlLabel("exclude", p.id))}" ` +
        `data-mr-action="plugin-exclude" data-mr-id="${esc(p.id)}">Exclude</button>`;
      const refreshBtn =
        p.status === "approved" && p.stale
          ? ` <button type="button" id="${esc(pluginControlId("refresh", p.id))}" ` +
            `aria-label="${esc(pluginControlLabel("refresh", p.id))}" ` +
            `data-mr-action="plugin-refresh" data-mr-id="${esc(p.id)}">Refresh</button>`
          : "";
      return (
        `<div><p>${esc(p.label)}</p>` +
        lines +
        status +
        `<div>${includeBtn} ${excludeBtn}${refreshBtn}</div></div>`
      );
    })
    .join("");
  return (
    `${sectionOpen("plugins")}${esc(headingFor("plugins", snap))}</h2>` +
    `<p>Synthetic local-only helpers. Proposed outputs are excluded from the package until the owner includes them.</p>` +
    runBtn +
    hint +
    rows +
    `</section>`
  );
}

function approvalSection(snap: MeetingRoomSnapshot): string {
  const view = snap.view;
  const approved = view.draft.approved ? "yes" : "no";
  const locked = view.draft.sendState === "sent";
  const dis = locked ? " disabled" : "";
  const refusal = view.refusal !== null ? `<p>${esc(view.refusal)}</p>` : "";
  const approvalNote =
    snap.approvalNote !== null ? `<p>${esc(snap.approvalNote)}</p>` : "";
  const sendNote = snap.fakeSend
    ? ""
    : `<p>Sending is disabled outside test mode. The server refuses send requests.</p>`;
  return (
    `${sectionOpen("approval")}${esc(headingFor("approval", snap))}</h2>` +
    `<p id="mr-approval-state">Approved: ${approved} · Send: ${esc(view.draft.sendState)}</p>` +
    `<p>sha256: ${esc(view.draft.sha256)}</p>` +
    approvalNote +
    refusal +
    sendNote +
    `<div><button type="button" id="approve" aria-label="${esc(A11Y_LABELS.approve)}" data-mr-action="approve" data-mr-package="${esc(snap.packageId)}"${dis}>Approve</button> ` +
    `<button type="button" id="send" aria-label="${esc(A11Y_LABELS.send)}" data-mr-action="send" data-mr-package="${esc(snap.packageId)}">Send (test fake transport)</button></div>` +
    (snap.sendNotice
      ? `<p id="send-notice" role="alert" class="mr-send-notice">${esc(snap.sendNotice)}</p>`
      : "") +
    `</section>`
  );
}

/** The guided step-7 comparison kept in the snapshot, in the same <pre> form the client shows. */
function keptComparisonHtml(snap: MeetingRoomSnapshot): string {
  const kept = snap.demo?.comparison;
  return kept === undefined || kept === null ? "" : `<pre>${esc(JSON.stringify(kept, null, 2))}</pre>`;
}

function compareSection(snap: MeetingRoomSnapshot): string {
  return (
    `${sectionOpen("compare")}${esc(headingFor("compare", snap))}</h2>` +
    `<p>Synthetic draft import only — paste text or read a local file. Compare sends this text to this app's server; this demo does not call an external model or send email.</p>` +
    `<label>Imported draft:<textarea id="compare-input" rows="6" cols="60" aria-label="${esc(A11Y_LABELS["compare-input"])}"></textarea></label>` +
    `<div><input id="compare-file" type="file" accept=".txt,.eml,text/plain" aria-label="${esc(A11Y_LABELS["compare-file"])}"> ` +
    `<button type="button" id="compare-run" aria-label="${esc(A11Y_LABELS["compare-run"])}" data-mr-action="compare">Compare</button></div>` +
    `<div id="compare-result">${keptComparisonHtml(snap)}</div>` +
    `</section>`
  );
}

function evidenceSection(snap: MeetingRoomSnapshot): string {
  const copy =
    snap.copyText !== null ? `<p id="evidence-copy">${esc(snap.copyText)}</p>` : "";
  const mailto =
    snap.mailtoHref !== null
      ? `<p><a id="evidence-mailto" href="${esc(snap.mailtoHref)}">${esc(MAILTO_LABEL)}</a></p>`
      : "";
  return (
    `${sectionOpen("evidence")}${esc(headingFor("evidence", snap))}</h2>` +
    `<p>Local saved record for the selected meeting\u2019s approved package. Synthetic data only.</p>` +
    `<div><button type="button" id="evidence-export" aria-label="${esc(A11Y_LABELS["evidence-export"])}" data-mr-action="evidence-export">Export evidence JSON</button></div>` +
    `<pre id="evidence-json">${esc(snap.demo?.evidenceJson ?? "")}</pre>` +
    copy +
    mailto +
    `</section>`
  );
}

function sectionFor(region: string, snap: MeetingRoomSnapshot): string {
  switch (region) {
    case "meeting":
      return meetingSection(snap);
    case "demo":
      return demoSection(snap);
    case "stream":
      return streamSection(snap);
    case "guidance":
      return guidanceSection(snap);
    case "takeover":
      return takeoverSection(snap);
    case "package":
      return packageSection(snap);
    case "plugins":
      return pluginsSection(snap);
    case "approval":
      return approvalSection(snap);
    case "evidence":
      return evidenceSection(snap);
    default:
      return "";
  }
}

/**
 * The inner HTML of `<div id="mr-root" data-room-id="...">`, re-rendered
 * after each action. Region sections follow A11Y_REGION_ORDER (the demo
 * section only when `snap.demo !== null`), with the imported-email
 * comparison section between approval and evidence.
 */
export function renderMeetingRoomBody(snap: MeetingRoomSnapshot): string {
  const parts: string[] = [];
  for (const region of A11Y_REGION_ORDER) {
    const html = sectionFor(region, snap);
    if (html !== "") parts.push(html);
    if (region === "approval") parts.push(compareSection(snap));
  }
  return parts.join("\n");
}

const CLIENT_JS = `(function(){
"use strict";
var root=document.getElementById("mr-root");
var live=document.getElementById("mr-live");
if(!root||!live){return;}
var roomId=root.getAttribute("data-room-id")||"";
function say(msgs){
  live.textContent="";
  for(var i=0;i<msgs.length;i+=1){
    var p=document.createElement("p");
    p.textContent=msgs[i];
    live.appendChild(p);
  }
}
function fieldValue(id){
  var el=document.getElementById(id);
  return el?el.value:"";
}
var seq=0;
var dirty=false;
var OUTGOING={"approve":true,"send":true,"evidence-export":true};
function lockOutgoing(){
  var ids=["approve","send","evidence-export"];
  for(var i=0;i<ids.length;i+=1){
    var b=document.getElementById(ids[i]);
    if(b){b.disabled=true;}
  }
  var gone=["evidence-copy","evidence-mailto","evidence-download"];
  for(var j=0;j<gone.length;j+=1){
    var el=document.getElementById(gone[j]);
    if(el&&el.parentNode){el.parentNode.removeChild(el);}
  }
  var pre=document.getElementById("evidence-json");
  if(pre){pre.textContent="";}
  var note=document.getElementById("package-dirty");
  if(note){note.hidden=false;}
}
function post(action,extra){
  seq+=1;
  var mine=seq;
  var body={roomId:roomId,action:action};
  if(extra){for(var k in extra){if(Object.prototype.hasOwnProperty.call(extra,k)){body[k]=extra[k];}}}
  return fetch("/api/meeting-room",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){
    return r.json().then(function(b){
      if(mine!==seq){return null;}
      return{ok:r.ok,status:r.status,body:b};
    });
  });
}
function showComparison(box,c){
  box.textContent="";
  if(c===null||c===undefined){
    var p=document.createElement("p");
    p.textContent="No approved package for the selected meeting yet. Approve the draft first, then compare.";
    box.appendChild(p);
    return;
  }
  var pre=document.createElement("pre");
  pre.textContent=JSON.stringify(c,null,2);
  box.appendChild(pre);
}
function applyResult(action,res){
  if(res===null){return;}
  var b=(res&&res.body)||{};
  if(typeof b.html==="string"){
    var keep=null;
    if(dirty&&!(action==="edit-draft"&&res.ok)){
      var ed0=document.getElementById("package-editor");
      keep=ed0?ed0.value:"";
    }
    root.innerHTML=b.html;
    var nr=root.getAttribute("data-room-id");
    if(nr){roomId=nr;}
    if(keep!==null){
      var ed1=document.getElementById("package-editor");
      if(ed1){ed1.value=keep;}
      lockOutgoing();
    }else{
      dirty=false;
    }
  }
  if(Array.isArray(b.announcements)){say(b.announcements);}
  if(action==="guide"&&res&&res.ok){
    var g=document.getElementById("guidance-input");
    if(g){g.value="";}
  }
  if(typeof b.evidenceJson==="string"){
    var pre2=document.getElementById("evidence-json");
    if(pre2){
      pre2.textContent=b.evidenceJson;
      var link=document.getElementById("evidence-download");
      if(!link){
        link=document.createElement("a");
        link.id="evidence-download";
        if(pre2.parentNode){pre2.parentNode.insertBefore(link,pre2.nextSibling);}
      }
      link.href=URL.createObjectURL(new Blob([b.evidenceJson],{type:"application/json"}));
      link.download="evidence.json";
      link.textContent="Download evidence JSON";
    }
  }
  if(b&&Object.prototype.hasOwnProperty.call(b,"comparison")){
    var box=document.getElementById("compare-result");
    if(box){showComparison(box,b.comparison);}
  }
}
document.addEventListener("click",function(e){
  var t=e.target;
  while(t&&t!==document){
    if(t.hasAttribute&&t.hasAttribute("data-mr-action")){break;}
    t=t.parentNode;
  }
  if(!t||t===document){return;}
  var action=t.getAttribute("data-mr-action");
  if(!action){return;}
  if(dirty&&OUTGOING[action]){return;}
  var extra={};
  if(action==="approve"||action==="send"){
    var pk=t.getAttribute("data-mr-package");
    if(pk){extra.packageId=pk;}
  }
  if(action==="guide"){extra.text=fieldValue("guidance-input");}
  else if(action==="edit-draft"){extra.text=fieldValue("package-editor");}
  else if(action==="compare"){extra.text=fieldValue("compare-input");}
  else if(action==="plugin-include"||action==="plugin-exclude"||action==="plugin-refresh"){
    var pid=t.getAttribute("data-mr-id");
    if(pid){extra.id=pid;}
  }
  post(action,extra).then(function(res){applyResult(action,res);});
});
document.addEventListener("input",function(e){
  var t=e.target;
  if(t&&t.id==="package-editor"){
    dirty=true;
    seq+=1;
    lockOutgoing();
  }
});
document.addEventListener("change",function(e){
  var t=e.target;
  if(!t||!t.id){return;}
  if(t.id==="meeting-picker"){
    post("select-meeting",{id:t.value}).then(function(res){applyResult("select-meeting",res);});
    return;
  }
  if(t.id==="compare-file"){
    var f=t.files&&t.files[0];
    if(!f){return;}
    var r=new FileReader();
    r.onload=function(){
      if(typeof r.result==="string"){
        var ci=document.getElementById("compare-input");
        if(ci){ci.value=r.result;}
      }
    };
    r.readAsText(f);
  }
});
document.addEventListener("keydown",function(e){
  var t=e.target;
  var tag=t&&t.tagName?String(t.tagName).toUpperCase():"";
  if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||(t&&t.isContentEditable)){return;}
  if(e.ctrlKey||e.metaKey||e.altKey){return;}
  var next=document.getElementById("demo-next");
  var restart=document.getElementById("demo-restart");
  if(!next&&!restart){return;}
  if(e.key==="ArrowRight"||e.key==="n"){
    if(next&&!next.disabled){e.preventDefault();next.click();}
  }else if(e.key==="r"){
    if(restart){e.preventDefault();restart.click();}
  }
});
})();`;

/** Full `<!DOCTYPE html>` meeting room document with one main landmark. */
export function renderMeetingRoomPage(snap: MeetingRoomSnapshot): string {
  const body = renderMeetingRoomBody(snap);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meeting room — Second Seat</title>
<link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;line-height:1.5;color:#1a1a1a;background:#f7f7f5}
h1{font-size:1.5rem;margin:.5rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem}
section{background:#fff;border:1px solid #ddd;border-radius:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:1rem;margin:0 0 1rem}
textarea{width:100%;font:inherit}
pre{white-space:pre-wrap;word-break:break-word}
button{margin:.25rem;padding:.45rem 1rem;font:inherit;border-radius:.5rem;border:1px solid #c8c8c8;background:#fff;color:#1a1a1a;cursor:pointer}
button:disabled{opacity:.45;cursor:not-allowed}
${THEME_CSS}</style>
</head>
<body>
<main>
<h1>Twin meeting room</h1>
<div id="mr-live" role="${A11Y_LIVE_REGION.role}" aria-live="${A11Y_LIVE_REGION.ariaLive}" aria-label="Meeting room announcements"></div>
<div id="mr-root" data-room-id="${esc(snap.roomId)}">${body}</div>
</main>
<script>
${CLIENT_JS}
</script>
</body>
</html>`;
}
