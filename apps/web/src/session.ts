import { randomUUID } from "node:crypto";
import {
  createPrivacyGate,
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
  status: "prepared" | "sent";
  sentAt?: string;
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
}

export type AnalyzerTransport = (approvedText: string) => Promise<unknown>;

export interface SessionStoreOptions {
  gate?: PrivacyGate;
  redactor?: { redactText: (t: string) => Promise<unknown> } & Record<string, unknown>;
  analyzer?: AnalyzerTransport;
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
  const analyzer: AnalyzerTransport =
    options?.analyzer ??
    (async (approvedText: string) => buildOfflineBrief(approvedText, []));
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
    };
    if (s.reason !== undefined) snap.reason = s.reason;
    return snap;
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
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      s.segments = lines.map((line, i) => ({ id: `seg-${i + 1}`, text: line }));
      s.rawText = text;
      s.generation += 1;
      s.runId = null;
      s.approvalExpired = false;
      s.approvalToken = null;
      s.redactedText = "";
      s.approved = false;
      s.approvedText = "";
      s.result = null;
      s.payload = null;
      if (s.inFlight) {
        s.superseded = { ...s.inFlight, status: "sent" };
        s.inFlight = null;
      }
      s.redactPending = null;
      s.analyzePending = null;
      s.state = "input";
      delete s.reason;
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
      s.generation += 1;
      s.redactedText = gate.correct(s.runId, text);
      s.approved = false;
      s.approvalToken = null;
      s.approvedText = "";
      s.payload = null;
      if (s.inFlight) {
        s.superseded = { ...s.inFlight, status: "sent" };
        s.inFlight = null;
      }
      if (s.state !== "blocked" && s.state !== "error") s.state = "review_required";
      else s.state = "review_required";
      delete s.reason;
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
          const raw = await gate.send(s.runId, s.approvalToken, async () => {
            dispatched = true;
            s.inFlight = { approvedText, sentAt };
            return analyzer(approvedText);
          });
          if (s.generation !== gen) {
            if (dispatched) {
              s.superseded = { approvedText, sentAt, status: "sent" };
            }
            return;
          }
          // Default analyzer ignores segments; rebuild offline brief with real ids when offline-shaped.
          let result = toAnalysisResult(raw, offline);
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
          s.inFlight = null;
          s.result = result;
          s.payload = {
            approvedText,
            status: "sent",
            sentAt: new Date().toISOString(),
          };
          s.state = "completed";
        } catch (err: unknown) {
          if (s.generation !== gen) {
            if (dispatched) {
              s.superseded = { approvedText, sentAt, status: "sent" };
            }
            return;
          }
          fail(s, err);
        } finally {
          if (s.analyzePending === p) s.analyzePending = null;
        }
      })();
      s.analyzePending = p;
      return p.then(() => snapshot(s));
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
