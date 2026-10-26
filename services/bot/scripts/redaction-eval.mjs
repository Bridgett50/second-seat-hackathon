// Redaction eval: measured recall over labelled PII fixtures, misses listed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { MockRedactor, defaultRedactor } = await import("../dist/src/private/redact.js");
void MockRedactor;
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pii");
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
const redactor = defaultRedactor();
console.log(`redactor: ${redactor.label}`);
let total = 0;
let found = 0;
let spanTotal = 0;
const misses = [];
for (const c of cases) {
  const text = readFileSync(join(dir, c.file), "utf8");
  let maskedText;
  try {
    const result = await redactor.redactText(text);
    maskedText = result.maskedText;
    spanTotal += result.spans.length;
  } catch {
    for (const e of c.entities) {
      total += 1;
      misses.push(`${c.file}: ${e} (error)`);
    }
    continue;
  }
  for (const e of c.entities) {
    total += 1;
    if (!maskedText.includes(e)) found += 1;
    else misses.push(`${c.file}: ${e}`);
  }
}
console.log(`recall: ${found}/${total} = ${total ? (found / total).toFixed(3) : "n/a"}`);
console.log(`spans returned: ${spanTotal} (expected entities: ${total})`);
if (misses.length > 0) {
  console.log("misses:");
  for (const m of misses) console.log(` - ${m}`);
} else {
  console.log("misses: none");
}
