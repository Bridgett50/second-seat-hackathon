// Holdout freeze check: verifies fixtures/holdout-v1/ against MANIFEST.json.
// Offline only: reads local files, never touches the network or any model.
// Exit 0 when every hash matches and every annotation occurs verbatim;
// exit 1 with a reason on any mismatch.
//
// Usage: node scripts/holdout-freeze.mjs [--dir <holdout-dir>]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
}

const dir = flagValue("--dir") ?? join(here, "..", "fixtures", "holdout-v1");
const failures = [];
const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dir, "MANIFEST.json"), "utf8"));
} catch (err) {
  console.error(`holdout-freeze: cannot read MANIFEST.json: ${err.message}`);
  process.exit(1);
}

if (manifest.inference_runs !== 0) {
  failures.push(`MANIFEST inference_runs is ${JSON.stringify(manifest.inference_runs)}, expected 0`);
}
if (manifest?.review?.status !== "pending-manual-review") {
  failures.push(`MANIFEST review.status is ${JSON.stringify(manifest?.review?.status)}, expected "pending-manual-review"`);
}

const files = manifest.files ?? {};
for (const [file, want] of Object.entries(files)) {
  let text;
  try {
    text = readFileSync(join(dir, file), "utf8");
  } catch (err) {
    failures.push(`missing file ${file}: ${err.message}`);
    continue;
  }
  const got = sha256Hex(text);
  if (got !== want) failures.push(`hash mismatch ${file}: manifest ${want}, actual ${got}`);
}

// Every file on disk (other than MANIFEST.json) must be pinned in the manifest.
for (const entry of readdirSync(dir)) {
  if (entry === "MANIFEST.json") continue;
  if (!(entry in files)) failures.push(`unpinned file on disk: ${entry}`);
}

let cases;
try {
  cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
} catch (err) {
  console.error(`holdout-freeze: cannot read cases.json: ${err.message}`);
  process.exit(1);
}
for (const c of cases) {
  let text;
  try {
    text = readFileSync(join(dir, c.file), "utf8");
  } catch (err) {
    failures.push(`missing case file ${c.file}: ${err.message}`);
    continue;
  }
  for (const e of [...(c.entities ?? []), ...(c.names ?? [])]) {
    if (!text.includes(e)) failures.push(`annotation not verbatim in ${c.file}: ${JSON.stringify(e)}`);
  }
}

const annotationCount = cases.reduce(
  (n, c) => n + (c.entities ?? []).length + (c.names ?? []).length,
  0,
);
if (failures.length > 0) {
  for (const f of failures) console.error(`holdout-freeze: ${f}`);
  console.error(`holdout-freeze: FAIL (${failures.length} problem(s))`);
  process.exit(1);
}
console.log(
  `holdout-freeze: OK (${Object.keys(files).length} pinned files, ` +
    `${cases.length} cases, ${annotationCount} annotations verbatim)`,
);
