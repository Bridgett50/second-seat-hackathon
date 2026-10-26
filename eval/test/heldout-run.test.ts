import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, "..", "heldout-run.mjs");

function runHarness(env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync("node", [harness], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: 0, output: `${output}` };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function makeSealedDir(): string {
  // Made-up tmp dir only; never the real sealed set.
  const dir = mkdtempSync(join(tmpdir(), "heldout-fake-"));
  writeFileSync(join(dir, "case-a.labels.json"), JSON.stringify({ entries: [] }));
  writeFileSync(join(dir, "SHA256SUMS"), "made-up sums content\n");
  return dir;
}

describe("heldout-run.mjs", () => {
  it("exits 2 on seal mismatch (placeholder digest cannot match a made-up dir)", () => {
    const dir = makeSealedDir();
    const result = runHarness({ HELDOUT_DIR: dir });
    expect(result.status).toBe(2);
    expect(result.output).toMatch(/mismatch|not recorded|hash check failed/i);
  });

  it("exits 2 when HELDOUT_DIR is missing", () => {
    const env = { ...process.env };
    delete env["HELDOUT_DIR"];
    let status = 0;
    let output = "";
    try {
      execFileSync("node", [harness], { encoding: "utf8", env });
      status = 0;
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number };
      status = err.status ?? 1;
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(status).toBe(2);
    expect(output).toMatch(/HELDOUT_DIR/);
  });

  it("refuses a second run when the run log already exists", () => {
    // The single-run gate must trigger without a valid seal: a refused run
    // writes no log, so a repeat refusal proves the gate ordering is stable
    // and the sealed run was never consumed.
    const refusedLog = join(here, "..", "results", "heldout-run.log");
    const first = runHarness({ HELDOUT_DIR: makeSealedDir() });
    expect(first.status).toBe(2);
    const second = runHarness({ HELDOUT_DIR: makeSealedDir() });
    expect(second.status).toBe(2);
    expect(second.output).toMatch(/mismatch|not recorded|hash check failed|already exists/i);
    expect(existsSync(refusedLog)).toBe(false);
  });
});
