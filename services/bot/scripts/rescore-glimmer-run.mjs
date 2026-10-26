// Re-score the recorded glimmer-run predictions against fixtures/pii inputs.
// Offline only: never contacts a model, never reads held-out data.
//
// Rescore rule: legacy per-case hits/totals/status come from
// glimmer-run/eval-summary.json. glimmer-raw.jsonl lines carry NO case id and
// are not in case order, so predictions are NEVER paired to cases by best
// score/coverage (that would be circular). Span coverage / over-redaction are
// re-scored ONLY for a prediction record carrying a `file` field that matches
// a planned input file; otherwise they are reported as null with a reason.
// Writes fixtures/glimmer-run/rescore.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { annotateOccurrences, scoreSpans, summarize } from "./redaction-eval-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const piiDir = join(here, "..", "fixtures", "pii");
const runDir = join(here, "..", "fixtures", "glimmer-run");

const cases = JSON.parse(readFileSync(join(piiDir, "cases.json"), "utf8"));
// Planned batch = the 8 basic cases.
const plannedInputs = cases.filter((c) => /^basic-\d+\.txt$/.test(c.file));
if (plannedInputs.length !== 8) {
  console.error(`expected 8 basic cases, found ${plannedInputs.length}`);
  process.exit(2);
}
const planned = plannedInputs.map((c) => {
  const text = readFileSync(join(piiDir, c.file), "utf8");
  return { file: c.file, total: c.entities.length, expected: annotateOccurrences(text, c.entities).length };
});

const recorded = JSON.parse(readFileSync(join(runDir, "eval-summary.json"), "utf8"));
const recordedByFile = new Map((recorded.cases ?? []).map((c) => [c.file, c]));
const records = planned.map((p) => {
  const r = recordedByFile.get(p.file);
  if (r === undefined) return { file: p.file, hits: 0, total: p.total, status: "not_run" };
  if (r.status === "ok") return { file: p.file, hits: r.hits, total: r.total, status: "ok" };
  if (r.status === "not_run") return { file: p.file, hits: 0, total: p.total, status: "not_run" };
  return { file: p.file, hits: 0, total: p.total, status: "error", error: r.error ?? "unknown error" };
});

// Span re-score: only predictions keyed to a case file via a `file` field.
let keyedPredictions = 0;
try {
  const raw = readFileSync(join(runDir, "glimmer-raw.jsonl"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const file = obj?.file;
    if (typeof file !== "string" || !recordedByFile.has(file)) continue;
    const target = records.find((r) => r.file === file);
    if (target === undefined || target.status !== "ok") continue;
    let spans = obj.spans;
    if (!Array.isArray(spans) && typeof obj.content === "string") {
      try {
        const inner = JSON.parse(obj.content);
        if (Array.isArray(inner.spans)) spans = inner.spans;
      } catch {
        /* no keyed spans on this line */
      }
    }
    if (!Array.isArray(spans)) continue;
    const input = plannedInputs.find((c) => c.file === file);
    const text = readFileSync(join(piiDir, file), "utf8");
    const scored = scoreSpans(text, annotateOccurrences(text, input.entities), spans);
    target.span = {
      covered: scored.covered,
      expected: scored.expected,
      piiChars: scored.piiChars,
      piiCharsMasked: scored.piiCharsMasked,
      nonPii: scored.nonPii,
      nonPiiMasked: scored.nonPiiMasked,
    };
    keyedPredictions += 1;
  }
} catch (err) {
  console.error(`cannot read glimmer-raw.jsonl: ${err?.message ?? err}`);
}

const summary = summarize(records, planned);
const legacy = summary.legacy_entity_disappearance;
const payload = {
  planned: planned.map((p) => p.file),
  request_completion: summary.request_completion,
  legacy_entity_disappearance: legacy,
  // Deprecated alias of legacy completed recall.
  recall: summary.recall,
  span_coverage: null,
  span_coverage_reason: "predictions not keyed to case files; not re-scorable",
  char_coverage: null,
  over_redaction_rate: null,
  keyed_predictions: keyedPredictions,
  cases: summary.cases.map((c) => ({
    file: c.file,
    hits: c.hits,
    total: c.total,
    status: c.status,
    ...(c.error !== undefined ? { error: c.error } : {}),
  })),
  failures: summary.failures,
  not_run: summary.not_run,
  generatedAt: new Date().toISOString(),
};

const out = join(runDir, "rescore.json");
writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
const rc = summary.request_completion;
console.log(`requests: ${rc.completed}/${rc.planned}`);
console.log(`legacy completed: ${legacy.completed.k}/${legacy.completed.n}`);
console.log(`legacy end-to-end: ${legacy.end_to_end.k}/${legacy.end_to_end.n}`);
console.log(`span_coverage: null (${payload.span_coverage_reason})`);
console.log(`rescore: ${out}`);
