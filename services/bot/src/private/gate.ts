/**
 * Server-side privacy gate: every outbound analysis request passes here.
 *
 * Flow: prepare(rawText) -> preview/correct -> approve -> send.
 * Raw text is sent ONLY to the Glimmer redactor. Spark/Muse endpoints
 * receive only reviewed redacted text via gate.send's sendFn callback,
 * which is handed a `GatedText` value that only this module can mint.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  GateConfigError,
  GlimmerClient,
  MOCK_LABEL,
  MockRedactor,
  validateGlimmerReply,
  type Redactor,
  type TextSpan,
} from "./redact.js";

export { GateConfigError };

export const APPROVAL_TTL_MS = 15 * 60 * 1000;
export const GLIMMER_BASE_URL_ENV = "GLIMMER_BASE_URL";

export class GateApprovalError extends Error {
  override name = "GateApprovalError";
}

export class ResidualPIIError extends Error {
  override name = "ResidualPIIError";
}

const MINT = Symbol("gate-mint");

interface GateBinding {
  mode: "live" | "fixture";
  runId: string;
  revision: number;
  textHash: string;
  expiresAt: number;
  isCurrent: () => boolean;
  now: () => number;
}

const bindings = new WeakMap<GatedText, GateBinding>();

/**
 * Branded text that has completed the full gate flow (redact, review,
 * approve, residual checks). Only constructible inside this module via
 * the module-private `MINT` symbol, which `send` alone holds.
 * Spark-calling functions take this instead of `string`; pass a plain
 * string and they throw.
 */
export class GatedText {
  private _text: string;

  get text(): string {
    return this._text;
  }

  set text(_value: string) {
    // Tamper-evident: keep the approved text but permanently invalidate the
    // binding, so any runtime write attempt rejects this value afterwards.
    // Object.freeze below does not disable this prototype setter.
    bindings.delete(this);
  }

  constructor(mint: unknown, text: string) {
    if (mint !== MINT) {
      throw new GateApprovalError("refusing to send text that did not come from gate.send: approval required");
    }
    this._text = text;
    Object.freeze(this);
  }
}

/** Throw unless the value is gate-minted with a current, unexpired binding. Plain strings are rejected. */
export function requireGatedText(value: unknown, required: "live" | "any" = "any"): GatedText {
  if (value instanceof GatedText) {
    const binding = bindings.get(value);
    if (
      binding !== undefined &&
      binding.isCurrent() &&
      binding.now() <= binding.expiresAt &&
      sha256Hex(value.text) === binding.textHash
    ) {
      if (required === "live" && binding.mode !== "live") {
        throw new GateApprovalError("fixture-mode approval cannot authorize a live provider request");
      }
      return value;
    }
  }
  throw new GateApprovalError("refusing to send text that did not come from gate.send: approval required");
}

export function requireLiveGatedText(v: unknown): GatedText {
  return requireGatedText(v, "live");
}

