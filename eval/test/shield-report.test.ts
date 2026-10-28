import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, reportSplit, resolveSplit, wilson } from "../shield-report.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "shield-report.mjs");

describe("shield report", () => {
  it("refuses the held-out split before any dataset read", () => {
    expect(resolveSplit("heldout")).toEqual({ ok: false, reason: "held-out split is not run by this command" });
    const refused = reportSplit("heldout");
    expect(refused.ok).toBe(false);
    expect(refused.report).toBe("");
    const run = spawnSync(process.execPath, [script, "--split", "heldout"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/held-out/);
    expect(run.stdout).toBe("");
  });

  it("prints dev layer N/M with Wilson intervals and a mutation catch", () => {
    expect(parseArgs(["--split", "dev"]).split).toBe("dev");
    const result = reportSplit("dev");
    expect(result.ok).toBe(true);
    expect(result.report).toMatch(/^split: dev\n/);
    for (const name of ["pattern", "spark", "gate", "shield"]) {
      expect(result.report).toMatch(new RegExp(`${name}: \\d+/\\d+ Wilson95 \\[`));
    }
    expect(result.report).toMatch(/mutation: shield \d+\/\d+; mutated 0\/\d+; shield catches [1-9]\d* seeded/);
    const [lo, hi] = wilson(0, 14);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
  });
});
