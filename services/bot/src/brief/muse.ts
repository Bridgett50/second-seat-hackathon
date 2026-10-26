/**
 * Muse Spark brief client.
 *
 * - `BriefClient` interface: live (`MuseClient`, via fetch) and recorded
 *   (`FixtureClient`) implementations share it.
 * - Model: `muse-spark-1.3` (Standard mode, never `-contributor`) via
 *   POST https://api.meta.ai/v1/chat/completions, `developer` role,
 *   `response_format: {type:"json_schema", ...strict:true}`, sampling unset,
 *   fixed `seed` (best-effort), `max_completion_tokens` 16000.
 * - Developer prompt + schema first, transcript last inside <data> tags.
 * - Retries 429/5xx with backoff + Retry-After; never retries a 400.
 * - Without an API key, only fixture mode is available.
 */
import { EVIDENCE_BRIEF_JSON_SCHEMA } from "@second-seat/core";
import { checkCapsPreCall, checkPerCallTokenCap, recordCall } from "./costGuard.js";

export const BRIEF_MODEL = "muse-spark-1.3";
export const BRIEF_PROMPT_VERSION = "brief-v2";
export const BRIEF_API_URL = "https://api.meta.ai/v1/chat/completions";
export const BRIEF_MAX_COMPLETION_TOKENS = 16000;
export const BRIEF_SEED = 42;

export interface BriefSourceInput {
  meetingId: string;
  transcriptText: string;
  framesSidecarText: string;
  fixtureMode: boolean;
}

export interface BriefUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface BriefResult {
  rawText: string;
  usage: BriefUsage;
  model: string;
  promptVersion: string;
  fixture: boolean;
}

export interface BriefClient {
  readonly mode: "fixture" | "live";
  completeBrief(input: BriefSourceInput): Promise<BriefResult>;
}

function apiKey(): string | null {
  const key = process.env["META_API_KEY"] ?? process.env["MUSE_API_KEY"] ?? "";
  return key === "" ? null : key;
}

/** True when no API key is configured: fixture-only. */
export function isFixtureOnly(): boolean {
  return apiKey() === null;
}

export function briefMode(): "fixture" | "live" {
  if ((process.env["EVIDENCE_BRIEF_MODE"] ?? "fixture") === "live") {
    if (isFixtureOnly()) {
      throw new Error("EVIDENCE_BRIEF_MODE=live but no API key (set META_API_KEY)");
    }
    return "live";
  }
  return "fixture";
}

async function loadDeveloperPrompt(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const candidates = [
    new URL("../../prompts/brief-v2.txt", import.meta.url),
    new URL("../../../prompts/brief-v2.txt", import.meta.url),
  ];
  const url = candidates.find((u) => existsSync(fileURLToPath(u))) ?? candidates[0]!;
  return readFile(url, "utf8");
}

export async function buildUserMessage(input: BriefSourceInput): Promise<string> {
  return [
    `meetingId: ${input.meetingId}`,
    `model: ${BRIEF_MODEL}`,
    `promptVersion: ${BRIEF_PROMPT_VERSION}`,
    `fixtureMode: ${String(input.fixtureMode)}`,
    "",
    "JSON Schema the output must match (strict):",
    JSON.stringify(EVIDENCE_BRIEF_JSON_SCHEMA),
    "",
    "<data>",
    "frames sidecar (frames.txt):",
    input.framesSidecarText.trim() === "" ? "(no frames)" : input.framesSidecarText,
    "",
    "transcript (transcript.txt) — the evidence, last:",
    input.transcriptText,
    "</data>",
  ].join("\n");
}

export async function buildRedactedUserMessage(input: BriefSourceInput): Promise<string> {
  const { defaultRedactor } = await import("../private/redact.js");
  const { logText, setRedactorLabel } = await import("../private/payloadLog.js");
  const redactor = defaultRedactor();
  setRedactorLabel(redactor.label);
  const redacted = await redactor.redactText(input.transcriptText);
  logText(redacted.maskedText);
  return buildUserMessage({ ...input, transcriptText: redacted.maskedText });
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(header: string | null, attempt: number): number {
  const retryAfter = header === null ? NaN : Number(header);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}

async function postChat(body: Record<string, unknown>, key: string): Promise<Response> {
  const maxAttempts = 4;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(BRIEF_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (response.status === 400) {
      const text = await response.text();
      throw new Error(`muse-spark request rejected (400, not retried): ${text.slice(0, 500)}`);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= maxAttempts - 1) {
        const text = await response.text();
        throw new Error(`muse-spark request failed after retries (${response.status}): ${text.slice(0, 500)}`);
      }
      await sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`muse-spark request failed (${response.status}, not retried): ${text.slice(0, 500)}`);
    }
    return response;
  }
}

