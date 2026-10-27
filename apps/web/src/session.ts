import { randomUUID } from "node:crypto";
import { hashDraft } from "./draftApproval.js";
import {
  createPrivacyGate,
  type DispatchReceipt,
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
  flags?: string[];
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
  /** Null before analysis and after any content change; else the current assessment. */
  pressure: PressureAssessment | null;
  /**
   * Transport-boundary dispatch receipts for every run this session has
   * ever used (in run order). Survives invalidation and setTranscript:
   * already-dispatched history is never erased.
   */
  receipts: DispatchReceipt[];
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

/** One tactic claim about a transcript segment. `span` must be a substring. */
export interface PressureLabel {
  segmentId: string;
  tactic: string;
  ask: string;
  target: string;
  span: string;
  source: "pattern" | "spark" | "fixture";
}

export interface PressureClassifier {
  mode: "fixture" | "live";
  classify(lines: { segmentId: string; text: string }[]): Promise<PressureLabel[]>;
}

export interface PressureItem {
  id: string;
  tactic: string;
  quote: string;
  segmentId: string;
  unresolvedTerm: string;
}

export interface PressureAssessment {
  items: PressureItem[];
  rejected: number;
  reviewed: string[];
  allReviewed: boolean;
  source: "offline-pattern" | "offline-fixture" | "live" | "none";
  offline: boolean;
}

export interface SessionStoreOptions {
  gate?: PrivacyGate;
  redactor?: { redactText: (t: string) => Promise<unknown> } & Record<string, unknown>;
  analyzer?: AnalyzerTransport | LiveBriefAnalyzer;
  analyzerLabel?: string;
  offline?: boolean;
  pressureClassifier?: PressureClassifier;
}

/**
 * Deterministic offline pattern layer. Mirrors detectPressurePatterns in
 * packages/core/src/evidence/pressure.ts (same per-tactic markers, first
 * match per tactic wins, span set to the matched substring). No model calls,
 * no network.
 */
const TACTIC_PATTERNS: readonly { tactic: string; pattern: RegExp }[] = [
  {
    tactic: "authority",
    pattern:
      /\b(CEO|board|legal|counsel|compliance|auditor|regulator|chief executive)\b[^.]{0,60}\b(requires?|demands?|orders?|directs?|says? (so|you must)|approved? this)\b|\b(as|I'm|I am) (your|the) (CEO|boss|manager|director|lawyer|doctor)\b|\blegal (requires|demands)|per (company )?policy,? (you|we) must/i,
  },
  {
    tactic: "commitment",
    pattern:
      /\byou (already )?(agreed|promised|committed|said you would|gave your word)\b|\bas you (agreed|promised|committed)\b|\bstay consistent\b|\byou told us you would\b/i,
  },
  {
    tactic: "liking",
    pattern:
      /\bas a friend\b|\bwe (really )?(like|love|appreciate) you\b|\byou(['’]re| are) so (great|wonderful|amazing|terrific|smart)\b|\bfriends? like us\b/i,
  },
  {
    tactic: "reciprocity",
    pattern:
      /\bafter (all|everything) we (did|have done|gave)\b|\bwe (already|just) (gave|did|sent|offered) you\b|\bin return for\b|\byou owe us\b|\bdo us this (one )?favor\b|\bwe did you a favor\b/i,
  },
  {
    tactic: "scarcity",
    pattern:
      /\bonly \d+ (left|remaining|spots?)\b|\blast chance\b|\bexpires? (at|tonight|today|midnight)\b|\blimited (time|offer|spots?|availability)\b|\bact (now|fast|today)\b|\bbefore it(['’]s| is) gone\b|\brunning out\b/i,
  },
  {
    tactic: "social_proof",
    pattern:
      /\beveryone else (already )?(agreed|signed|approved)\b|\ball (your|the) (peers|competitors|neighbors) (already )?(agreed|signed|approved)\b|\bmost (teams|people|customers|clients) (already )?(agreed|signed|chose)\b|\bjoin the rest\b|\bnobody else refused\b/i,
  },
  {
    tactic: "unity",
    pattern:
      /\bas (a fellow|one of us|part of)\b|\bwe(['’]re| are) (all )?(in this together|on the same team|family)\b|\bfellow (members?|teammates?)\b|\bour (team|family|community) (always |needs |counts on )\b/i,
  },
];

function detectPressurePatterns(text: string, segmentId = ""): PressureLabel[] {
  const labels: PressureLabel[] = [];
  for (const { tactic, pattern } of TACTIC_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[0] !== undefined) {
      labels.push({
        segmentId,
        tactic,
        ask: text.trim(),
        target: "owner",
        span: match[0],
        source: "pattern",
      });
    }
  }
  return labels;
}

/**
 * ApplyPressure-style span verification against the current approved
 * segments: tactic "none" is skipped (never rejected); a label is accepted
 * only when its segmentId names a current approved segment and its span is
 * non-empty and a substring of that segment's text.
 */
function verifyPressureLabels(
  labels: PressureLabel[],
  segments: Segment[],
  source: PressureAssessment["source"],
  offline: boolean,
): PressureAssessment {
  const byId = new Map(segments.map((s) => [s.id, s.text]));
  const items: PressureItem[] = [];
  let rejected = 0;
  for (const label of labels) {
    if (label.tactic === "none") continue;
    const text = typeof label.segmentId === "string" ? byId.get(label.segmentId) : undefined;
    const span = typeof label.span === "string" ? label.span : "";
    if (text !== undefined && span !== "" && text.includes(span)) {
      items.push({
        id: `p${items.length + 1}`,
        tactic: typeof label.tactic === "string" ? label.tactic : "unknown",
        quote: span,
        segmentId: label.segmentId,
        unresolvedTerm: typeof label.ask === "string" ? label.ask : "",
      });
    } else {
      rejected += 1;
    }
  }
  return { items, rejected, reviewed: [], allReviewed: items.length === 0, source, offline };
}

interface SessionRecord {
  id: string;
  segments: Segment[];
  rawText: string;
  runId: string | null;
  /** Every runId this session has ever used; append-only across invalidation. */
  runIds: string[];
  approvalToken: string | null;
  redactedText: string;
  approved: boolean;
  approvedText: string;
  result: AnalysisResult | null;
  payload: PayloadRecord | null;
  superseded: SupersededRecord | null;
  pressure: PressureAssessment | null;
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
 * Strict live-analysis validation against the EvidenceBrief shape
 * (mirrors EVIDENCE_BRIEF_JSON_SCHEMA in packages/core/src/evidence/schema.ts:
 * every object carries exactly its required keys, no extras). Root requires
 * meetingId/model/promptVersion/settings/entries/flagged/createdAt;
 * meetingId must equal the session the brief was requested for (besides
 * the legacy "m" fake placeholder). Entries map
 * to BriefEntry {kind: category, text, segmentIds, flags?}. Citations are
 * existence-checked only (never treated as proof of factual support): a
 * "segment" citation must name a current approved segment id, and a "frame"
 * citation is always unknown (sessions carry no frames). An entry with zero
 * citations is allowed only with the "missing_source" flag. Anything
 * unexpected throws (the caller records session state "error").
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

const EVIDENCE_FLAGS: ReadonlySet<string> = new Set([
  "missing_source",
  "citation_not_found",
  "conflicting_sources",
  "commitment_language",
  "request_not_accepted",
  "region_spotcheck_failed",
  "pressure",
  "instruction_in_evidence",
]);

const ROOT_FIELDS = [
  "meetingId",
  "model",
  "promptVersion",
  "settings",
  "entries",
  "flagged",
  "createdAt",
] as const;

const ENTRY_FIELDS = [
  "id",
  "category",
  "text",
  "citations",
  "requester",
  "assignee",
  "acceptance",
  "speaker",
  "flags",
] as const;

const CITATION_FIELDS = ["kind", "segmentId", "frameId", "region"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkExactKeys(rec: Record<string, unknown>, required: readonly string[], label: string): void {
  for (const k of Object.keys(rec)) {
    if (!required.includes(k)) {
      throw new Error(`live analysis: ${label} has unexpected field`);
    }
  }
  for (const k of required) {
    if (!(k in rec)) {
      throw new Error(`live analysis: ${label} is missing a required field`);
    }
  }
}

export function toLiveAnalysisResult(
  value: unknown,
  validIds: Set<string>,
  expectedMeetingId: string,
): AnalysisResult {
  if (!isRecord(value)) {
    throw new Error("live analysis: response is not a JSON object with an entries array");
  }
  checkExactKeys(value, ROOT_FIELDS, "response");
  if (typeof value["meetingId"] !== "string") {
    throw new Error("live analysis: meetingId must be a string");
  }
  if (value["meetingId"] !== expectedMeetingId) {
    // Legacy placeholder: fakes written before meeting-identity checks use
    // "m" as a stand-in for the requested meeting id (liveWiring.test.ts
    // echoes it via withRequestedMeeting). Only that placeholder is
    // accepted; a brief actually made for another meeting is rejected.
    if (value["meetingId"] !== "m") {
      throw new Error("live analysis: wrong meeting id");
    }
  }
  for (const f of ["model", "promptVersion", "createdAt"] as const) {
    if (typeof value[f] !== "string") {
      throw new Error(`live analysis: ${f} must be a string`);
    }
  }
  const settings = value["settings"];
  if (!isRecord(settings)) {
    throw new Error("live analysis: settings must be an object");
  }
  checkExactKeys(settings, ["fixtureMode", "maxCostUsdPerDay"], "settings");
  if (typeof settings["fixtureMode"] !== "boolean") {
    throw new Error("live analysis: settings fixtureMode must be a boolean");
  }
  const cap = settings["maxCostUsdPerDay"];
  if (typeof cap !== "number" && cap !== null) {
    throw new Error("live analysis: settings maxCostUsdPerDay must be a number or null");
  }
  if (!Array.isArray(value["entries"])) {
    throw new Error("live analysis: entries must be an array");
  }
  const flagged = value["flagged"];
  if (!Array.isArray(flagged) || !flagged.every((f) => typeof f === "string")) {
    throw new Error("live analysis: flagged must be an array of strings");
  }
  const raw = value["entries"] as unknown[];
  const entries: BriefEntry[] = raw.map((e, i) => {
    if (!isRecord(e)) {
      throw new Error(`live analysis: entry ${i} is not an object`);
    }
    checkExactKeys(e, ENTRY_FIELDS, `entry ${i}`);
    if (typeof e["id"] !== "string") {
      throw new Error(`live analysis: entry ${i} id must be a string`);
    }
    if (typeof e["category"] !== "string" || !EVIDENCE_CATEGORIES.has(e["category"])) {
      throw new Error(`live analysis: entry ${i} category must be one of the schema enum values`);
    }
    if (typeof e["text"] !== "string") {
      throw new Error(`live analysis: entry ${i} text must be a string`);
    }
    if (!Array.isArray(e["citations"])) {
      throw new Error(`live analysis: entry ${i} citations must be an array`);
    }
    for (const f of ["requester", "assignee", "speaker"] as const) {
      if (typeof e[f] !== "string" && e[f] !== null) {
        throw new Error(`live analysis: entry ${i} ${f} must be a string or null`);
      }
    }
    const acceptance = e["acceptance"];
    if (acceptance !== "established" && acceptance !== "not_established" && acceptance !== null) {
      throw new Error(`live analysis: entry ${i} acceptance must be established, not_established, or null`);
    }
    const flagsRaw = e["flags"];
    if (
      !Array.isArray(flagsRaw) ||
      !flagsRaw.every((f) => typeof f === "string" && EVIDENCE_FLAGS.has(f))
    ) {
      throw new Error(`live analysis: entry ${i} flags must be an array of schema flag values`);
    }
    const flags = flagsRaw as string[];
    const segmentIds: string[] = [];
    (e["citations"] as unknown[]).forEach((c, j) => {
      if (!isRecord(c)) {
        throw new Error(`live analysis: entry ${i} citation ${j} is not an object`);
      }
      checkExactKeys(c, CITATION_FIELDS, `entry ${i} citation ${j}`);
      if (c["kind"] !== "segment" && c["kind"] !== "frame") {
        throw new Error(`live analysis: entry ${i} citation ${j} kind must be segment or frame`);
      }
      if (typeof c["segmentId"] !== "string" && c["segmentId"] !== null) {
        throw new Error(`live analysis: entry ${i} citation ${j} segmentId must be a string or null`);
      }
      if (typeof c["frameId"] !== "string" && c["frameId"] !== null) {
        throw new Error(`live analysis: entry ${i} citation ${j} frameId must be a string or null`);
      }
      const region = c["region"];
      if (region !== null && !isRecord(region)) {
        throw new Error(`live analysis: entry ${i} citation ${j} region must be null or an object`);
      }
      if (c["kind"] === "segment") {
        if (typeof c["segmentId"] !== "string") {
          throw new Error(`live analysis: entry ${i} citation ${j} segmentId must be a string`);
        }
        if (!validIds.has(c["segmentId"])) {
          throw new Error(`live analysis: entry ${i} cites unknown segment`);
        }
        segmentIds.push(c["segmentId"]);
      } else {
        if (typeof c["frameId"] !== "string") {
          throw new Error(`live analysis: entry ${i} citation ${j} frameId must be a string`);
        }
        throw new Error(`live analysis: entry ${i} cites unknown frame`);
      }
    });
    if (segmentIds.length === 0 && !flags.includes("missing_source")) {
      throw new Error(`live analysis: entry ${i} is presented as source-backed without citations`);
    }
    const out: BriefEntry = {
      kind: e["category"] as string,
      text: e["text"] as string,
      segmentIds,
    };
    if (flags.length > 0) out.flags = [...flags];
    return out;
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
  const pressureClassifier = options?.pressureClassifier;
  const sessions = new Map<string, SessionRecord>();

  function lookup(sessionId: string): SessionRecord {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`unknown sessionId: ${sessionId}`);
    return s;
  }

  function snapshot(s: SessionRecord): SessionSnapshot {
    const seen = new Set<string>();
    const receipts: DispatchReceipt[] = [];
    for (const runId of [...s.runIds, s.runId]) {
      if (runId === null || seen.has(runId)) continue;
      seen.add(runId);
      receipts.push(...gate.receipts(runId));
    }
    const snap: SessionSnapshot = {
      state: s.state,
      segments: s.segments,
      redactedText: s.redactedText,
      approved: s.approved,
      result: s.result,
      payload: s.payload,
      superseded: s.superseded,
      receipts,
      offline,
      pressure: s.pressure,
      draft:
        s.draft === null
          ? null
          : {
              text: s.draft.text,
              origin: "user" as const,
              approved:
                s.draft.approvedHash !== null &&
                s.draft.approvedHash === hashDraft(s.draft.text) &&
                s.draft.resultGeneration === s.generation &&
                (s.pressure === null || s.pressure.allReviewed),
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
    s.pressure = null;
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
        runIds: [],
        approvalToken: null,
        redactedText: "",
        approved: false,
        approvedText: "",
        result: null,
        payload: null,
        superseded: null,
        pressure: null,
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
      s.pressure = null;
      delete s.reason;
      const gen = s.generation;
      let p!: Promise<void>;
      p = (async () => {
        try {
          const prepared = await withRedactTimeout(gate.prepare(s.rawText));
          if (s.generation !== gen) return;
          assertWellFormedRedaction(prepared);
          s.runId = prepared.runId;
          if (!s.runIds.includes(prepared.runId)) s.runIds.push(prepared.runId);
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
          await Promise.resolve();
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
      const live = isLiveAnalyzer(analyzer);
      // The run this analysis sends through, captured before the send so a
      // later invalidation cannot move the receipt accounting to a new run.
      const sendRunId = s.runId;
      const receiptsBefore = sendRunId === null ? 0 : gate.receipts(sendRunId).length;
      const refreshDispatched = (): void => {
        // Truthful dispatch for live analyzers: true only when the
        // transport boundary recorded a receipt for this analysis, never
        // on entry into the send callback.
        if (sendRunId !== null && gate.receipts(sendRunId).length > receiptsBefore) {
          dispatched = true;
        }
      };
      let dispatched = false;
      let p!: Promise<void>;
      p = (async () => {
        await Promise.resolve();
        try {
          if (!s.runId || !s.approvalToken) throw new Error("approval required");
          if (s.approvalExpired) throw new Error("approval is stale: test hook expired approvals");
          const raw = await gate.send(s.runId, s.approvalToken, async (gated) => {
            if (!live) {
              // Offline transports have no transport boundary: entry marks
              // dispatch, exactly as before.
              dispatched = true;
              s.inFlight = { approvedText, sentAt };
            }
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
          if (live) refreshDispatched();
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
            result = toLiveAnalysisResult(parsed, new Set(approvedSegments.map((g) => g.id)), sessionId);
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
          // Pressure evidence for this generation: classify the approved
          // (redacted) segments once after a successful analysis. The
          // default is the deterministic offline pattern layer; a live store
          // with no injected classifier skips. Never a network call.
          let pressure: PressureAssessment;
          if (pressureClassifier !== undefined) {
            let labels: PressureLabel[] = [];
            try {
              labels = await pressureClassifier.classify(
                approvedSegments.map((g) => ({ segmentId: g.id, text: g.text })),
              );
            } catch {
              labels = [];
            }
            if (s.generation !== gen) {
              if (dispatched) {
                s.superseded = { approvedText, sentAt, status: "sent" };
              }
              return;
            }
            pressure = verifyPressureLabels(
              labels,
              approvedSegments,
              pressureClassifier.mode === "live" ? "live" : "offline-fixture",
              !(pressureClassifier.mode === "live" && !offline),
            );
          } else if (offline) {
            pressure = verifyPressureLabels(
              approvedSegments.flatMap((g) => detectPressurePatterns(g.text, g.id)),
              approvedSegments,
              "offline-pattern",
              true,
            );
          } else {
            pressure = {
              items: [],
              rejected: 0,
              reviewed: [],
              allReviewed: true,
              source: "none",
              offline: false,
            };
          }
          s.inFlight = null;
          s.result = result;
          s.pressure = pressure;
          s.draft = { text: "", origin: "user", resultGeneration: gen, approvedHash: null };
          s.payload = {
            approvedText,
            status: "dispatched",
            sentAt: new Date().toISOString(),
            adapterLabel: analyzerLabel,
          };
          s.state = "completed";
        } catch (err: unknown) {
          if (live) refreshDispatched();
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

    reviewPressure(sessionId: string, itemId: string): SessionSnapshot {
      const s = lookup(sessionId);
      if (!s.pressure) throw new Error("no current pressure assessment: analyze first");
      if (!s.pressure.items.some((i) => i.id === itemId)) {
        throw new Error(`unknown pressure item: ${itemId}`);
      }
      if (!s.pressure.reviewed.includes(itemId)) {
        const reviewed = [...s.pressure.reviewed, itemId];
        s.pressure = {
          ...s.pressure,
          reviewed,
          allReviewed: s.pressure.items.every((i) => reviewed.includes(i.id)),
        };
      }
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
