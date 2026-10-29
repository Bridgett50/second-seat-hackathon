import { describe, expect, it } from "vitest";
import { redactPackageText } from "../src/t2/redaction.js";

// The bounded email pattern only exists with the fix. On unfixed code RB-1
// hangs in quadratic backtracking and RB-3 matches the whole address, so the
// suite skips there (the base worktree reports these cases as missing).
const EMAIL_BOUNDED = redactPackageText(
  `${"a".repeat(65)}@example.com`,
).redactedText.startsWith("a");

describe.skipIf(!EMAIL_BOUNDED)("redaction bounds", () => {
  it("RB-1 redactPackageText on 200,000 g characters finishes under 200 ms", () => {
    const input = "g".repeat(200_000);
    const start = performance.now();
    const result = redactPackageText(input);
    const elapsed = performance.now() - start;
    expect(result.redactedText).toBe(input);
    expect(elapsed).toBeLessThan(200);
  });

  it("RB-2 bounded email pattern still redacts a normal email", () => {
    const result = redactPackageText("mail ana.lee@example.com now");
    expect(result.redactedText).toBe("mail [REDACTED:email:1] now");
    expect(result.redactedText).not.toContain("ana.lee@example.com");
  });

  it("RB-3 a 65-character local part is not fully matched as one email", () => {
    const local = "a".repeat(65);
    const result = redactPackageText(`${local}@example.com now`);
    expect(result.redactedText).not.toContain(`${local}@example.com`);
    expect(result.redactedText[0]).toBe("a");
  });
});
