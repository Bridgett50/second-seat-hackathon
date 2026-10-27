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
//
// Thin CLI around scripts/redaction-eval-runner.mjs (offline except for the
// injected live redactor, same as before).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runEval } from "./redaction-eval-runner.mjs";

const { liveRedactor } = await import("../dist/src/private/redact.js");

const cliArgs = process.argv.slice(2);
let casesDir = "pii";
const casesDirFlag = cliArgs.indexOf("--cases-dir");
if (casesDirFlag !== -1 && cliArgs[casesDirFlag + 1] !== undefined) casesDir = cliArgs[casesDirFlag + 1];
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", casesDir);
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));

const budgetRaw = process.env["GLIMMER_DEADLINE_MS"] ?? "";
const budgetMs = Number.parseInt(budgetRaw, 10);

const first = liveRedactor();
console.log(`redactor: ${first.label}`);

const result = await runEval({
  cases,
  readText: async (c) => readFileSync(join(dir, c.file), "utf8"),
  makeRedactor: () => liveRedactor(),
  deadlineMs: Number.isInteger(budgetMs) && budgetMs > 0 ? budgetMs : undefined,
  concurrency: 2,
});

console.log(result.report);

const out = process.env["GLIMMER_RESULT_JSON"] ?? "";
if (out !== "") {
  writeFileSync(out, JSON.stringify(result.output, null, 2));
  console.log(`summary: ${out}`);
}
process.exit(result.canaryFailed ? 2 : result.complete ? 0 : 1);
