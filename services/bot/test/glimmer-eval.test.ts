import { describe, expect, it } from "vitest";
// @ts-expect-error untyped helper module
import { summarize, wilson } from "../scripts/redaction-eval-lib.mjs";

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
