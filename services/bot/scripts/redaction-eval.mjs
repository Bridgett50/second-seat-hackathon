// Redaction eval: measured recall over labelled PII fixtures, misses listed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { MockRedactor } = await import("../dist/src/private/redact.js");
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pii");
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
const redactor = new MockRedactor();
let total = 0;
let found = 0;
const misses = [];
for (const c of cases) {
  const text = readFileSync(join(dir, c.file), "utf8");
  const { maskedText } = await redactor.redactText(text);
  for (const e of c.entities) {
    total += 1;
    if (!maskedText.includes(e)) found += 1;
    else misses.push(`${c.file}: ${e}`);
  }
}
console.log(`recall: ${found}/${total} = ${total ? (found / total).toFixed(3) : "n/a"}`);
if (misses.length > 0) {
  console.log("misses:");
  for (const m of misses) console.log(` - ${m}`);
} else {
  console.log("misses: none");
}
