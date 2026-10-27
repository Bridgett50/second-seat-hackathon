import { randomUUID } from "node:crypto";
import { hashDraft } from "./draftApproval.js";
import {
  createPrivacyGate,
  type GatedText,
  type PrivacyGate,
} from "@second-seat/bot/dist/src/private/gate.js";
import { MockRedactor } from "@second-seat/bot/dist/src/private/redact.js";

export type SessionStatus =
  | "input"
  | "redaction_pending"
  | "review_required"
  | "approved"
  | "analysis_pending"
  | "completed"
  | "blocked"
  | "error";

export interface Segment {
  id: string;
  text: string;
}

export interface BriefEntry {
  kind: string;
  text: string;
  segmentIds: string[];
}

export interface AnalysisResult {
  offline: boolean;
  entries: BriefEntry[];
}

export interface PayloadRecord {
  approvedText: string;
  /** "prepared" = approved but no transport ran; "dispatched" = a transport actually ran. */
  status: "prepared" | "dispatched";
  sentAt?: string;
  adapterLabel?: string;
}

export interface SupersededRecord {
  approvedText: string;
  sentAt: string;
  status: "sent";
}

export interface SessionSnapshot {
  state: SessionStatus;
  reason?: string;
  segments: Segment[];
  redactedText: string;
  approved: boolean;
  result: AnalysisResult | null;
  payload: PayloadRecord | null;
  superseded: SupersededRecord | null;
  offline: boolean;
  draft: { text: string; origin: "user"; approved: boolean } | null;
}

export interface DraftRecord {
  text: string;
  origin: "user";
  resultGeneration: number;
  approvedHash: string | null;
}

export type AnalyzerTransport = (approvedText: string) => Promise<unknown>;

/**
 * Live analyzer (e.g. MuseClient): called with the gate-minted GatedText
 * from gate.send, never with a plain string. The gate-approved payload is
 * the sole source of outbound text.
 */
export interface LiveBriefAnalyzer {
  completeBrief(input: {
    meetingId: string;
    transcriptText: GatedText;
    framesSidecarText: GatedText | "";
    fixtureMode: boolean;
  }): Promise<{ rawText: unknown }>;
}

function isLiveAnalyzer(
  analyzer: AnalyzerTransport | LiveBriefAnalyzer,
): analyzer is LiveBriefAnalyzer {
  return typeof (analyzer as LiveBriefAnalyzer).completeBrief === "function";
}

export interface SessionStoreOptions {
  gate?: PrivacyGate;
  redactor?: { redactText: (t: string) => Promise<unknown> } & Record<string, unknown>;
  analyzer?: AnalyzerTransport | LiveBriefAnalyzer;
  analyzerLabel?: string;
  offline?: boolean;
}

interface SessionRecord {
  id: string;
  segments: Segment[];
  rawText: string;
  runId: string | null;
  approvalToken: string | null;
  redactedText: string;
  approved: boolean;
  approvedText: string;
  result: AnalysisResult | null;
  payload: PayloadRecord | null;
  superseded: SupersededRecord | null;
  draft: DraftRecord | null;
  inFlight: { approvedText: string; sentAt: string } | null;
  generation: number;
  state: SessionStatus;
  reason?: string;
  approvalExpired: boolean;
  redactPending: Promise<void> | null;
  analyzePending: Promise<void> | null;
}

const DATE_WORDS =
  /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|monday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|\d{1,2}[/-]\d{1,2})\b/i;

/** Deterministic offline brief derived only from approved text. No hardcoded findings. */
export function buildOfflineBrief(approvedText: string, segments: Segment[]): AnalysisResult {
  const lines = approvedText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const entries: BriefEntry[] = [];
  lines.forEach((line, i) => {
    const segId = segments[i]?.id ?? `seg-${i + 1}`;
    if (line.includes("?")) {
      entries.push({ kind: "question", text: line, segmentIds: [segId] });
    } else if (line.includes("$") || (/\d/.test(line) && DATE_WORDS.test(line))) {
      entries.push({ kind: "commitment", text: line, segmentIds: [segId] });
    }
  });
  return { offline: true, entries };
}