/** Accumulate a streamed SSE chat-completion body into content + usage. */
async function readStreamedChat(response: Response): Promise<{ content: string; usage: ChatResponse["usage"] }> {
  const chunks: string[] = [];
  let usage: ChatResponse["usage"] = {};
  const reader = response.body?.getReader();
  if (reader === undefined || reader === null) {
    throw new Error("muse-spark streaming response has no body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice("data:".length).trim();
        if (data === "[DONE]") {
          continue;
        }
        let event: { choices?: Array<{ delta?: { content?: string } }>; usage?: ChatResponse["usage"] };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          continue;
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          chunks.push(delta);
        }
        if (event.usage !== undefined) {
          usage = event.usage;
        }
      }
    }
  }
  return { content: chunks.join(""), usage };
}

export class MuseClient implements BriefClient {
  readonly mode = "live" as const;

  async completeBrief(input: BriefSourceInput): Promise<BriefResult> {
    const key = apiKey();
    if (key === null) {
      throw new Error("live mode requires META_API_KEY; without the key, stay fixture-only");
    }
    await checkCapsPreCall();
    // Phase 04a: transcript text passes redactText before Spark; log masked payload.
    const { defaultRedactor } = await import("../private/redact.js");
    const { logText, setRedactorLabel } = await import("../private/payloadLog.js");
    const redactor = defaultRedactor();
    setRedactorLabel(redactor.label);
    const redacted = await redactor.redactText(input.transcriptText);
    logText(redacted.maskedText);
    const redactedInput: BriefSourceInput = { ...input, transcriptText: redacted.maskedText };
    const [developerPrompt, userMessage] = await Promise.all([loadDeveloperPrompt(), buildUserMessage(redactedInput)]);
    // Rough pre-call guard: ~4 chars per token.
    checkPerCallTokenCap(Math.ceil((developerPrompt.length + userMessage.length) / 4), BRIEF_MAX_COMPLETION_TOKENS);
    const startedAt = Date.now();
    void startedAt;
    const response = await postChat(
      {
        model: BRIEF_MODEL,
        reasoning_effort: "medium",
        seed: BRIEF_SEED,
        max_completion_tokens: BRIEF_MAX_COMPLETION_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "evidence_brief",
            strict: true,
            schema: EVIDENCE_BRIEF_JSON_SCHEMA,
          },
        },
        messages: [
          { role: "developer", content: developerPrompt },
          { role: "user", content: userMessage },
        ],
      },
      key,
    );
    const { content, usage } = await readStreamedChat(response);
    const result: BriefResult = {
      rawText: content,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
      model: BRIEF_MODEL,
      promptVersion: BRIEF_PROMPT_VERSION,
      fixture: false,
    };
    await recordCall(result.usage, { model: result.model, promptVersion: result.promptVersion });
    return result;
  }
}

export interface RecordedFixture {
  recordedFromLiveCall: boolean;
  model: string;
  promptVersion: string;
  timestamp: string;
  rawText: string;
  usage: BriefUsage;
}

/**
 * Fixture client: returns a recorded response from a logged live call.
 * Never hand-write a fixture shown as model output: the file must carry
 * `recordedFromLiveCall: true`. Fixture mode with no fixture file fails.
 */
export class FixtureClient implements BriefClient {
  readonly mode = "fixture" as const;
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async completeBrief(_input: BriefSourceInput): Promise<BriefResult> {
    const { readFile } = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await readFile(this.fixturePath, "utf8");
    } catch {
      throw new Error(`fixture mode: no fixture file at ${this.fixturePath}`);
    }
    const recorded = JSON.parse(raw) as Partial<RecordedFixture>;
    if (recorded.recordedFromLiveCall !== true || typeof recorded.rawText !== "string") {
      throw new Error(`fixture mode: ${this.fixturePath} is not a recorded live response`);
    }
    const usage: BriefUsage = {
      inputTokens: recorded.usage?.inputTokens ?? 0,
      cachedTokens: recorded.usage?.cachedTokens ?? 0,
      outputTokens: recorded.usage?.outputTokens ?? 0,
      reasoningTokens: recorded.usage?.reasoningTokens ?? 0,
    };
    await recordCall(usage, {
      model: recorded.model ?? "unknown",
      promptVersion: recorded.promptVersion ?? "unknown",
      fixture: true,
    });
    return {
      rawText: recorded.rawText,
      usage,
      model: recorded.model ?? "unknown",
      promptVersion: recorded.promptVersion ?? BRIEF_PROMPT_VERSION,
      fixture: true,
    };
  }
}

/** Default client: fixture unless EVIDENCE_BRIEF_MODE=live with a key. */
export function defaultBriefClient(fixturePath: string): BriefClient {
  if (briefMode() === "live") {
    return new MuseClient();
  }
  return new FixtureClient(fixturePath);
}
