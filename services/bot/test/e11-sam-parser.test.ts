import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FixtureSamClient,
  LiveSamClient,
  buildRequestBody,
  type SamFrame,
} from "../src/vision/sam.js";

const WIRE =
  "<0f>0<|box;x1=200;y1=140;x2=599;y2=339;w=800;h=400;c=0.87|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";

const FRAME: SamFrame = { id: "e11", width: 800, height: 400, png: Buffer.alloc(8) };

const ENV_KEYS = [
  "SECOND_SEAT_EXPERIMENTAL_IMAGES",
  "MODEL_API_KEY",
  "META_API_KEY",
  "MUSE_API_KEY",
  "SAM_MODE",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe("E11 sam official parser", () => {
  it("E11-1: request metadata asks for confidence", () => {
    const body = buildRequestBody(FRAME, "slide");
    const metadata = body["metadata"] as Record<string, unknown>;
    expect(metadata["include_confidence"]).toBe("true");
    expect(metadata["mask_encoding"]).toBe("one_bit");
  });

  it("E11-2: default fixture runs the official parser with confidence", async () => {
    const result = await new FixtureSamClient().segmentShared(FRAME);
    expect(result.parser).toBe("@meta-sam/parser");
    expect(result.boxes).toEqual([{ x: 200, y: 140, w: 400, h: 200, confidence: 0.87 }]);
  });

  it("E11-3: live path parses SSE through the official parser", async () => {
    process.env["SECOND_SEAT_EXPERIMENTAL_IMAGES"] = "1";
    process.env["MODEL_API_KEY"] = "test-key-not-real";
    delete process.env["META_API_KEY"];
    delete process.env["MUSE_API_KEY"];

    const deltaEvt = {
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta: WIRE,
    };
    const doneEvt = {
      type: "response.output_text.done",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      text: WIRE,
    };
    const completedEvt = { type: "response.completed" };
    const sse = [deltaEvt, doneEvt, completedEvt]
      .map((e) => `data: ${JSON.stringify(e)}\n\n`)
      .join("");

    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      (async (_url: unknown, init?: { body?: unknown }) => {
        sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return { ok: true, status: 200, text: async () => sse };
      }) as unknown as typeof fetch,
    );

    const result = await new LiveSamClient().segmentShared(FRAME, "slide");
    expect(result.parser).toBe("@meta-sam/parser");
    expect(result.boxes).toEqual([{ x: 200, y: 140, w: 400, h: 200, confidence: 0.87 }]);
    const metadata = sentBody["metadata"] as Record<string, unknown>;
    expect(metadata["include_confidence"]).toBe("true");
  });

  it("E11-4: object fixture still uses the local parser", async () => {
    const client = new FixtureSamClient({
      mask_encoding: "one_bit",
      boxes: [{ x1: 10, y1: 20, x2: 19, y2: 29 }],
    });
    const result = await client.segmentShared(FRAME);
    expect(result.parser).toBe("local");
    expect(result.boxes).toEqual([{ x: 10, y: 20, w: 10, h: 10 }]);
  });
});