function toAnalysisResult(value: unknown, offline: boolean): AnalysisResult {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { entries?: unknown }).entries)
  ) {
    const raw = (value as { entries: unknown[] }).entries;
    const entries: BriefEntry[] = raw
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e) => ({
        kind: typeof e["kind"] === "string" ? (e["kind"] as string) : "note",
        text: typeof e["text"] === "string" ? (e["text"] as string) : "",
        segmentIds: Array.isArray(e["segmentIds"])
          ? (e["segmentIds"] as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
      }));
    const result = value as { offline?: unknown };
    return {
      offline: typeof result.offline === "boolean" ? (result.offline as boolean) : offline,
      entries,
    };
  }
  return { offline, entries: [] };
}

/**
 * Strict live-analysis validation against the real EvidenceBrief shape
 * (EVIDENCE_BRIEF_JSON_SCHEMA): a top-level object with an entries array;
 * each entry carries string id/text, a category in the schema enum, and a
 * citations array whose objects each carry a string segmentId. Entries map
 * to BriefEntry {kind: category, text, segmentIds: citations' segmentIds}.
 * Anything unexpected throws (the caller records session state "error"):
 * non-JSON handled before this, plus a missing entries array, an entry
 * missing id/text strings or a valid category, a citations list whose
 * objects lack string segmentIds, or a citation id outside the current
 * approved segments. A valid {entries:[]} passes through.
 * (Error texts avoid the gate's blocked-state keywords so failures land
 * in "error", never "blocked".)
 */
const EVIDENCE_CATEGORIES: ReadonlySet<string> = new Set([
  "decision",
  "action_item",
  "unresolved_question",
  "owner_review",
  "source_conflict",
]);

export function toLiveAnalysisResult(value: unknown, validIds: Set<string>): AnalysisResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    throw new Error("live analysis: response is not a JSON object with an entries array");
  }
  const raw = (value as { entries: unknown[] }).entries;
  const entries: BriefEntry[] = raw.map((e, i) => {
    if (typeof e !== "object" || e === null) {
      throw new Error(`live analysis: entry ${i} is not an object`);
    }
    const rec = e as Record<string, unknown>;
    if (typeof rec["id"] !== "string") {
      throw new Error(`live analysis: entry ${i} id must be a string`);
    }
    if (typeof rec["category"] !== "string" || !EVIDENCE_CATEGORIES.has(rec["category"] as string)) {
      throw new Error(`live analysis: entry ${i} category must be one of the schema enum values`);
    }
    if (typeof rec["text"] !== "string") {
      throw new Error(`live analysis: entry ${i} text must be a string`);
    }
    if (!Array.isArray(rec["citations"])) {
      throw new Error(`live analysis: entry ${i} citations must be an array`);
    }
    const segmentIds = (rec["citations"] as unknown[]).map((c, j) => {
      if (
        typeof c !== "object" ||
        c === null ||
        typeof (c as Record<string, unknown>)["segmentId"] !== "string"
      ) {
        throw new Error(`live analysis: entry ${i} citation ${j} segmentId must be a string`);
      }
      return (c as Record<string, unknown>)["segmentId"] as string;
    });
    for (const id of segmentIds) {
      if (!validIds.has(id)) {
        throw new Error(`live analysis: entry ${i} cites unknown segment ${id}`);
      }
    }
    return {
      kind: rec["category"] as string,
      text: rec["text"] as string,
      segmentIds,
    };
  });
  return { offline: false, entries };
}

const SESSION_TEST_MODE = process.env.SECOND_SEAT_TEST_MODE === "1";

function redactTimeoutMs(): number {
  if (SESSION_TEST_MODE) return 500;
  const raw = process.env.SECOND_SEAT_REDACT_TIMEOUT_MS ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 30000;
}

