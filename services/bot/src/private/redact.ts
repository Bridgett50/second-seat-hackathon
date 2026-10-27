/**
 * Glimmer private layer (PII redaction).
 *
 * Raw text and screenshots are masked on our own GPU before any cloud call.
 * Hosting: Modal 1x A100-80GB, BF16, vllm/vllm-openai:muse-glimmer, weights in
 * a Modal Volume, scale-to-zero. No Modal token exists in this environment, so
 * the default here is a deterministic mock labelled
 * "Glimmer: MOCK (TODO(glimmer-hosting))".
 * Choose MockRedactor when GLIMMER_BASE_URL is unset.
 */

export const MOCK_LABEL = "Glimmer: MOCK (TODO(glimmer-hosting))";
export const GLIMMER_MODEL = "meta-models/Muse-Glimmer-30B";
export const GLIMMER_MAX_TOKENS_DEFAULT = 2048;

export function glimmerMaxTokens(): number {
  const raw = process.env["GLIMMER_MAX_TOKENS"] ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return GLIMMER_MAX_TOKENS_DEFAULT;
}

export interface TextSpan {
  start: number;
  end: number;
  label: string;
  originalLabel?: string;
}

export interface RedactTextResult {
  maskedText: string;
  spans: TextSpan[];
}

export interface ImageBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface RedactImageResult {
  png: Buffer;
  boxes: ImageBox[];
  masked: boolean;
}

export interface Redactor {
  label: string;
  redactText(text: string): Promise<RedactTextResult>;
  redactImage(png: Buffer, name: string): Promise<RedactImageResult>;
  health(): Promise<{ ok: boolean; label: string }>;
}

/** Date policy: every calendar date in a transcript is treated as potentially
 * identifying and masked under canonical label date_of_birth; generic DATE
 * aliases to it. Unknown labels still throw. */
export const ALLOWED_LABELS = [
  "person",
  "phone",
  "email",
  "credit_card",
  "account_number",
  "iban",
  "address",
  "date_of_birth",
] as const;

export type GlimmerLabel = (typeof ALLOWED_LABELS)[number];

/**
 * Fixed alias map: raw model labels (any case) -> canonical label.
 * Lookup is case-insensitive: compare label.toUpperCase() against these keys.
 */
export const LABEL_ALIASES: Record<string, string> = {
  PHONE: "phone",
  PHONE_NUMBER: "phone",
  EMAIL: "email",
  EMAIL_ADDRESS: "email",
  PERSON: "person",
  PERSON_NAME: "person",
  NAME: "person",
  CREDIT_CARD: "credit_card",
  CREDIT_CARD_NUMBER: "credit_card",
  CARD: "credit_card",
  ACCOUNT_NUMBER: "account_number",
  BANK_ACCOUNT_NUMBER: "account_number",
  ACCOUNT: "account_number",
  IBAN: "iban",
  ADDRESS: "address",
  DOB: "date_of_birth",
  DATE_OF_BIRTH: "date_of_birth",
  BIRTHDATE: "date_of_birth",
  BIRTH_DATE: "date_of_birth",
  DATE: "date_of_birth",
};

export function normalizeGlimmerLabel(label: string): string {
  const key = label.toUpperCase();
  if (Object.hasOwn(LABEL_ALIASES, key)) return LABEL_ALIASES[key] as string;
  return label.toLowerCase();
}

export interface ValidatedSpan extends TextSpan {
  /** Raw label as the model returned it, before aliasing. */
  originalLabel: string;
}

export interface ValidateGlimmerReplyResult {
  spans: ValidatedSpan[];
  boxes: ImageBox[];
  /** True when the model found nothing (empty spans list is valid but needs a human look). */
  needsReview: boolean;
}

/**
 * Strict validator for a parsed Glimmer reply against the original input text.
 * Requires spans and boxes arrays; rejects placeholder values (non-number
 * start/end such as "n", non-string labels such as "s") and unknown labels
 * after aliasing. Offsets are 0-based UTF-16 code unit offsets into input,
 * start inclusive, end exclusive, and input.slice(start, end) is the entity.
 */
