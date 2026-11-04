import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readMeetCaptionRows } from "./meetCaptionReader.js";
const CANON = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
function parseMeetUrl(u: string): string | null {
  try {
    const p = new URL(u);
    if (p.protocol !== "https:" || p.hostname !== "meet.google.com" || p.username || p.password || p.port || p.hash) return null;
    const m1 = p.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/);
    const m2 = p.pathname.match(/^\/meet\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/);
    const code = m1?.[1] ?? m2?.[1] ?? null;
    if (code === null) return null;
    if (p.search === "" || p.search === "?pli=1") return `https://meet.google.com/${code}`;
    return null;
  } catch { return null; }
}
type CapsuleNode = { readonly children: ArrayLike<CapsuleNode>; readonly tagName: string; readonly classList: { contains(c: string): boolean }; querySelectorAll(s: string): ArrayLike<CapsuleNode>; readonly offsetParent: unknown; readonly innerText: string };
type WrappedEvent = Readonly<{ event: Readonly<{ version: 1; meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }>; verified: false }>;
export function createMeetCaptionBuffer(opts: { page: Page; meetingUrl: string; meetingId: string; signal: AbortSignal; isCurrent: () => boolean }): Readonly<{ sample: () => Promise<readonly WrappedEvent[]>; stop: () => void }> {
  const page = opts.page;
  const signal = opts.signal;
  const isCurrent = opts.isCurrent;
  const meetingId = opts.meetingId;
  const meetingUrl = opts.meetingUrl;
  if (typeof meetingId !== "string" || meetingId.trim() === "" || meetingId.length > 200) throw new Error("invalid meetingId");
  if (typeof meetingUrl !== "string" || !CANON.test(meetingUrl)) throw new Error("invalid meetingUrl");
  const namespace = randomUUID();
  let stopped = false;
  let busy = false;
  let seqCounter = 0;
  let totalKnown = 0;
  const known = new Map<string, { sequence: number; revision: number; speaker: string; text: string }>();
  const guard = (): boolean => {
    if (stopped) return false;
    if (signal.aborted) return false;
    if (isCurrent() !== true) return false;
    const cur = parseMeetUrl(page.url());
    return cur !== null && cur === meetingUrl;
  };
  const freezeEmpty = (): readonly WrappedEvent[] => Object.freeze([] as WrappedEvent[]);
  const stop = (): void => { stopped = true; known.clear(); };
  const sample = async (): Promise<readonly WrappedEvent[]> => {
    if (busy) return freezeEmpty();
    busy = true;
    try {
      if (stopped || signal.aborted || isCurrent() !== true) { stop(); return freezeEmpty(); }
      if (!guard()) { stop(); return freezeEmpty(); }
      let rows: readonly Readonly<{ rowIndex: number; speaker: string; text: string; verified: false }>[];
      try { rows = await readMeetCaptionRows(page, { meetingUrl }, signal, guard); } catch { return freezeEmpty(); }
      if (!guard()) { stop(); return freezeEmpty(); }
      if (rows.length === 0) return freezeEmpty();
      const expectedRows: readonly { speaker: string; text: string }[] = rows.map((r) => ({ speaker: r.speaker, text: r.text }));
      let matched: { rowKeys: string[]; rows: { speaker: string; text: string }[]; counter: number } | null;
      try {
        const region = (page as unknown as { locator: (s: string) => { evaluate: (fn: (el: unknown, arg: unknown) => unknown, arg: unknown) => Promise<unknown> } }).locator('[role="region"][aria-label="Captions"]');
        if (!guard()) { stop(); return freezeEmpty(); }
        const res = await region.evaluate((regionEl: unknown, arg: unknown) => {
          const a = arg as { expectedRows: { speaker: string; text: string }[]; namespace: string };
          const el = regionEl as CapsuleNode;
          const g = globalThis as unknown as Record<string, unknown> & { getComputedStyle?: (e: CapsuleNode) => { display: string; visibility: string } };
          const storeKey = "__meetCaptionBuffer_" + a.namespace;
          type Store = { wm: WeakMap<object, string>; counter: number };
          let store = g[storeKey] as Store | undefined;
          if (!store) { store = { wm: new WeakMap(), counter: 0 }; g[storeKey] = store; }
          const getStyle = g.getComputedStyle as (e: CapsuleNode) => { display: string; visibility: string };
          const isVis = (n: CapsuleNode): boolean => {
            if (!n.offsetParent) return false;
            const s = getStyle(n);
            return s.display !== "none" && s.visibility !== "hidden";
          };
          const domRows = Array.from(el.children).filter((c) => c.tagName === "DIV" && c.classList.contains("nMcdL"));
          if (domRows.length !== a.expectedRows.length) return null;
          const out: { speaker: string; text: string }[] = [];
          for (let i = 0; i < domRows.length; i++) {
            const r = domRows[i] as CapsuleNode;
            const exp = a.expectedRows[i] as { speaker: string; text: string };
            if (!isVis(r)) return null;
            const headers = r.querySelectorAll(":scope > div.adE6rb");
            const texts = r.querySelectorAll(":scope > div.ygicle");
            if (headers.length !== 1 || texts.length !== 1) return null;
            const h = headers[0] as CapsuleNode;
            const t = texts[0] as CapsuleNode;
            if (!isVis(h) || !isVis(t)) return null;
            const spEls = h.querySelectorAll("div.KcIKyf");
            if (spEls.length !== 1) return null;
            const spEl = spEls[0] as CapsuleNode;
            if (!isVis(spEl)) return null;
            const speaker = (spEl.innerText as string).trim();
            const text = (t.innerText as string).trim();
            if (speaker !== exp.speaker || text !== exp.text) return null;
            out.push({ speaker, text });
          }
          const rowKeys: string[] = [];
          for (let i = 0; i < domRows.length; i++) {
            const node = domRows[i] as unknown as object;
            let k = store.wm.get(node);
            if (!k) { store.counter += 1; k = a.namespace + "#" + String(store.counter); store.wm.set(node, k); }
            rowKeys.push(k);
          }
          return { rowKeys, rows: out, counter: store.counter };
        }, { expectedRows: expectedRows as { speaker: string; text: string }[], namespace });
        matched = res as typeof matched;
      } catch { return freezeEmpty(); }
      if (!guard()) { stop(); return freezeEmpty(); }
      if (!matched || !matched.rowKeys || matched.rowKeys.length !== rows.length) return freezeEmpty();
      if (matched.counter > 256) { known.clear(); stopped = true; return freezeEmpty(); }
      const proposedKnown = new Map(known);
      let proposedCounter = seqCounter;
      let proposedTotal = totalKnown;
      const events: WrappedEvent[] = [];
      const seenKeys = new Set<string>();
      for (let i = 0; i < matched.rowKeys.length; i++) {
        const k = matched.rowKeys[i] as string;
        const r = (matched.rows as { speaker: string; text: string }[])[i] as { speaker: string; text: string };
        seenKeys.add(k);
        const prev = proposedKnown.get(k);
        if (!prev) {
          if (proposedTotal >= 256) { known.clear(); stopped = true; return freezeEmpty(); }
          proposedCounter += 1;
          proposedTotal += 1;
          const ev = Object.freeze({ version: 1 as const, meetingId, utteranceId: k, sequence: proposedCounter, revision: 1, speaker: r.speaker, text: r.text });
          events.push(Object.freeze({ event: ev, verified: false as const }));
          proposedKnown.set(k, { sequence: proposedCounter, revision: 1, speaker: r.speaker, text: r.text });
        } else if (prev.speaker !== r.speaker || prev.text !== r.text) {
          const ev = Object.freeze({ version: 1 as const, meetingId, utteranceId: k, sequence: prev.sequence, revision: prev.revision + 1, speaker: r.speaker, text: r.text });
          events.push(Object.freeze({ event: ev, verified: false as const }));
          proposedKnown.set(k, { sequence: prev.sequence, revision: prev.revision + 1, speaker: r.speaker, text: r.text });
        }
      }
      if (!guard()) { stop(); return freezeEmpty(); }
      seqCounter = proposedCounter;
      totalKnown = proposedTotal;
      known.clear();
      for (const [k, v] of proposedKnown) known.set(k, v);
      // retain only keys still conceptually possible: keep all historical keys (removed rows stay) but we already have them in proposedKnown
      // actually we must keep all known including not seen (removed) - proposedKnown already contains them
      return Object.freeze(events);
    } catch { stop(); return freezeEmpty(); } finally { busy = false; }
  };
  return Object.freeze({ sample, stop });
}
