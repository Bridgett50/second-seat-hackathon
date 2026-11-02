import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");

const A1 = "Changes were reviewed by independent AI reviewers and checked by automated tests, with the results documented in the repo.";
const A2 = "The meeting room you just saw is a scripted demo with no model calls. Meta's Glimmer and Spark run in a separate transcript workflow.";
const A3 = "Muse Code wrote most of the code. Cursor did a repair pass, I directed the work and made hand edits, and other AI tools reviewed it. PROVENANCE.md records who did what.";
const A4 = "Pre-existing: the idea, an earlier prototype, and my AI-self portrait. Built during the event (Oct 26–Nov 4): all the code, partly in a companion repo and brought over on Oct 30.";

const banned = [
  "Every change was independently reviewed and tested",
  "everything in this repo",
  "Muse Code wrote it. Opus reviewed it.",
  "Do not change a word",
  "127 commits",
  "authored 142",
  "51 commits",
  "196 commits",
];

function parseSlots(text: string) {
  const re = /\[(\d+):(\d+)-(\d+):(\d+)\]/g;
  const slots: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    slots.push({ start: parseInt(m[1]!) * 60 + parseInt(m[2]!), end: parseInt(m[3]!) * 60 + parseInt(m[4]!) });
  }
  return slots;
}

describe("docs honesty edits 1-4", () => {
  it("approved texts present where required", () => {
    const readme = rd("README.md");
    const rec = rd("RECORDING_SCRIPT.md");
    const sub = rd("docs/submission/video-script.md");
    const fields = rd("docs/submission/submission-fields.md");
    const eng = rd("docs/engineering-log.md");
    const prov = rd("PROVENANCE.md");
    // A1
    expect(readme).toContain(A1);
    expect(rec).toContain(A1);
    expect(sub).toContain(A1);
    // A2
    expect(rec).toContain(A2);
    expect(sub).toContain(A2);
    // A3
    expect(rec).toContain(A3);
    expect(sub).toContain(A3);
    expect(readme).toContain(A3);
    expect(fields).toContain(A3);
    expect(eng).toContain(A3);
    // A4
    expect(readme.split("\n")[0]).toBe(A4);
    expect(eng.split("\n")[0]).toBe(A4);
    expect(fields).toContain(A4);
    expect(rec).toContain(A4);
    expect(sub).toContain(A4);
    // revised phrase
    expect(rec).toContain("revised Nov 1, 2026 with owner approval");
    expect(sub).toContain("revised Nov 1, 2026 with owner approval");
    // PR #139
    expect(prov).toContain("PR #139");
    expect(prov).toContain("Oct 30, 2026");
    // scripts identical lines 3-21
    const recLines = rec.split("\n").slice(2, 21);
    const subLines = sub.split("\n").slice(2, 21);
    expect(recLines).toEqual(subLines);
  });

  it("slot labels contiguous and end before 3:00", () => {
    for (const p of ["RECORDING_SCRIPT.md", "docs/submission/video-script.md"]) {
      const text = rd(p);
      const slots = parseSlots(text);
      expect(slots.length).toBe(5);
      expect(slots[0]!.start).toBe(0);
      for (let i = 1; i < slots.length; i++) expect(slots[i]!.start).toBe(slots[i - 1]!.end);
      expect(slots[slots.length - 1]!.end).toBeLessThanOrEqual(180);
    }
  });

  it("banned stale phrases absent", () => {
    const files = [
      "README.md",
      "RECORDING_SCRIPT.md",
      "docs/submission/video-script.md",
      "docs/submission/submission-fields.md",
      "docs/engineering-log.md",
      "docs/release/final-repair-acceptance.md",
      "PROVENANCE.md",
    ];
    for (const f of files) {
      const c = rd(f);
      for (const b of banned) expect(c).not.toContain(b);
    }
  });

  it("PROVENANCE has no empty Session B heading", () => {
    const prov = rd("PROVENANCE.md");
    const lines = prov.split("\n");
    expect(lines.filter((l) => l === "## Session B").length).toBe(0);
    expect(lines.filter((l) => l === "## Session B: meeting room page (written fresh in the event repo, Oct 29, 2026)").length).toBe(1);
  });
});
