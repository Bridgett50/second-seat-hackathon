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
const perCase = [];
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
    perCase.push({ file: c.file, hits: 0, total: c.entities.length });
    continue;
  }
  let hits = 0;
  for (const e of c.entities) {
    total += 1;
    if (!maskedText.includes(e)) {
      found += 1;
      hits += 1;
    } else misses.push(`${c.file}: ${e}`);
  }
  perCase.push({ file: c.file, hits, total: c.entities.length });
}
console.log(`recall: ${found}/${total} = ${total ? (found / total).toFixed(3) : "n/a"}`);
{
  const z = 1.96;
  let lo = 0;
  let hi = 0;
  if (total > 0) {
    const p = found / total;
    const denom = 1 + (z * z) / total;
    const center = p + (z * z) / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
    lo = (center - margin) / denom;
    hi = (center + margin) / denom;
  }
  console.log(`wilson95: [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  for (const r of perCase) console.log(`case ${r.file}: ${r.hits}/${r.total}`);
}
console.log(`spans returned: ${spanTotal} (expected entities: ${total})`);
if (misses.length > 0) {
  console.log("misses:");
  for (const m of misses) console.log(` - ${m}`);
} else {
  console.log("misses: none");
}