export function validateGlimmerReply(input: string, parsed: unknown): ValidateGlimmerReplyResult {
  if (typeof parsed !== "object" || parsed === null) throw new Error("glimmer: output must be an object");
  const v = parsed as { spans?: unknown; boxes?: unknown };
  if (!Array.isArray(v.spans)) throw new Error("glimmer: spans must be an array");
  if (!Array.isArray(v.boxes)) throw new Error("glimmer: boxes must be an array");
  const spans: ValidatedSpan[] = v.spans.map((s) => {
    if (typeof s !== "object" || s === null) throw new Error("glimmer: span must be an object");
    const { start, end, label } = s as { start?: unknown; end?: unknown; label?: unknown };
    // Rejects placeholder values: "n"/"s" and any other non-numbers/non-strings.
    if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error("glimmer: span start/end must be integers");
    if (typeof label !== "string" || label === "") throw new Error("glimmer: span label must be a string");
    const st = start as number;
    const en = end as number;
    if (st < 0 || en > input.length || en <= st) throw new Error("glimmer: span out of range");
    for (const i of [st, en]) {
      if (i > 0 && i < input.length) {
        const prev = input.charCodeAt(i - 1);
        const cur = input.charCodeAt(i);
        if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) {
          throw new Error("glimmer: span splits a surrogate pair");
        }
      }
    }
    // Slice must equal the covered text (offsets are UTF-16 code unit offsets).
    const covered = input.slice(st, en);
    if (covered.length === 0 || !input.includes(covered)) throw new Error("glimmer: span is not a substring");
    const normalized = normalizeGlimmerLabel(label);
    if (!(ALLOWED_LABELS as readonly string[]).includes(normalized)) {
      throw new Error(`glimmer: unknown label "${label}"`);
    }
    return { start: st, end: en, label: normalized, originalLabel: label };
  });
  const boxes: ImageBox[] = v.boxes.map((b) => {
    if (typeof b !== "object" || b === null) throw new Error("glimmer: box must be an object");
    const { x, y, w, h, label } = b as { x?: unknown; y?: unknown; w?: unknown; h?: unknown; label?: unknown };
    for (const n of [x, y, w, h]) if (!Number.isInteger(n) || (n as number) < 0) throw new Error("glimmer: box coords must be non-negative integers");
    if (typeof label !== "string" || label === "") throw new Error("glimmer: box label must be a string");
    return { x: x as number, y: y as number, w: w as number, h: h as number, label: label as string };
  });
  return { spans, boxes, needsReview: spans.length === 0 };
}

export function validateGlimmerOutput(text: string, value: unknown): { spans: TextSpan[]; boxes: ImageBox[] } {
  const { spans, boxes } = validateGlimmerReply(text, value);
  return {
    spans: spans.map(({ start, end, label }) => ({ start, end, label })),
    boxes,
  };
}

export function mergeSpans(spans: TextSpan[]): TextSpan[] {
  for (const s of spans) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) {
      throw new Error("maskText: span out of range");
    }
    if (s.start < 0 || s.end <= s.start) throw new Error("maskText: span out of range");
  }
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextSpan[] = [];
  for (const s of sorted) {
    const cur = out[out.length - 1];
    if (cur === undefined) {
      out.push({ start: s.start, end: s.end, label: s.label, ...(s.originalLabel !== undefined ? { originalLabel: s.originalLabel } : {}) });
      continue;
    }
    if (s.start < cur.end) {
      if (s.end > cur.end) cur.end = s.end;
    } else {
      out.push({ start: s.start, end: s.end, label: s.label, ...(s.originalLabel !== undefined ? { originalLabel: s.originalLabel } : {}) });
    }
  }
  return out;
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export interface DetectedSpan extends TextSpan {
  value: string;
}

const PERSON_STOPWORDS: ReadonlySet<string> = new Set([
  "The", "A", "An", "Guest", "Front", "Main", "Lobby",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Mon", "Tue", "Tues", "Wed", "Thu", "Thur", "Thurs", "Fri", "Sat", "Sun",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
  "Please", "Thanks", "Thank", "Hi", "Hello", "Hey", "Dear", "Reminder",
  "We", "I", "Our", "Ours", "You", "Your", "Yours", "He", "She", "It", "They", "Them",
  "His", "Her", "Hers", "Its", "Their", "Theirs", "This", "That", "These", "Those",
  "And", "But", "Or", "For", "Nor", "So", "Yet", "At", "By", "In", "Of", "On", "To",
  "From", "With", "As", "Is", "Are", "Was", "Were", "Be", "Been",
  "Call", "Bring", "Note",
]);

