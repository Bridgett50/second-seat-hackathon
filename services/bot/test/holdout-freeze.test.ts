// holdout-freeze: a fresh dummy dataset verifies clean, and tampering fails.
// Offline only: spawns node on local scripts, no network, no model.
// Uses only made-up dummy text in mkdtemp dirs; never touches sealed data.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "holdout-freeze.mjs");

const madeDirs: string[] = [];
afterEach(() => {
  while (madeDirs.length > 0) {
    const d = madeDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function makeDummyDataset(): string {
  const dir = mkdtempSync(join(tmpdir(), "freeze-dummy-"));
  madeDirs.push(dir);
  const files: Record<string, string> = {
    "dummy-01.txt": "Call Ana Bell at ana.bell@example.com or 555-0100.\n",
    "dummy-02.txt": "Mail Bo Ray at bo.ray@example.org about the invoice.\n",
  };
  const cases = [
    { file: "dummy-01.txt", entities: ["Ana Bell", "ana.bell@example.com", "555-0100"] },
    { file: "dummy-02.txt", entities: ["Bo Ray", "bo.ray@example.org"] },
  ];
  const casesText = JSON.stringify(cases, null, 2) + "\n";
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, "cases.json"), casesText);
  const pinned: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) pinned[name] = sha(text);
  pinned["cases.json"] = sha(casesText);
  const manifest = { inference_runs: 0, review: { status: "pending-manual-review" }, files: pinned };
  writeFileSync(join(dir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return dir;
}

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
  it("verifies a fresh dummy dataset with exit 0", () => {
    const result = runFreeze(makeDummyDataset());
    expect(result.exit).toBe(0);
    expect(result.output).toMatch(/OK/);
  });

  it("exits 2 when --dir is missing", () => {
    try {
      execFileSync("node", [script], { encoding: "utf8", stdio: "pipe" });
      expect.unreachable();
    } catch (err: unknown) {
      const e = err as { status?: unknown; stderr?: unknown };
      expect(e.status).toBe(2);
      expect(String(e.stderr ?? "")).toMatch(/--dir/);
    }
  });

  it("exits 1 when a transcript is tampered with", () => {
    const dir = makeDummyDataset();
    const target = join(dir, "dummy-01.txt");
    writeFileSync(target, `${readFileSync(target, "utf8")}tampered\n`);
    const result = runFreeze(dir);
    expect(result.exit).toBe(1);
    expect(result.output).toMatch(/hash mismatch/);
  });

  it("exits 1 when an annotation no longer occurs verbatim", () => {
    const dir = makeDummyDataset();
    const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
    cases[0].entities.push("nobody-here-999@example.com");
    const casesText = JSON.stringify(cases);
    writeFileSync(join(dir, "cases.json"), casesText);
    // Re-pin the edited cases.json so the failure is the annotation check, not the hash.
    const manifestPath = join(dir, "MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files["cases.json"] = createHash("sha256").update(casesText, "utf8").digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const result = runFreeze(dir);
    expect(result.exit).toBe(1);
    expect(result.output).toMatch(/not verbatim/);
  });
});
