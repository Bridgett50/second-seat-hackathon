import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WEB_ROOT, loadDemo, loadGlimmerLive } from "../src/loadFixtures.js";
import { parseGlimmerRecall } from "../src/modelStrip.js";
import { renderBriefPage, type Brief } from "../src/render.js";

const baseBrief: Brief = { createdAt: "2024-01-01", entries: [] };

describe("parseGlimmerRecall", () => {
  it("parses the recall line from eval stdout", () => {
    expect(
      parseGlimmerRecall(
        "redactor: Glimmer: meta-models/Muse-Glimmer-30B\nrecall: 10/10 = 1.000\nspans returned: 12\nmisses: none\n",
      ),
    ).toBe("10/10");
  });

  it("parses partial recall with surrounding spaces", () => {
    expect(parseGlimmerRecall("recall:  7 / 10 = 0.7\n")).toBe("7/10");
  });

  it("returns null when no recall line is present", () => {
    expect(parseGlimmerRecall("spans returned: 12\nmisses: none\n")).toBeNull();
    expect(parseGlimmerRecall("")).toBeNull();
  });
});

describe("glimmer live chip", () => {
  it("loads the live recall from the repo fixture", () => {
    const live = loadGlimmerLive();
    expect(live).not.toBeNull();
    expect(live?.recall).toMatch(/^\d+\/\d+$/);
  });

  it("tolerates a missing fixture file", () => {
    expect(loadGlimmerLive("/nonexistent-root")).toBeNull();
  });

  it("rejects the invalid 0/39 primary run and falls back to the n10 file", () => {
    const primary = JSON.parse(
      readFileSync(
        join(WEB_ROOT, "..", "..", "services", "bot", "fixtures", "glimmer-live-eval.json"),
        "utf8",
      ),
    ) as { eval_stdout: string };
    expect(primary.eval_stdout).toContain("error Unexpected");
    expect(parseGlimmerRecall(primary.eval_stdout)).toBe("0/39");
    const fallback = JSON.parse(
      readFileSync(
        join(WEB_ROOT, "..", "..", "services", "bot", "fixtures", "glimmer-live-eval-n10.json"),
        "utf8",
      ),
    ) as { eval_stdout: string };
    expect(fallback.eval_stdout).not.toContain("error Unexpected");
    expect(fallback.eval_stdout).not.toContain(" (error)");
    expect(parseGlimmerRecall(fallback.eval_stdout)).toBe("10/10");
    expect(loadGlimmerLive()).toEqual({ recall: "10/10", n: 10 });
  });

  it("renders the chip with the denominator and never shows 0/39", () => {
    const demo = loadDemo();
    expect(demo.glimmerLive).toEqual({ recall: "10/10", n: 10 });
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      {
        pressureFallback: demo.pressureFallback,
        payloadDemo: demo.payloadDemo,
        glimmerLive: demo.glimmerLive,
      },
    );
    expect(page).toContain("recall 10/10 (n=10)");
    expect(page).not.toContain("0/39");
  });

  it("renders the glimmer-redact chip as live with parsed recall", () => {
    const demo = loadDemo();
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      {
        pressureFallback: demo.pressureFallback,
        payloadDemo: demo.payloadDemo,
        glimmerLive: demo.glimmerLive,
      },
    );
    expect(demo.glimmerLive).not.toBeNull();
    expect(page).toContain('data-stage="glimmer-redact" data-status="live"');
    expect(page).toContain(`recall ${demo.glimmerLive?.recall}`);
  });

  it("keeps existing behavior when the fixture is absent", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      glimmerLive: null,
    });
    expect(page).not.toContain('data-stage="glimmer-redact" data-status="live"');
  });
});
