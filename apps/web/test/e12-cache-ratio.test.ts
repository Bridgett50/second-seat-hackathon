import { describe, expect, it } from "vitest";
import { loadDemo } from "../src/loadFixtures.js";
import { renderBriefPage } from "../src/render.js";

describe("E12 prompt-cache hit ratio", () => {
  it("cacheHitRatio aggregates cached/input across calls", async () => {
    const mod = await import("../src/cacheRatio.js").catch(() => null);
    expect(mod, "cacheRatio module is present").not.toBeNull();
    if (mod === null) return;
    const { cacheHitRatio } = mod;
    expect(cacheHitRatio([{ inputTokens: 2271, cachedTokens: 0 }])).toEqual({
      cached: 0,
      input: 2271,
      calls: 1,
      percent: 0,
    });
    expect(
      cacheHitRatio([
        { inputTokens: 1000, cachedTokens: 250 },
        { inputTokens: 1000, cachedTokens: 750 },
      ]).percent,
    ).toBe(50);
  });

  it("demo page shows the cache-ratio element with recorded usage", () => {
    const demo = loadDemo();
    const page = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {
      pressureFallback: demo.pressureFallback,
      payloadDemo: demo.payloadDemo,
      glimmerLive: demo.glimmerLive,
      briefScore: demo.briefScore,
      seededScore: demo.seededScore,
      heroChain: demo.heroChain,
      cacheUsage: (demo as unknown as { cacheUsage?: { inputTokens: number; cachedTokens: number }[] })
        .cacheUsage ?? [],
    } as Parameters<typeof renderBriefPage>[4]);
    expect(page).toContain('id="cache-ratio"');
    expect(page).toContain('data-cached="0"');
    expect(page).toContain('data-input="2271"');
  });
});
