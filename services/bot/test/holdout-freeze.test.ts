// holdout-freeze: the pinned holdout verifies clean, and any tampering fails.
// Offline only: spawns node on local scripts, no network, no model.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "holdout-freeze.mjs");
const holdoutDir = join(here, "..", "fixtures", "holdout-v1");

function runFreeze(dir: string) {
  try {
    const stdout = execFileSync("node", [script, "--dir", dir], { encoding: "utf8" });
    return { exit: 0, output: stdout };
  } catch (err: unknown) {
    const e = err as { status?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      exit: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("holdout freeze", () => {
  it("verifies the pinned holdout with exit 0", () => {
    const result = runFreeze(holdoutDir);
    expect(result.exit).toBe(0);
    expect(result.output).toMatch(/OK/);
  });

  it("exits 1 when a transcript is tampered with", () => {
    const copy = mkdtempSync(join(tmpdir(), "holdout-tampered-"));
    cpSync(holdoutDir, copy, { recursive: true });
    const target = join(copy, "holdout-01.txt");
    writeFileSync(target, `${readFileSync(target, "utf8")}tampered\n`);
    const result = runFreeze(copy);
    expect(result.exit).toBe(1);
    expect(result.output).toMatch(/hash mismatch/);
  });

  it("exits 1 when an annotation no longer occurs verbatim", () => {
    const copy = mkdtempSync(join(tmpdir(), "holdout-annotation-"));
    cpSync(holdoutDir, copy, { recursive: true });
    const cases = JSON.parse(readFileSync(join(copy, "cases.json"), "utf8"));
    cases[0].entities.push("nobody-here-999@example.com");
    const casesText = JSON.stringify(cases);
    writeFileSync(join(copy, "cases.json"), casesText);
    // Re-pin the edited cases.json so the failure is the annotation check, not the hash.
    const manifestPath = join(copy, "MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files["cases.json"] = createHash("sha256").update(casesText, "utf8").digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const result = runFreeze(copy);
    expect(result.exit).toBe(1);
    expect(result.output).toMatch(/not verbatim/);
  });
});
