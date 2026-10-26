import { afterEach, describe, expect, it, vi } from "vitest";
import { GLIMMER_MAX_TOKENS_DEFAULT, GlimmerClient } from "../src/private/redact.js";

function mockChat() {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"spans":[],"boxes":[]}' } }] }),
    })),
  );
}

describe("glimmer chat max_tokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["GLIMMER_MAX_TOKENS"];
  });

  it("includes default max_tokens in the request body", async () => {
    mockChat();
    const client = new GlimmerClient("http://localhost:9");
    await client.redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(GLIMMER_MAX_TOKENS_DEFAULT);
    expect(GLIMMER_MAX_TOKENS_DEFAULT).toBe(2048);
  });

  it("honours GLIMMER_MAX_TOKENS env", async () => {
    process.env["GLIMMER_MAX_TOKENS"] = "512";
    mockChat();
    const client = new GlimmerClient("http://localhost:9");
    await client.redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(512);
  });
});
