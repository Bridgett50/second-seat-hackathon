// holdout dry run: the real runEval/rescoreRun paths over the frozen holdout
// with a local fake redactor. Offline only: fetch is guarded, no network,
// no model, temp dirs only.
// @ts-expect-error untyped helper module
import { dryCanaryFail, dryInterrupted, drySuccess, fetchCalls } from "../scripts/holdout-dry-run.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("holdout dry run", () => {
  it("success mode completes all 10 holdout cases with no fetch", async () => {
    const parent = mkdtempSync(join(tmpdir(), "holdout-test-success-"));
    const result = await drySuccess(parent);
    expect(result.summary.complete).toBe(true);
    expect(result.canaryFailed).toBe(false);
    expect(result.records).toHaveLength(10);
    expect(result.records.every((r: { status: string }) => r.status === "ok")).toBe(true);
    expect(fetchCalls()).toBe(0);
  });

  it("failing canary stops the batch with 9 not_run", async () => {
    const parent = mkdtempSync(join(tmpdir(), "holdout-test-canary-"));
    const result = await dryCanaryFail(parent);
    expect(result.canaryFailed).toBe(true);
    expect(result.summary.complete).toBe(false);
    expect(result.records).toHaveLength(10);
    expect(result.records[0].status).toBe("error");
    expect(result.records.slice(1).every((r: { status: string }) => r.status === "not_run")).toBe(true);
    expect(result.summary.not_run).toHaveLength(9);
    expect(fetchCalls()).toBe(0);
  });

  it("interrupted batch rescores offline with the full planned denominator", async () => {
    const parent = mkdtempSync(join(tmpdir(), "holdout-test-interrupted-"));
    const { result, rescore } = await dryInterrupted(parent);
    expect(result.summary.complete).toBe(false);
    expect(result.summary.not_run.length).toBeGreaterThan(0);
    // Offline rescore of the partial dir agrees: incomplete, same records.
    expect(rescore.complete).toBe(false);
    expect(rescore.records).toHaveLength(10);
    expect(rescore.summary.not_run).toHaveLength(result.summary.not_run.length);
    expect(fetchCalls()).toBe(0);
  });
});
