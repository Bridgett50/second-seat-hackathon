// VERIFICATION.md's table must match VERIFICATION_POINTS row for row.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERIFICATION_POINTS } from "../src/index.js";

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "VERIFICATION.md"), "utf8");

function tableRows(): string[][] {
  const lines = doc.split("\n").filter((l) => l.startsWith("|"));
  return lines.slice(2).map((l) => l.slice(1, -1).split("|").map((c) => c.trim().replace(/^`|`$/g, "")));
}

describe("VERIFICATION.md", () => {
  it("uses the When / File / Check / Built by / On failure header", () => {
    expect(doc).toContain("| When | File | Check | Built by | On failure |");
  });

  it("has one row per verification point, in order, with identical cells", () => {
    expect(tableRows()).toEqual(VERIFICATION_POINTS.map((p) => [p.when, p.file, p.check, p.builtBy, p.onFailure]));
  });

  it("credits the Meta workshop and records its license status", () => {
    expect(doc).toContain("https://github.com/meta-models/legal-agent-workshop");
    expect(doc).toMatch(/no license file/);
  });
});
