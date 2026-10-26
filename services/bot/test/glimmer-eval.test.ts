import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error untyped helper module
import { annotateOccurrences, scoreSpans, summarize, wilson } from "../scripts/redaction-eval-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("wilson", () => {
  it("returns [0,0] for n=0", () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("matches the Wilson score interval for 8/8", () => {
    const [lo, hi] = wilson(8, 8) as [number, number];
    expect(lo).toBeCloseTo(0.676, 2);
    expect(hi).toBeCloseTo(1.0, 2);
  });

  it("widens as n shrinks", () => {
    const [, hi1] = wilson(1, 1) as [number, number];
    const [lo1] = wilson(1, 1) as [number, number];
    const [lo8] = wilson(8, 8) as [number, number];
    expect(hi1 - lo1).toBeGreaterThan(1.0 - lo8);
  });
});

describe("summarize", () => {
  it("computes recall only over completed cases", () => {
    const s = summarize([
      { file: "a", hits: 4, total: 5, status: "ok" },
      { file: "b", hits: 0, total: 3, status: "error", error: "boom" },
      { file: "c", hits: 0, total: 0, status: "not_run" },
    ]);
    expect(s.recall).toEqual({ k: 4, n: 5 });
    expect(s.complete).toBe(false);
    expect(s.failures).toEqual(["b: boom"]);
    expect(s.not_run).toEqual(["c"]);
    expect(s.wilson95).toHaveLength(2);
  });

  it("is complete only when every case is ok", () => {
    const s = summarize([
      { file: "a", hits: 5, total: 5, status: "ok" },
      { file: "b", hits: 3, total: 3, status: "ok" },
    ]);
    expect(s.complete).toBe(true);
    expect(s.recall).toEqual({ k: 8, n: 8 });
  });
});

describe("scoreSpans", () => {
  it("masks one digit of an account number: span not covered, char coverage partial", () => {
    const text = "account acct 88123456 closed";
    const expected = annotateOccurrences(text, ["88123456"]);
    expect(expected).toHaveLength(1);
    // Predict every char of the span except one digit.
    const [span] = expected;
    const predicted = [{ start: span.start, end: span.end - 1 }];
    const s = scoreSpans(text, expected, predicted);
    expect(s.covered).toBe(0);
    expect(s.expected).toBe(1);
    expect(s.piiCharsMasked).toBe(s.piiChars - 1);
    expect(s.charCoverage).toBeGreaterThan(0);
    expect(s.charCoverage).toBeLessThan(1);
  });

  it("whole-transcript mask gives full coverage and over-redaction above 0.9", () => {
    const text = "Caller Alex Rivera, phone 555-0100, thanks";
    const expected = annotateOccurrences(text, ["Alex Rivera", "555-0100"]);
    const s = scoreSpans(text, expected, [{ start: 0, end: text.length }]);
    expect(s.covered).toBe(s.expected);
    expect(s.charCoverage).toBe(1);
    expect(s.overRedaction).toBeGreaterThan(0.9);
  });

  it("repeated entities yield one span per occurrence", () => {
    const text = readFileSync(join(here, "..", "fixtures", "pii-scoring", "repeat-01.txt"), "utf8");
    const spans = annotateOccurrences(text, ["priya.nair@example.com", "Priya Nair"]);
    expect(spans).toHaveLength(6);
  });

  it("clean negative controls have 0 expected and still measure over-redaction", () => {
    for (const file of ["clean-01.txt", "clean-02.txt"]) {
      const text = readFileSync(join(here, "..", "fixtures", "pii-scoring", file), "utf8");
      const s = scoreSpans(text, annotateOccurrences(text, []), [{ start: 0, end: 5 }]);
      expect(s.expected).toBe(0);
      expect(s.covered).toBe(0);
      expect(s.nonPii).toBeGreaterThan(0);
      expect(s.nonPiiMasked).toBeGreaterThan(0);
      expect(s.overRedaction).toBeGreaterThan(0);
    }
  });
});

describe("summarize end-to-end", () => {
  it("failed and not_run cases keep expected counts in the end-to-end denominator", () => {
    const planned = [
      { file: "a", total: 5, expected: 5 },
      { file: "b", total: 3, expected: 3 },
      { file: "c", total: 4, expected: 4 },
    ];
    const s = summarize(
      [
        { file: "a", hits: 4, total: 5, status: "ok", span: { covered: 4, expected: 5, piiChars: 10, piiCharsMasked: 8, nonPii: 20, nonPiiMasked: 1 } },
        { file: "b", hits: 0, total: 3, status: "error", error: "boom" },
        { file: "c", hits: 0, total: 4, status: "not_run" },
      ],
      planned,
    );
    expect(s.request_completion).toEqual({ completed: 1, planned: 3 });
    expect(s.legacy_entity_disappearance.completed).toEqual({ k: 4, n: 5 });
    expect(s.legacy_entity_disappearance.end_to_end).toEqual({ k: 4, n: 12 });
    expect(s.recall_completed).toEqual({ k: 4, n: 5 });
    expect(s.recall_end_to_end).toEqual({ k: 4, n: 12 });
    expect(s.wilson95_recall_completed).toHaveLength(2);
    expect(s.wilson95_recall_end_to_end).toHaveLength(2);
  });

  it("rescore of the glimmer-run fixture gives 6/8, 18/29 completed, 18/39 end-to-end legacy", () => {
    const script = join(here, "..", "scripts", "rescore-glimmer-run.mjs");
    const output = execFileSync("node", [script], { encoding: "utf8" });
    expect(output).toContain("requests: 6/8");
    expect(output).toContain("legacy completed: 18/29");
    expect(output).toContain("legacy end-to-end: 18/39");
    const rescore = JSON.parse(
      readFileSync(join(here, "..", "fixtures", "glimmer-run", "rescore.json"), "utf8"),
    ) as {
      request_completion: { completed: number; planned: number };
      legacy_entity_disappearance: { completed: { k: number; n: number }; end_to_end: { k: number; n: number } };
      span_coverage: null;
    };
    expect(rescore.request_completion).toEqual({ completed: 6, planned: 8 });
    expect(rescore.legacy_entity_disappearance.completed).toEqual({ k: 18, n: 29 });
    expect(rescore.legacy_entity_disappearance.end_to_end).toEqual({ k: 18, n: 39 });
    expect(rescore.span_coverage).toBeNull();
  });
});