function withRedactTimeout<T>(promise: Promise<T>): Promise<T> {
  const ms = redactTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`redaction timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function assertWellFormedRedaction(prepared: unknown): void {
  const p = prepared as { redactedText?: unknown; spans?: unknown } | null;
  if (
    typeof p !== "object" ||
    p === null ||
    typeof p.redactedText !== "string" ||
    !Array.isArray(p.spans)
  ) {
    throw new Error("malformed redactor output: expected { redactedText: string, spans: array }");
  }
  for (const s of p.spans) {
    const span = s as { start?: unknown; end?: unknown; label?: unknown };
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || typeof span.label !== "string") {
      throw new Error("malformed redactor output: every span needs integer start/end and string label");
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapTestRedactor(base: any): any {
  return {
    label: "test-fake",
    redactText: async (text: string): Promise<unknown> => {
      if (text.includes("[[fault:malformed]]")) {
        return { maskedText: 42, spans: [{ start: "n", end: "s", label: 42 }] };
      }
      if (text.includes("[[fault:timeout]]")) {
        return new Promise<never>(() => {});
      }
      if (text.includes("[[slow]]")) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      return base.redactText(text);
    },
    redactImage: (png: Buffer, name: string): Promise<unknown> => base.redactImage(png, name),
    health: async (): Promise<{ ok: boolean; label: string }> => ({ ok: true, label: "test-fake" }),
  };
}

export function createSessionStore(options?: SessionStoreOptions) {
  const offline = options?.offline ?? true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseRedactor = (options?.redactor as any) ?? new MockRedactor();
  const gate: PrivacyGate =
    options?.gate ??
    createPrivacyGate({
      mode: "fixture",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: (SESSION_TEST_MODE ? wrapTestRedactor(baseRedactor) : baseRedactor) as any,
    });
  const analyzer: AnalyzerTransport | LiveBriefAnalyzer =
    options?.analyzer ??
    (async (approvedText: string) => buildOfflineBrief(approvedText, []));
  const analyzerLabel =
    options?.analyzerLabel ?? (isLiveAnalyzer(analyzer) ? "MuseClient" : "offline heuristic");
  const sessions = new Map<string, SessionRecord>();

  function lookup(sessionId: string): SessionRecord {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`unknown sessionId: ${sessionId}`);
    return s;
  }

  function snapshot(s: SessionRecord): SessionSnapshot {
    const snap: SessionSnapshot = {
      state: s.state,
      segments: s.segments,
      redactedText: s.redactedText,
      approved: s.approved,
      result: s.result,
      payload: s.payload,
      superseded: s.superseded,
      offline,
      draft:
        s.draft === null
          ? null
          : {
              text: s.draft.text,
              origin: "user" as const,
              approved:
                s.draft.approvedHash !== null &&
                s.draft.approvedHash === hashDraft(s.draft.text) &&
                s.draft.resultGeneration === s.generation,
            },
    };
    if (s.reason !== undefined) snap.reason = s.reason;
    return snap;
  }

  function invalidateContent(s: SessionRecord): void {
    s.generation += 1;
    if (s.runId) gate.revoke(s.runId);
    s.approvalToken = null;
    s.approved = false;
    s.approvedText = "";
    s.result = null;
    s.payload = null;
    s.draft = null;
    if (s.inFlight) {
      s.superseded = { ...s.inFlight, status: "sent" };
      s.inFlight = null;
    }
    s.analyzePending = null;
    delete s.reason;
  }

  function fail(s: SessionRecord, err: unknown): void {
    const msg = err instanceof Error ? err.message : "failed";
    const name = err instanceof Error ? err.name : "";
    if (
      name === "GateApprovalError" ||
      name === "ResidualPIIError" ||
      name === "GateConfigError" ||
      /residual|approval|stale|expired|config|glimmer|malformed|timeout/i.test(msg)
    ) {
      s.state = "blocked";
    } else {
      s.state = "error";
    }
    s.reason = msg;
  }

  return {
    createSession(): string {
      const id = randomUUID();
      sessions.set(id, {
        id,
        segments: [],
        rawText: "",
        runId: null,
        approvalToken: null,
        redactedText: "",
        approved: false,
        approvedText: "",
        result: null,
        payload: null,
        superseded: null,
        draft: null,
        inFlight: null,
        generation: 0,
        state: "input",
        approvalExpired: false,
        redactPending: null,
        analyzePending: null,
      });
      return id;
    },

    setTranscript(sessionId: string, text: string): SessionSnapshot {
      const s = lookup(sessionId);
      invalidateContent(s);
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      s.segments = lines.map((line, i) => ({ id: `seg-${i + 1}`, text: line }));
      s.rawText = text;
      s.runId = null;
      s.approvalExpired = false;
      s.redactedText = "";
      s.redactPending = null;
      s.state = "input";
      return snapshot(s);
    },

    redact(sessionId: string): Promise<SessionSnapshot> {
      const s = lookup(sessionId);
      if (s.redactPending) return s.redactPending.then(() => snapshot(s));
      s.state = "redaction_pending";
      delete s.reason;
      const gen = s.generation;
      let p!: Promise<void>;
      p = (async () => {
        try {
          const prepared = await withRedactTimeout(gate.prepare(s.rawText));
          if (s.generation !== gen) return;
          assertWellFormedRedaction(prepared);
          s.runId = prepared.runId;
          s.redactedText = prepared.redactedText;
          s.approved = false;
          s.approvalToken = null;
          s.state = "review_required";
        } catch (err: unknown) {
          if (s.generation !== gen) return;
          fail(s, err);
        } finally {
          if (s.redactPending === p) s.redactPending = null;
        }
      })();
      s.redactPending = p;
      return p.then(() => snapshot(s));
    },

    correct(sessionId: string, text: string): SessionSnapshot {
      const s = lookup(sessionId);
      if (!s.runId) throw new Error("no redaction to correct: redact first");
      const runId = s.runId;
      invalidateContent(s);
      s.runId = runId;
      s.redactedText = gate.correct(runId, text);
      s.state = "review_required";
      return snapshot(s);
    },

    invalidate(sessionId: string, scope: "transcript" | "preview" = "preview"): SessionSnapshot {
      const s = lookup(sessionId);
      invalidateContent(s);
      if (scope === "transcript") {
        s.runId = null;
        s.redactedText = "";
        s.segments = [];
        s.redactPending = null;
        s.state = "input";
      } else {
        s.state = s.runId ? "review_required" : "input";
      }
      return snapshot(s);
    },

    approve(sessionId: string): SessionSnapshot {
      const s = lookup(sessionId);
      if (!s.runId) throw new Error("no redaction to approve: redact first");
      try {
        const token = gate.approve(s.runId, s.redactedText);
        s.approvalToken = token;
        s.approved = true;
        s.approvedText = s.redactedText;
        s.segments = s.approvedText
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((line, i) => ({ id: `seg-${i + 1}`, text: line }));
        s.payload = { approvedText: s.redactedText, status: "prepared" };
        s.state = "approved";
        delete s.reason;
      } catch (err: unknown) {
        fail(s, err);
      }
      return snapshot(s);
    },

    analyze(sessionId: string): Promise<SessionSnapshot> {
      const s = lookup(sessionId);
      if (s.analyzePending) return s.analyzePending.then(() => snapshot(s));
      if (!s.approvalToken || (s.state !== "approved" && s.state !== "completed")) {
        s.state = "analysis_pending";
        delete s.reason;
        const gen = s.generation;
        let p!: Promise<void>;
        p = (async () => {
          try {
            throw new Error("approval required");
          } catch (err: unknown) {
            if (s.generation !== gen) return;
            fail(s, err);
          } finally {
            if (s.analyzePending === p) s.analyzePending = null;
          }
        })();
        s.analyzePending = p;
        return p.then(() => snapshot(s));
      }
      s.state = "analysis_pending";
      delete s.reason;
      const gen = s.generation;
      const approvedText = s.approvedText;
      const approvedSegments = [...s.segments];
      const sentAt = new Date().toISOString();
      let dispatched = false;
      let p!: Promise<void>;
      p = (async () => {
        try {
          if (!s.runId || !s.approvalToken) throw new Error("approval required");
          if (s.approvalExpired) throw new Error("approval is stale: test hook expired approvals");
          const live = isLiveAnalyzer(analyzer);
          const raw = await gate.send(s.runId, s.approvalToken, async (gated) => {
            dispatched = true;
            s.inFlight = { approvedText, sentAt };
            if (live) {
              // Gate-approved payload is the sole source of outbound text.
              const res = await analyzer.completeBrief({
                meetingId: sessionId,
                transcriptText: gated,
                framesSidecarText: "",
                fixtureMode: false,
              });
              const rawText = (res as { rawText?: unknown } | null)?.rawText;
              if (typeof rawText !== "string") {
                throw new Error("live analysis: response has no text");
              }
              return rawText;
            }
            return analyzer(approvedText);
          });
          if (s.generation !== gen) {
            if (dispatched) {
              s.superseded = { approvedText, sentAt, status: "sent" };
            }
            return;
          }
          let result: AnalysisResult;
          if (live) {
            // Live mode never substitutes the offline heuristic or a
            // fixture: unparseable or invalid output is an error.
            if (typeof raw !== "string") {
              throw new Error("live analysis: response has no text");
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw) as unknown;
            } catch {
              throw new Error("live analysis: response is not JSON");
            }
            result = toLiveAnalysisResult(parsed, new Set(approvedSegments.map((g) => g.id)));
          } else {
            // Default analyzer ignores segments; rebuild offline brief with real ids when offline-shaped.
            result = toAnalysisResult(raw, offline);
            if (offline && approvedText.length > 0) {
              const maybe = raw as { entries?: unknown[] } | null;
              const looksDefault =
                !maybe || !Array.isArray(maybe.entries) || maybe.entries.length === 0;
              if (looksDefault) result = buildOfflineBrief(approvedText, approvedSegments);
              else {
                const valid = new Set(approvedSegments.map((g) => g.id));
                result = {
                  offline: result.offline,
                  entries: result.entries.map((e) => ({
                    ...e,
                    segmentIds: e.segmentIds.filter((id) => valid.has(id)),
                  })),
                };
              }
            }
            if (result.entries.length === 0) result = { offline: result.offline, entries: [] };
          }
          s.inFlight = null;
          s.result = result;
          s.draft = { text: "", origin: "user", resultGeneration: gen, approvedHash: null };
          s.payload = {
            approvedText,
            status: "dispatched",
            sentAt: new Date().toISOString(),
            adapterLabel: analyzerLabel,
          };
          s.state = "completed";
        } catch (err: unknown) {
          if (s.generation !== gen) {
            if (dispatched) {
              s.superseded = { approvedText, sentAt, status: "sent" };
            }
            return;
          }
          if (dispatched) {
            s.payload = {
              approvedText,
              status: "dispatched",
              sentAt,
              adapterLabel: analyzerLabel,
            };
          }
          fail(s, err);
        } finally {
          if (s.analyzePending === p) s.analyzePending = null;
        }
      })();
      s.analyzePending = p;
      return p.then(() => snapshot(s));
    },

    editDraft(sessionId: string, text: string): SessionSnapshot {
      const s = lookup(sessionId);
      if (s.state !== "completed" || !s.result) throw new Error("no completed result: analyze first");
      s.draft = { text, origin: "user", resultGeneration: s.generation, approvedHash: null };
      return snapshot(s);
    },

    approveDraft(sessionId: string, text: string): SessionSnapshot {
      const s = lookup(sessionId);
      if (s.state !== "completed" || !s.result || !s.draft) throw new Error("no completed result: analyze first");
      if (s.draft.resultGeneration !== s.generation) throw new Error("no completed result: analyze first");
      if (text.length === 0) throw new Error("cannot approve an empty draft");
      if (text !== s.draft.text) throw new Error("draft changed; review again");
      s.draft.approvedHash = hashDraft(text);
      return snapshot(s);
    },

    rejectDraft(sessionId: string): SessionSnapshot {
      const s = lookup(sessionId);
      if (s.draft) s.draft.approvedHash = null;
      return snapshot(s);
    },

    expireApprovals(): void {
      for (const s of sessions.values()) {
        if (s.approvalToken !== null) s.approvalExpired = true;
      }
    },

    getState(sessionId: string): SessionSnapshot {
      return snapshot(lookup(sessionId));
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
