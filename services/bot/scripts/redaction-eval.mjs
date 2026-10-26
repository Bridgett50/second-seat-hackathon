// Redaction eval: measured recall over labelled PII fixtures, misses listed.
//
// Env:
//   GLIMMER_DEADLINE_MS  global budget in ms from eval start (default: none).
//   GLIMMER_RESULT_JSON   path for the JSON summary (optional).
//
// Protocol: case 1 runs first as a scored canary; if it errors, stop and
// exit 2. Remaining cases run with concurrency 2, each request timeout =
// min(90000, remaining budget). Cases not started before the deadline are
// "not_run". Recall/wilson95 cover completed ("ok") cases only.
// Exit 0 only if every case completed without execution failure, else 1
// (canary failure exits 2).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./redaction-eval-lib.mjs";

const { liveRedactor } = await import("../dist/src/private/redact.js");

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pii");
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));

const budgetRaw = process.env["GLIMMER_DEADLINE_MS"] ?? "";
const budgetMs = Number.parseInt(budgetRaw, 10);
const startedAt = Date.now();
const deadline = Number.isInteger(budgetMs) && budgetMs > 0 ? startedAt + budgetMs : Infinity;
const remainingMs = () => deadline - Date.now();

const first = liveRedactor();
console.log(`redactor: ${first.label}`);

async function runCase(c) {
  const perRequest = Math.max(1, Math.min(90_000, remainingMs() === Infinity ? 90_000 : remainingMs()));
  const redactor = liveRedactor();
  if ("timeoutMs" in redactor) redactor.timeoutMs = perRequest;
  else process.env["GLIMMER_TIMEOUT_MS"] = String(perRequest);
  const text = readFileSync(join(dir, c.file), "utf8");
  const result = await redactor.redactText(text);
  let hits = 0;
  const misses = [];
  for (const e of c.entities) {
    if (!result.maskedText.includes(e)) hits += 1;
    else misses.push(`${c.file}: ${e}`);
  }
  return { file: c.file, hits, total: c.entities.length, status: "ok", misses };
}

function toRecord(r) {
  if (r.status === "ok") return { file: r.file, hits: r.hits, total: r.total, status: "ok" };
  if (r.status === "not_run") return { file: r.file, hits: 0, total: 0, status: "not_run" };
  return { file: r.file, hits: 0, total: r.total, status: "error", error: r.error };
}

function report(records) {
  const summary = summarize(records);
  const { k, n } = summary.recall;
  const [lo, hi] = summary.wilson95;
  console.log(`recall: ${k}/${n} = ${n ? (k / n).toFixed(3) : "n/a"}`);
  console.log(`wilson95: [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  for (const r of records) {
    if (r.status === "ok") console.log(`case ${r.file}: ${r.hits}/${r.total}`);
    else if (r.status === "error") console.log(`case ${r.file}: error ${r.error}`);
    else console.log(`case ${r.file}: not_run`);
  }
  console.log(`completed: ${records.filter((r) => r.status === "ok").length}/${records.length}`);
  console.log(`execution_failures: ${summary.failures.length}`);
  for (const f of summary.failures) console.log(` - ${f}`);
  console.log(`not_run: ${summary.not_run.length}`);
  for (const f of summary.not_run) console.log(` - ${f}`);
  const misses = records.flatMap((r) => r.misses ?? []);
  if (misses.length > 0) {
    console.log("misses:");
    for (const m of misses) console.log(` - ${m}`);
  } else {
    console.log("misses: none");
  }
  const out = process.env["GLIMMER_RESULT_JSON"] ?? "";
  if (out !== "") {
    writeFileSync(
      out,
      JSON.stringify({ ...summary, misses }, null, 2),
    );
    console.log(`summary: ${out}`);
  }
  return summary;
}

// Canary: case 1 first, scored; an execution error stops the eval.
const records = [];
try {
  records.push(await runCase(cases[0]));
} catch (err) {
  records.push({
    file: cases[0].file,
    hits: 0,
    total: cases[0].entities.length,
    status: "error",
    error: err?.message ?? String(err),
  });
  report(records.map(toRecord));
  process.exit(2);
}

// Remaining cases with concurrency 2.
const rest = cases.slice(1);
const results = new Array(rest.length);
let next = 0;
async function worker() {
  for (;;) {
    const i = next;
    next += 1;
    if (i >= rest.length) return;
    const c = rest[i];
    if (Date.now() >= deadline) {
      results[i] = { file: c.file, hits: 0, total: 0, status: "not_run" };
      continue;
    }
    try {
      results[i] = await runCase(c);
    } catch (err) {
      results[i] = {
        file: c.file,
        hits: 0,
        total: c.entities.length,
        status: "error",
        error: err?.message ?? String(err),
      };
    }
  }
}
await Promise.all([worker(), worker()]);
records.push(...results);

const summary = report(records.map(toRecord));
process.exit(summary.complete ? 0 : 1);