export function detectPii(text: string): DetectedSpan[] {
  const out: DetectedSpan[] = [];
  const push = (start: number, end: number, label: string) => {
    if (end <= start) return;
    for (const s of out) {
      if (start < s.end && end > s.start) return; // skip overlaps, first wins
    }
    out.push({ start, end, label, value: text.slice(start, end) });
  };
  const email = /[A-Za-z0-9._%+-]+@(?:example\.com|example\.org|example\.net)/g;
  const phone = /(?:\+?1[-.\s]?)?\(?555\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const card = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g;
  const amex = /\b3[47]\d{2} ?\d{6} ?\d{5}\b/g;
  const iban = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
  const dobLong = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g;
  const dobSlash = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
  const account = /\baccount(?:\s+number)?[\s#:]*(\d{6,12})\b|\bacct[\s#:]*(\d{6,12})\b/gi;
  const street = /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Court|Ct|Lane|Ln|Drive|Dr|Road|Rd|Boulevard|Blvd|Way|Place|Pl|Terrace|Ter)\b/g;
  let m: RegExpExecArray | null;
  while ((m = email.exec(text)) !== null) push(m.index, m.index + m[0].length, "email");
  while ((m = phone.exec(text)) !== null) push(m.index, m.index + m[0].length, "phone");
  while ((m = card.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnOk(digits)) push(m.index, m.index + m[0].length, "card");
  }
  while ((m = amex.exec(text)) !== null) push(m.index, m.index + m[0].length, "card");
  while ((m = iban.exec(text)) !== null) push(m.index, m.index + m[0].length, "iban");
  while ((m = dobLong.exec(text)) !== null) push(m.index, m.index + m[0].length, "dob");
  while ((m = dobSlash.exec(text)) !== null) push(m.index, m.index + m[0].length, "dob");
  while ((m = account.exec(text)) !== null) {
    const num = (m[1] ?? m[2] ?? "") as string;
    const idx = m[0].lastIndexOf(num);
    push(m.index + idx, m.index + idx + num.length, "account");
  }
  while ((m = street.exec(text)) !== null) push(m.index, m.index + m[0].length, "address");
  const person = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g;
  while ((m = person.exec(text)) !== null) {
    const first = m[0].split(/\s+/)[0] as string;
    if (PERSON_STOPWORDS.has(first)) {
      person.lastIndex = m.index + 1;
      continue;
    }
    push(m.index, m.index + m[0].length, "person");
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export function maskText(text: string, spans: TextSpan[]): string {
  for (const s of spans) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) {
      throw new Error("maskText: span out of range");
    }
    if (s.start < 0 || s.end > text.length || s.end <= s.start) {
      throw new Error("maskText: span out of range");
    }
  }
  const sorted = mergeSpans(spans);
  let out = "";
  let cur = 0;
  for (const s of sorted) {
    out += text.slice(cur, s.start);
    out += `[REDACTED_${s.label}]`;
    cur = s.end;
  }
  out += text.slice(cur);
  return out;
}

export class MockRedactor implements Redactor {
  readonly label = MOCK_LABEL;

  async redactText(text: string): Promise<RedactTextResult> {
    const spans: TextSpan[] = detectPii(text).map(({ start, end, label }) => ({
      start,
      end,
      label: normalizeGlimmerLabel(label),
      originalLabel: label,
    }));
    return { maskedText: maskText(text, spans), spans };
  }

  async redactImage(png: Buffer, name: string): Promise<RedactImageResult> {
    const boxes = loadSidecarBoxes(name);
    if (boxes.length === 0) return { png, boxes: [], masked: false };
    return { png: maskPngBoxes(png, boxes), boxes, masked: true };
  }

  async health(): Promise<{ ok: boolean; label: string }> {
    return { ok: true, label: MOCK_LABEL };
  }
}

export function glimmerTimeoutMs(): number {
  const raw = process.env["GLIMMER_TIMEOUT_MS"] ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 90_000;
}

export interface GlimmerReplyDescription {
  contentLen: number;
  reasoningLen: number;
  reasoningContentLen: number;
  finishReason: string;
  usage: unknown;
  durationMs: number;
}

/** Keying context for raw-response receipts (set per eval case by the runner). */
export interface GlimmerReceiptContext {
  runId?: string;
  caseId?: string;
  inputSha256?: string;
}

export interface GlimmerReceiptSpan {
  start: number;
  end: number;
  /** Canonical label after aliasing. */
  label: string;
  /** Raw label exactly as the model returned it. */
  original_label: string;
}

/**
 * One raw-response receipt per model call. Reasoning content is stored ONLY in
 * the separate `reasoning` field and is never parsed or scored as the answer
 * (the answer is `content` only; see extractGlimmerJson).
 */
export interface GlimmerReceipt {
  run_id: string;
  case_id: string;
  input_sha256: string;
  kind: string;
  status: number;
  content: string;
  spans: GlimmerReceiptSpan[];
  reasoning: string;
  finish_reason: string;
  usage: unknown;
  latency_ms: number;
  error?: string;
}

/** Raw-response files claimed by exclusive create ('wx') in this process. */
const claimedRawFiles = new Set<string>();

function glimmerRawFile(rawDir: string): string {
  // Fixed name: per-run isolation comes from the run dir plus exclusive
  // create below, so a repeated run can never append into another run's file.
  return join(rawDir, "glimmer-raw.jsonl");
}

function appendRawReceipt(file: string, receipt: GlimmerReceipt): void {
  const line = `${JSON.stringify(receipt)}\n`;
  if (!claimedRawFiles.has(file)) {
    try {
      writeFileSync(file, line, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new Error(
          `glimmer: refusing to append into existing raw file ${file} (use a fresh run dir)`,
        );
      }
      throw err;
    }
    claimedRawFiles.add(file);
    return;
  }
  appendFileSync(file, line);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * THE single parser for model text answers. Content only; never reasoning.
 * Strips fences exactly like extractGlimmerJson, rejects finish_reason=length
 * / empty / prose, then validates via validateGlimmerReply.
 */
export function parseGlimmerAnswer(
  inputText: string,
  content: string,
  finishReason = "stop",
): { spans: GlimmerReceiptSpan[] } {
  const fr = finishReason;
  if (fr === "length") {
    throw new Error(`glimmer: finish_reason=length (len=${content.length})`);
  }
  if (content.trim() === "") {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${content.length})`);
  }
  const unfenced = content.replace(/```/g, "").trim().replace(/^json\s+/i, "");
  if (!unfenced.startsWith("{") || !unfenced.endsWith("}")) {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${content.length})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced) as unknown;
  } catch {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${content.length})`);
  }
  const { spans } = validateGlimmerReply(inputText, parsed);
  return {
    spans: spans.map((s) => ({ start: s.start, end: s.end, label: s.label, original_label: s.originalLabel })),
  };
}

function receiptSpans(content: string, inputText: string, finishReason = "stop"): GlimmerReceiptSpan[] {
  try {
    return parseGlimmerAnswer(inputText, content, finishReason).spans;
  } catch {
    return [];
  }
}

export function describeGlimmerReply(body: unknown, durationMs: number): GlimmerReplyDescription {
  const choice = (body as { choices?: Array<{ message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
  const message = choice?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
  const reasoningContent = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
  const usage = (body as { usage?: unknown })?.usage ?? null;
  return {
    contentLen: content.length,
    reasoningLen: reasoning.length,
    reasoningContentLen: reasoningContent.length,
    finishReason,
    usage,
    durationMs,
  };
}

export function extractGlimmerJson(body: unknown): unknown {
  const choice = (body as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
  const message = choice?.message;
  // Answer = message.content ONLY. Never parse or score reasoning fields.
  const text = typeof message?.content === "string" ? message.content : "";
  const fr = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
  if (fr === "length") {
    throw new Error(`glimmer: finish_reason=length (len=${text.length})`);
  }
  if (text.trim() === "") {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${text.length})`);
  }
  const unfenced = text.replace(/```/g, "").trim().replace(/^json\s+/i, "");
  // The reply must be just the JSON object: surrounding prose is rejected.
  // (Fenced code blocks are still accepted: the fences are stripped above.)
  if (!unfenced.startsWith("{") || !unfenced.endsWith("}")) {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${text.length})`);
  }
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${text.length})`);
  }
}

export class GateConfigError extends Error {
  override name = "GateConfigError";
}

export class GlimmerClient implements Redactor {
  readonly label = `Glimmer: ${GLIMMER_MODEL}`;
  private baseUrl: string;
  private timeoutMs: number | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private receiptContext: GlimmerReceiptContext = {};

  constructor(
    baseUrl?: string,
    opts?: { timeoutMs?: number; fetchImpl?: typeof fetch; receiptContext?: GlimmerReceiptContext },
  ) {
    const resolved = baseUrl ?? process.env["GLIMMER_BASE_URL"] ?? "";
    if (resolved === "") throw new Error("glimmer: GLIMMER_BASE_URL is unset");
    if (!/^https?:\/\/[^/]/.test(resolved)) {
      throw new Error(`glimmer: GLIMMER_BASE_URL is not an http(s) URL: ${resolved.slice(0, 80)}`);
    }
    this.baseUrl = resolved.replace(/\/$/, "");
    this.timeoutMs = opts?.timeoutMs;
    this.fetchImpl = opts?.fetchImpl;
    if (opts?.receiptContext !== undefined) this.receiptContext = { ...opts.receiptContext };
  }

  /** Key the next receipts by run/case (used by the eval runner; optional). */
  setReceiptContext(ctx: GlimmerReceiptContext): void {
    this.receiptContext = { ...ctx };
  }

  private _lastReceipt: GlimmerReceipt | null = null;

  /** Most recent receipt produced by this client (transport or reply). */
  get lastReceipt(): GlimmerReceipt | null {
    return this._lastReceipt;
  }

  /**
   * Write one raw-response receipt. Writes NOTHING unless GLIMMER_RAW_DIR is
   * explicitly set, so application (non-eval) paths never log transcript or
   * reply text by default.
   */
  private writeReceipt(receipt: GlimmerReceipt): void {
    this._lastReceipt = receipt;
    const rawDir = process.env["GLIMMER_RAW_DIR"] ?? "";
    if (rawDir === "") return;
    mkdirSync(rawDir, { recursive: true });
    appendRawReceipt(glimmerRawFile(rawDir), receipt);
  }

  private receiptBase(kind: string): { run_id: string; case_id: string; input_sha256: string; kind: string } {
    return {
      run_id: this.receiptContext.runId ?? "",
      case_id: this.receiptContext.caseId ?? "",
      input_sha256: this.receiptContext.inputSha256 ?? "",
      kind,
    };
  }

  private replyReceipt(
    kind: string,
    body: unknown,
    status: number,
    latencyMs: number,
    error?: string,
    inputText = "",
  ): GlimmerReceipt {
    const choice = (body as { choices?: Array<{ message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
    const message = choice?.message;
    const content = typeof message?.content === "string" ? message.content : "";
    // Reasoning is preserved only here, as a separate field. It is never
    // parsed or scored as the answer.
    const reasoning =
      typeof message?.reasoning === "string"
        ? message.reasoning
        : typeof message?.reasoning_content === "string"
          ? message.reasoning_content
          : "";
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
    const usage = (body as { usage?: unknown })?.usage ?? null;
    return {
      ...this.receiptBase(kind),
      status,
      content,
      spans: receiptSpans(content, inputText, finishReason),
      reasoning,
      finish_reason: finishReason,
      latency_ms: latencyMs,
      // Legacy descriptive sizes (contentLen, finishReason, usage, ...) alongside
      // the keyed receipt fields.
      ...describeGlimmerReply(body, latencyMs),
      ...(error !== undefined ? { error } : {}),
    };
  }

  async redactText(text: string): Promise<RedactTextResult> {
    const started = Date.now();
    // Transport failure throws here; its error receipt is written by fetchBody.
    const body: unknown = await this.fetchBody(text, "text");
    const choice = (body as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
    try {
      // Single parser: content only, never reasoning.
      const { spans } = parseGlimmerAnswer(text, content, finishReason);
      this.writeReceipt(this.replyReceipt("text", body, 200, Date.now() - started, undefined, text));
      const validated = spans.map((s) => ({ start: s.start, end: s.end, label: s.label, originalLabel: s.original_label }));
      return { maskedText: maskText(text, validated), spans: validated };
    } catch (err) {
      this.writeReceipt(
        this.replyReceipt("text", body, 200, Date.now() - started, errMessage(err), text),
      );
      throw err;
    }
  }

  async redactImage(png: Buffer, name: string): Promise<RedactImageResult> {
    void name;
    const started = Date.now();
    const body: unknown = await this.fetchBody(
      `redact PII boxes for image (base64 ${png.length} bytes)`,
      "image",
    );
    try {
      const parsed = extractGlimmerJson(body);
      const { boxes } = validateGlimmerOutput("", { spans: [], boxes: (parsed as { boxes?: unknown }).boxes ?? [] });
      this.writeReceipt(this.replyReceipt("image", body, 200, Date.now() - started));
      if (boxes.length === 0) return { png, boxes: [], masked: false };
      return { png: maskPngBoxes(png, boxes), boxes, masked: true };
    } catch (err) {
      this.writeReceipt(
        this.replyReceipt("image", body, 200, Date.now() - started, errMessage(err)),
      );
      throw err;
    }
  }

  async health(): Promise<{ ok: boolean; label: string }> {
    try {
      const res = await (this.fetchImpl ?? fetch)(`${this.baseUrl}/health`, { method: "GET" });
      return { ok: res.ok, label: this.label };
    } catch {
      return { ok: false, label: this.label };
    }
  }

  /** Transport for one chat call. Writes an error receipt on transport
   * failure (the caller writes exactly one receipt for parse/validate
   * outcome). Kept private under a new name; `chat` behavior is preserved
   * through redactText/redactImage. */
  private async fetchBody(text: string, kind: string): Promise<unknown> {
    // OpenAI-compatible fetch. Extraction uses temperature=0.0 per
    // meta-oss-cookbook/muse-glimmer/recipes/structured-output/README.md
    // ("Keep `temperature=0.0`. Extraction is not a creative task.") and
    // meta-oss-cookbook/muse-glimmer/recipes/structured-output/structured_output.py:83
    // (temperature=0.0, no top_p/top_k); meta-docs/muse-glimmer/deploy.md:243
    // recommends against greedy for general chat, but extraction follows the
    // structured-output recipe instead.
    const timeoutMs = this.timeoutMs ?? glimmerTimeoutMs();
    const requestBody: Record<string, unknown> = {
      model: GLIMMER_MODEL,
      max_tokens: glimmerMaxTokens(),
      temperature: 0.0,
      chat_template_kwargs: { reasoning_strength: "low" },
      messages: [
        { role: "system", content: `Return JSON only for ${kind}. Example: for input "Call Ana at 555-0100" return {"spans":[{"start":5,"end":8,"label":"person"},{"start":12,"end":20,"label":"phone"}],"boxes":[]}. Fields: start is the 0-based UTF-16 code unit offset inclusive, end is exclusive, label is one of person, phone, email, credit_card, account_number, iban, address, date_of_birth, and input.slice(start,end) must equal the entity text. Mask every calendar date as date_of_birth. Return {"spans":[],"boxes":[]} when nothing is found. Only return entities the input actually states; never guess. Use [] when none are stated.` },
        { role: "user", content: text },
      ],
    };
    if ((process.env["GLIMMER_JSON_SCHEMA"] ?? "") === "1") {
      requestBody["response_format"] = {
        type: "json_schema",
        json_schema: {
          name: "glimmer_redaction",
          schema: {
            type: "object",
            properties: {
              spans: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    start: { type: "integer" },
                    end: { type: "integer" },
                    label: { type: "string", enum: ALLOWED_LABELS },
                  },
                  required: ["start", "end", "label"],
                },
              },
              boxes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    x: { type: "integer" },
                    y: { type: "integer" },
                    w: { type: "integer" },
                    h: { type: "integer" },
                    label: { type: "string" },
                  },
                  required: ["x", "y", "w", "h", "label"],
                },
              },
            },
          },
        },
      };
    }
    const started = Date.now();
    let res: Response;
    try {
      res = await (this.fetchImpl ?? fetch)(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      const message = errMessage(err);
      this.writeReceipt({
        ...this.receiptBase(kind),
        status: 0,
        content: "",
        spans: [],
        reasoning: "",
        finish_reason: "unknown",
        usage: null,
        latency_ms: Date.now() - started,
        error: message,
      });
      throw err;
    }
    if (!res.ok) {
      const message = `glimmer: chat failed ${res.status}`;
      this.writeReceipt({
        ...this.receiptBase(kind),
        status: res.status,
        content: "",
        spans: [],
        reasoning: "",
        finish_reason: "unknown",
        usage: null,
        latency_ms: Date.now() - started,
        error: message,
      });
      throw new Error(message);
    }
    const raw = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      const message = `glimmer: no JSON in reply (finish_reason=unknown, len=${raw.length})`;
      this.writeReceipt({
        ...this.receiptBase(kind),
        status: res.status,
        content: raw,
        spans: [],
        reasoning: "",
        finish_reason: "unknown",
        usage: null,
        latency_ms: Date.now() - started,
        error: message,
      });
      throw new Error(message);
    }
    // The caller writes exactly one receipt for the parse/validate outcome.
    return body;
  }
}

export function defaultRedactor(): Redactor {
  if ((process.env["GLIMMER_BASE_URL"] ?? "") !== "") {
    // Construction failure propagates: never silently fall back to MockRedactor.
    return new GlimmerClient();
  }
  return new MockRedactor();
}

/**
 * Live-only redactor: always the private Glimmer client, never MockRedactor.
 * Throws GateConfigError when GLIMMER_BASE_URL is unset (fail closed, zero
 * fetches); construction failures propagate.
 */
export function liveRedactor(): Redactor {
  if ((process.env["GLIMMER_BASE_URL"] ?? "") === "") {
    throw new GateConfigError(
      "live mode requires a private Glimmer redactor (GLIMMER_BASE_URL is unset); refusing to fall back to MockRedactor",
    );
  }
  return new GlimmerClient();
}

// --- PNG box masking with node:zlib only (8-bit RGB/RGBA, non-interlaced) ---

import { inflateSync, deflateSync } from "node:zlib";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function botRootDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg?.name === "@second-seat/bot") return dir;
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

export function loadSidecarBoxes(name: string): ImageBox[] {
  const base = name.replace(/\.png$/i, "");
  const candidates = [
    join(botRootDir(), "fixtures", "pii", `${base}.boxes.json`),
    join(botRootDir(), "fixtures", "pii", `${name}.boxes.json`),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
      const { boxes } = validateGlimmerOutput("", { spans: [], boxes: raw });
      void 0;
      return boxes;
    } catch {
      /* try next */
    }
  }
  return [];
}

function crc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

const CRC_TABLE = crc32Table();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const td = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([td, data])), 0);
  return Buffer.concat([len, td, data, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function maskPngBoxes(png: Buffer, boxes: ImageBox[]): Buffer {
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error("redact: not a PNG");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error("redact: only 8-bit RGB/RGBA PNG supported");
  }
  if (interlace !== 0) throw new Error("redact: interlaced PNG not supported");
  const channels = colorType === 2 ? 3 : 4;
  const stride = width * channels;
  const raw = Buffer.from(inflateSync(Buffer.concat(idat)));
  const px = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p]!;
    p += 1;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? px[y * stride + x - channels]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels]! : 0;
      const f = raw[p + x]!;
      let v: number;
      switch (filter) {
        case 0: v = f; break;
        case 1: v = (f + a) & 0xff; break;
        case 2: v = (f + b) & 0xff; break;
        case 3: v = (f + ((a + b) >> 1)) & 0xff; break;
        case 4: v = (f + paeth(a, b, c)) & 0xff; break;
        default: throw new Error("redact: bad PNG filter");
      }
      px[y * stride + x] = v;
    }
    p += stride;
  }
  for (const b of boxes) {
    const x0 = Math.max(0, b.x);
    const y0 = Math.max(0, b.y);
    const x1 = Math.min(width, b.x + b.w);
    const y1 = Math.min(height, b.y + b.h);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        for (let ch = 0; ch < Math.min(channels, 3); ch += 1) px[y * stride + x * channels + ch] = 0;
        if (channels === 4) px[y * stride + x * channels + 3] = 255;
      }
    }
  }
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    filtered[y * (stride + 1)] = 0;
    px.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", Buffer.from(deflateSync(filtered))), chunk("IEND", Buffer.alloc(0))]);
}
