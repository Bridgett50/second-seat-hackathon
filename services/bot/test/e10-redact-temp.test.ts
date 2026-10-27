import { afterEach, describe, expect, it, vi } from "vitest";
import { GlimmerClient } from "../src/private/redact.js";

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

describe("E10 redact temperature", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("E10-1: redactText body has temperature 0 and no top_p/top_k", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("E10-2: redactImage body has temperature 0 and no top_p/top_k", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactImage(Buffer.from([1, 2, 3]), "shot.png");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("E10-3: system message states never guess and empty list when none stated", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    const system = (body.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "system",
    )?.content as string;
    expect(system).toContain("never guess");
    expect(system).toContain("Use [] when none are stated");
  });
});
