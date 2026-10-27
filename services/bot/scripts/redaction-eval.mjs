// Redaction eval: measured recall over labelled PII fixtures, misses listed.
//
// Env:
//   GLIMMER_DEADLINE_MS  global budget in ms from eval start (default: none).
//   GLIMMER_RESULT_JSON   path for the JSON summary (optional).
//   GLIMMER_OUT_DIR       parent dir for the unique run dir (default: ./eval-runs).
//   GLIMMER_RUN_ID        run id (default: timestamp + randomness).
//
// Flags:
//   --cases <name>       fixtures/<name> input set (required, no default).
//                        (--cases-dir is kept as an alias.)
//   --out-dir <dir>      parent dir for the unique run dir.
//   --run-id <id>        run id; an existing <out-dir>/<id> is refused.
//   --run-config <path>  run config JSON (services/bot/src/release/runConfig.ts
//                        shape); worker concurrency comes from its
//                        modal.concurrency instead of the default 2.
//
// Protocol: case 1 runs first as a scored canary; if it errors, stop and
// exit 2, with explicit not_run records for every remaining case. Remaining
// cases run with concurrency 2 (or modal.concurrency from --run-config when
// given), each request timeout =
// min(90000, remaining budget). Cases not started before the deadline are
// "not_run". Recall/wilson95 cover completed ("ok") cases only.
// Exit 0 only if every case completed without execution failure, else 1
// (canary failure exits 2).
//
// Every run writes <out-dir>/<run-id>/{manifest.json,records.jsonl,
// summary.json,report.txt}; the raw-response log lives under the run dir.
// Thin CLI around scripts/redaction-eval-runner.mjs (offline except for the
// injected live redactor, same as before).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliArgs = process.argv.slice(2);
function flagValue(name) {
  const i = cliArgs.indexOf(name);
  return i !== -1 && cliArgs[i + 1] !== undefined ? cliArgs[i + 1] : undefined;
}
// An explicit dataset selection is always required: never default to dev
// fixtures. Fail before importing dist or creating anything.
const __casesVal = flagValue("--cases") ?? flagValue("--cases-dir");
if (__casesVal === undefined || __casesVal === "" || __casesVal.startsWith("--")) {
  console.error("error: --cases <dataset> required");
  process.exit(2);
}

// A provided run config is loaded before any import or fixture work so a
// missing/unparseable file fails fast with a clear error.
const runConfigPath = flagValue("--run-config");
let runConfig = null;
if (runConfigPath !== undefined) {
  try {
    runConfig = JSON.parse(readFileSync(runConfigPath, "utf8"));
  } catch (err) {
    console.error(`error: cannot load --run-config ${JSON.stringify(runConfigPath)}: ${err?.message ?? err}`);
    process.exit(2);
  }
}

const { runEval, concurrencyFromRunConfig } = await import("./redaction-eval-runner.mjs");
const { liveRedactor } = await import("../dist/src/private/redact.js");
const casesDir = __casesVal;
if (casesDir.includes("/") || casesDir.includes("\\") || casesDir.includes("..")) {
  console.error(`refusing cases dir outside fixtures/: ${JSON.stringify(casesDir)}`);
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", casesDir);
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));

const budgetRaw = process.env["GLIMMER_DEADLINE_MS"] ?? "";
const budgetMs = Number.parseInt(budgetRaw, 10);

const outDir = flagValue("--out-dir") ?? process.env["GLIMMER_OUT_DIR"] ?? "eval-runs";
const runId = flagValue("--run-id") ?? process.env["GLIMMER_RUN_ID"] ?? undefined;

const first = liveRedactor();
console.log(`redactor: ${first.label}`);

const result = await runEval({
  cases,
  readText: async (c) => readFileSync(join(dir, c.file), "utf8"),
  makeRedactor: () => liveRedactor(),
  deadlineMs: Number.isInteger(budgetMs) && budgetMs > 0 ? budgetMs : undefined,
  concurrency: runConfig === null ? 2 : concurrencyFromRunConfig(runConfig),
  ...(runId !== undefined ? { runId } : {}),
  outDir,
});

console.log(result.report);
console.log(`run: ${result.runDir}`);

const out = process.env["GLIMMER_RESULT_JSON"] ?? "";
if (out !== "") {
  writeFileSync(out, JSON.stringify(result.output, null, 2));
  console.log(`summary: ${out}`);
}
process.exit(result.canaryFailed ? 2 : result.complete ? 0 : 1);
