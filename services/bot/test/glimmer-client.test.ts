import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GlimmerClient,
  describeGlimmerReply,
  glimmerTimeoutMs,
} from "../src/private/redact.js";

function mockChat(content = '{"spans":[],"boxes":[]}') {
  const body = {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  };
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    })),
  );
}

describe("GlimmerClient request body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["GLIMMER_TIMEOUT_MS"];
    delete process.env["GLIMMER_JSON_SCHEMA"];
    delete process.env["GLIMMER_RAW_DIR"];
  });

  it("sends temperature/top_p/top_k/chat_template_kwargs and max_tokens 2048", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    expect(body.top_k).toBe(64);
    expect(body.max_tokens).toBe(2048);
    expect(body.chat_template_kwargs).toEqual({ reasoning_strength: "low" });
  });

  it("omits response_format by default, sends json_schema only with GLIMMER_JSON_SCHEMA=1", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).not.toHaveProperty(
      "response_format",
    );

    (fetch as any).mockClear();
    process.env["GLIMMER_JSON_SCHEMA"] = "1";
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.response_format?.type).toBe("json_schema");
  });
});

describe("GlimmerClient timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["GLIMMER_TIMEOUT_MS"];
  });

  it("defaults to 90000ms", () => {
    expect(glimmerTimeoutMs()).toBe(90000);
  });

  it("reads GLIMMER_TIMEOUT_MS env", () => {
    process.env["GLIMMER_TIMEOUT_MS"] = "5000";
    expect(glimmerTimeoutMs()).toBe(5000);
  });

  it("prefers the constructor option over env", async () => {
    process.env["GLIMMER_TIMEOUT_MS"] = "5000";
    const withOpt = new GlimmerClient("http://localhost:9", { timeoutMs: 7000 });
    expect((withOpt as any).timeoutMs).toBe(7000);
    mockChat();
    await withOpt.redactText("hello");
    expect(fetch).toHaveBeenCalled();
  });
});

describe("describeGlimmerReply", () => {
  it("measures content/reasoning lengths without scoring reasoning", () => {
    const body = {
      choices: [
        {
          message: {
            content: '{"spans":[]}',
            reasoning: "think".repeat(10),
            reasoning_content: "think".repeat(5),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3 },
    };
    const d = describeGlimmerReply(body, 123);
    expect(d.contentLen).toBe('{"spans":[]}'.length);
    expect(d.reasoningLen).toBe(50);
    expect(d.reasoningContentLen).toBe(25);
    expect(d.finishReason).toBe("stop");
    expect(d.usage).toEqual({ prompt_tokens: 3 });
    expect(d.durationMs).toBe(123);
  });

  it("defaults missing fields", () => {
    const d = describeGlimmerReply({}, 0);
    expect(d).toMatchObject({
      contentLen: 0,
      reasoningLen: 0,
      reasoningContentLen: 0,
      finishReason: "unknown",
      durationMs: 0,
    });
  });
});
