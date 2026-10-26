import { describe, expect, it } from "vitest";
import { loadDemo } from "../src/loadFixtures.js";
import { renderBriefPage, type Brief } from "../src/render.js";

const baseBrief: Brief = { createdAt: "2024-01-01", entries: [] };

function countBadges(page: string): number {
  return (page.match(/class="pressure-badge"/g) ?? []).length;
}

function heldStatus(page: string): string {
  const m = page.match(/<p id="draft-status">(.*?)<\/p>/);
  if (!m || m[1] === undefined) throw new Error("draft-status missing");
  return m[1];
}

function html(): string {
  const demo = loadDemo();
  return renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {
    pressureFallback: demo.pressureFallback,
    payloadDemo: demo.payloadDemo,
  });
}

describe("renderBriefPage", () => {
  it("performs no network calls from inline script", () => {
    const page = html();
    expect(page).not.toContain("fetch(");
    expect(page).not.toContain("XMLHttpRequest");
  });

  it("shows no live-call button by default", () => {
    expect(html()).not.toContain("live-call-btn");
  });

  it("shows a live-call button only with liveDev", () => {
    const demo = loadDemo();
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      { liveDev: true, payloadDemo: demo.payloadDemo },
    );
    expect(page).toContain('id="live-call-btn"');
  });

  it("renders Copy disabled in the initial HTML", () => {
    expect(html()).toContain('id="btn-copy" disabled');
  });

  it("renders the replay label with the brief timestamp", () => {
    const demo = loadDemo();
    expect(html()).toContain(
      `Analysis precomputed ${demo.brief.createdAt}`,
    );
  });

  it("held count equals the number of pressure badges", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [
        { id: "p1", text: "one", segmentIds: ["t-00:01", "t-00:02"] },
        { id: "p2", text: "two", segmentIds: ["t-00:03"] },
      ],
    });
    expect(countBadges(page)).toBe(3);
    expect(heldStatus(page)).toBe("Held: review the 3 pressure items first");
  });

  it("pluralizes the held message", () => {
    const one = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [{ id: "p1", text: "one", segmentIds: ["t-00:01"] }],
    });
    expect(heldStatus(one)).toBe("Held: review the 1 pressure item first");
    const many = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [{ id: "p1", text: "one", segmentIds: ["t-00:01", "t-00:02"] }],
    });
    expect(heldStatus(many)).toBe("Held: review the 2 pressure items first");
  });

  it("frame renders an inline data-uri img when pngBase64 given", () => {
    const brief: Brief = {
      createdAt: "2024-01-01",
      entries: [
        {
          id: "e1",
          category: "x",
          text: "see frame",
          speaker: null,
          citations: [
            { kind: "frame", segmentId: null, frameId: "f-00:01", region: null },
          ],
          flags: [],
        },
      ],
    };
    const withPng = renderBriefPage(
      brief,
      [],
      [{ id: "f-00:01", file: "a.png", time: "00:01", pngBase64: "iVBORw0=" }],
      [],
    );
    expect(withPng).toContain('<img src="data:image/png;base64,iVBORw0="');
    const missing = renderBriefPage(
      brief,
      [],
      [{ id: "f-00:01", file: "a.png", time: "00:01" }],
      [],
    );
    expect(missing).toContain("frame image missing");
    expect(missing).not.toContain("data:image/png;base64,");
  });
});