export interface PrivacyGateOptions {
  redactor?: Redactor;
  mode: "live" | "fixture";
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface PreparedRun {
  runId: string;
  redactedText: string;
  spans: TextSpan[];
  needsReview: boolean;
  /** An empty span list is never a PII-free claim, it requires owner review. */
  piiFree: false;
}

interface StoredRun {
  revision: number;
  currentText: string;
  spans: TextSpan[];
  rawNames: string[];
  approval: { token: string; textHash: string; at: number; revision: number } | null;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
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

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b\d{3}-\d{4}\b/;
const CARD_GROUP_RE = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/;
const CARD_LONG_RE = /\b\d{13,19}\b/;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

/** Residual-pattern scan over candidate send text. Returns a hit kind or null. */
export function findResidualPII(text: string, rawNames: readonly string[] = []): string | null {
  const cardGroup = CARD_GROUP_RE.exec(text);
  if (cardGroup !== null) {
    const digits = cardGroup[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnOk(digits)) return "card number";
  }
  const cardLong = CARD_LONG_RE.exec(text);
  if (cardLong !== null && luhnOk(cardLong[0])) return "card number";
  if (EMAIL_RE.test(text)) return "email address";
  if (PHONE_RE.test(text)) return "phone number";
  if (IBAN_RE.test(text)) return "IBAN";
  if (SSN_RE.test(text)) return "SSN-like number";
  for (const name of rawNames) {
    if (name.length >= 2 && text.includes(name)) return "unredacted name from redaction spans";
  }
  return null;
}

async function withFetch<T>(fetchImpl: typeof fetch | undefined, fn: () => Promise<T>): Promise<T> {
  if (fetchImpl === undefined) return fn();
  const scope = globalThis as unknown as Record<string, unknown>;
  const prev = scope["fetch"];
  scope["fetch"] = fetchImpl;
  try {
    return await fn();
  } finally {
    scope["fetch"] = prev;
  }
}

export interface PrivacyGate {
  prepare(rawText: string): Promise<PreparedRun>;
  preview(runId: string): string;
  correct(runId: string, editedText: string): string;
  approve(runId: string, text: string): string;
  send<T>(runId: string, approvalToken: string, sendFn: (gated: GatedText) => Promise<T>): Promise<T>;
  revoke(runId: string): void;
}

export function createPrivacyGate(options: PrivacyGateOptions): PrivacyGate {
  const { mode, fetchImpl, now = () => Date.now() } = options;
  if (mode === "live") {
    if ((process.env[GLIMMER_BASE_URL_ENV] ?? "") === "") {
      throw new GateConfigError(
        "live mode requires a private Glimmer redactor (GLIMMER_BASE_URL is unset); refusing to fall back to MockRedactor",
      );
    }
    const candidate = options.redactor;
    if (candidate !== undefined && (candidate instanceof MockRedactor || candidate.label === MOCK_LABEL)) {
      throw new GateConfigError("live mode forbids MockRedactor: configure the private Glimmer redactor");
    }
  }
  const redactor: Redactor =
    options.redactor ?? (mode === "live" ? new GlimmerClient() : new MockRedactor());

  const runs = new Map<string, StoredRun>();

  function lookup(runId: string): StoredRun {
    const run = runs.get(runId);
    if (run === undefined) throw new GateApprovalError("unknown runId: approval required");
    return run;
  }

  return {
    async prepare(rawText: string): Promise<PreparedRun> {
      // Raw text goes ONLY to the Glimmer redactor. Timeout or an
      // invalid reply throws here, before any further calls.
      const redacted = await withFetch(fetchImpl, () => redactor.redactText(rawText));
      if (mode === "live") {
        validateGlimmerReply(rawText, { spans: redacted.spans, boxes: [] });
      }
      const runId = randomUUID();
      const rawNames = [
        ...new Set(
          redacted.spans
            .filter((s) => s.label === "person")
            .map((s) => rawText.slice(s.start, s.end))
            .filter((v) => v.length >= 2),
        ),
      ];
      runs.set(runId, {
        revision: 0,
        currentText: redacted.maskedText,
        spans: redacted.spans,
        rawNames,
        approval: null,
      });
      return {
        runId,
        redactedText: redacted.maskedText,
        spans: redacted.spans,
        needsReview: redacted.spans.length === 0,
        piiFree: false,
      };
    },

    preview(runId: string): string {
      return lookup(runId).currentText;
    },

    correct(runId: string, editedText: string): string {
      const run = lookup(runId);
      run.currentText = editedText;
      run.revision += 1;
      run.approval = null;
      return run.currentText;
    },

    approve(runId: string, text: string): string {
      const run = lookup(runId);
      const textHash = sha256Hex(text);
      const token = sha256Hex(`${runId}:${textHash}`);
      run.approval = { token, textHash, at: now(), revision: run.revision };
      return token;
    },

    async send<T>(runId: string, approvalToken: string, sendFn: (gated: GatedText) => Promise<T>): Promise<T> {
      const run = lookup(runId);
      const approval = run.approval;
      if (approval === null || approval.token !== approvalToken) {
        throw new GateApprovalError("missing or mismatched approval: approval required");
      }
      if (approval.revision !== run.revision) {
        throw new GateApprovalError("approval is stale: the text changed after approval");
      }
      if (now() - approval.at > APPROVAL_TTL_MS) {
        throw new GateApprovalError("approval expired: re-approve the current text");
      }
      if (approval.textHash !== sha256Hex(run.currentText)) {
        throw new GateApprovalError("approval is stale: the text changed after approval");
      }
      const hit = findResidualPII(run.currentText, run.rawNames);
      if (hit !== null) {
        throw new ResidualPIIError(`residual PII detected (${hit}): refusing to send`);
      }
      const gated = new GatedText(MINT, run.currentText);
      const revision = run.revision;
      const textHash = sha256Hex(run.currentText);
      const expiresAt = approval.at + APPROVAL_TTL_MS;
      bindings.set(gated, {
        mode,
        runId,
        revision,
        textHash,
        expiresAt,
        now,
        isCurrent: () => {
          const current = runs.get(runId);
          return (
            current !== undefined &&
            current.revision === revision &&
            sha256Hex(current.currentText) === textHash &&
            current.approval === approval
          );
        },
      });
      return sendFn(gated);
    },

    revoke(runId: string): void {
      const run = runs.get(runId);
      if (run === undefined) return;
      run.approval = null;
      run.revision += 1;
    },
  };
}
