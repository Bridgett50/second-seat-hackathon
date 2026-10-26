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

export function validateGlimmerOutput(text: string, value: unknown): { spans: TextSpan[]; boxes: ImageBox[] } {
  if (typeof value !== "object" || value === null) throw new Error("glimmer: output must be an object");
  const v = value as { spans?: unknown; boxes?: unknown };
  const rawSpans = v.spans ?? [];
  const rawBoxes = v.boxes ?? [];
  if (!Array.isArray(rawSpans)) throw new Error("glimmer: spans must be an array");
  if (!Array.isArray(rawBoxes)) throw new Error("glimmer: boxes must be an array");
  const spans: TextSpan[] = rawSpans.map((s) => {
    if (typeof s !== "object" || s === null) throw new Error("glimmer: span must be an object");
    const { start, end, label } = s as { start?: unknown; end?: unknown; label?: unknown };
    if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error("glimmer: span start/end must be integers");
    if (typeof label !== "string" || label === "") throw new Error("glimmer: span label must be a string");
    const st = start as number;
    const en = end as number;
    if (st < 0 || en > text.length || en <= st) throw new Error("glimmer: span out of range");
    // Spans must be substrings: validate in code (no schema decoding).
    const covered = text.slice(st, en);
    if (!text.includes(covered)) throw new Error("glimmer: span is not a substring");
    return { start: st, end: en, label };
  });
  const boxes: ImageBox[] = rawBoxes.map((b) => {
    if (typeof b !== "object" || b === null) throw new Error("glimmer: box must be an object");
    const { x, y, w, h, label } = b as { x?: unknown; y?: unknown; w?: unknown; h?: unknown; label?: unknown };
    for (const n of [x, y, w, h]) if (!Number.isInteger(n) || (n as number) < 0) throw new Error("glimmer: box coords must be non-negative integers");
    if (typeof label !== "string" || label === "") throw new Error("glimmer: box label must be a string");
    return { x: x as number, y: y as number, w: w as number, h: h as number, label: label as string };
  });
  return { spans, boxes };
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
  out.sort((a, b) => a.start - b.start);
  return out;
}

export function maskText(text: string, spans: TextSpan[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
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
    const spans = detectPii(text).map(({ start, end, label }) => ({ start, end, label }));
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

export function extractGlimmerJson(body: unknown): unknown {
  const choice = (body as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
  const message = choice?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  const text = content !== "" ? content : reasoning;
  const fr = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
  const unfenced = text.replace(/```/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`glimmer: no JSON in reply (finish_reason=${fr}, len=${text.length})`);
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

export class GlimmerClient implements Redactor {
  readonly label = `Glimmer: ${GLIMMER_MODEL}`;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    const resolved = baseUrl ?? process.env["GLIMMER_BASE_URL"] ?? "";
    if (resolved === "") throw new Error("glimmer: GLIMMER_BASE_URL is unset");
    this.baseUrl = resolved.replace(/\/$/, "");
  }

  async redactText(text: string): Promise<RedactTextResult> {
    const parsed = await this.chat(text, "text");
    const { spans } = validateGlimmerOutput(text, parsed);
    return { maskedText: maskText(text, spans), spans };
  }

  async redactImage(png: Buffer, name: string): Promise<RedactImageResult> {
    void name;
    const parsed = await this.chat(`redact PII boxes for image (base64 ${png.length} bytes)`, "image");
    const { boxes } = validateGlimmerOutput("", { spans: [], boxes: (parsed as { boxes?: unknown }).boxes ?? [] });
    if (boxes.length === 0) return { png, boxes: [], masked: false };
    return { png: maskPngBoxes(png, boxes), boxes, masked: true };
  }

  async health(): Promise<{ ok: boolean; label: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: "GET" });
      return { ok: res.ok, label: this.label };
    } catch {
      return { ok: false, label: this.label };
    }
  }

  private async chat(text: string, kind: string): Promise<unknown> {
    // OpenAI-compatible fetch. Never greedy: temp 1.0 / top_p 0.95 / top_k 64.
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: GLIMMER_MODEL,
        max_tokens: glimmerMaxTokens(),
        temperature: 1.0,
        top_p: 0.95,
        top_k: 64,
        messages: [
          { role: "system", content: `Return JSON only: {"spans":[{"start":n,"end":n,"label":s}],"boxes":[]}. Spans must be exact substrings for ${kind}.` },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`glimmer: chat failed ${res.status}`);
    const raw = await res.text();
    const rawDir = process.env["GLIMMER_RAW_DIR"] ?? "";
    if (rawDir !== "") {
      mkdirSync(rawDir, { recursive: true });
      appendFileSync(join(rawDir, "glimmer-raw.jsonl"), `${JSON.stringify({ kind, status: res.status, raw })}\n`);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`glimmer: no JSON in reply (finish_reason=unknown, len=${raw.length})`);
    }
    return extractGlimmerJson(body);
  }
}

export function defaultRedactor(): Redactor {
  if ((process.env["GLIMMER_BASE_URL"] ?? "") !== "") {
    try {
      return new GlimmerClient();
    } catch {
      return new MockRedactor();
    }
  }
  return new MockRedactor();
}

// --- PNG box masking with node:zlib only (8-bit RGB/RGBA, non-interlaced) ---

import { inflateSync, deflateSync } from "node:zlib";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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
