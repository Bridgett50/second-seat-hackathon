import { describe, expect, it } from "vitest";
import { loadDemo } from "../src/loadFixtures.js";
import { renderBriefPage } from "../src/render.js";

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
});
