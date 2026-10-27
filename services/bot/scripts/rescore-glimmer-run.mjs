// Re-score the recorded glimmer-run predictions against fixtures/pii inputs.
// Offline only: never contacts a model, never reads held-out data.
//
// Two entry points:
//
// 1. Legacy CLI (run as a script): rescores fixtures/glimmer-run
//    (eval-summary.json + glimmer-raw.jsonl, which carry NO case ids and are
//    not in case order, so predictions are NEVER paired to cases by best
//    score/coverage — that would be circular). Span coverage / over-redaction
//    are re-scored ONLY for a prediction record carrying a `file` field that
//    matches a planned input file; otherwise they are reported as null with a
//    reason. Writes fixtures/glimmer-run/rescore.json.
// 2. rescoreRun(runDir): offline rescoring for new run dirs written by
//    runEval (<outDir>/<runId>/{manifest.json,records.jsonl}). Recomputes the
//    summary + report from saved records + case files with no redactor and no
//    network. Tolerates interrupted runs (truncated trailing partial line,
//    missing summary.json): missing cases become explicit not_run records and
//    the result reports complete:false with a reason.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  annotateOccurrences,
  checkRecordIntegrity,
  scoreSpans,
  summarize,
  summarizeWithIntegrity,
} from "./redaction-eval-lib.mjs";
import { caseEntities, formatReport } from "./redaction-eval-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const piiDir = join(here, "..", "fixtures", "pii");
const legacyRunDir = join(here, "..", "fixtures", "glimmer-run");

function rescoreLegacyGlimmerRun() {
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

  const recorded = JSON.parse(readFileSync(join(legacyRunDir, "eval-summary.json"), "utf8"));
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
    const raw = readFileSync(join(legacyRunDir, "glimmer-raw.jsonl"), "utf8");
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

  const out = join(legacyRunDir, "rescore.json");
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
  const rc = summary.request_completion;
  console.log(`requests: ${rc.completed}/${rc.planned}`);
  console.log(`legacy completed: ${legacy.completed.k}/${legacy.completed.n}`);
  console.log(`legacy end-to-end: ${legacy.end_to_end.k}/${legacy.end_to_end.n}`);
  console.log(`span_coverage: null (${payload.span_coverage_reason})`);
  console.log(`rescore: ${out}`);
}

// Offline rescoring for a runEval run dir. No redactor, no network: planned
// expectations are recomputed from the case files, and per-case results come
// from the saved records.jsonl lines.
//
// Tolerates interrupted runs: a truncated trailing partial line is ignored
// (truncated:true), missing cases become explicit not_run records, and any
// missing/duplicate/unexpected case id forces complete:false with a reason.
//
// readText defaults to fixtures/pii/<file>; tests inject a fake.
//
// Returns { run_id, records, summary, misses, span_misses, output, report,
// complete, truncated, integrity }. output matches the run's saved
// summary.json exactly (same construction as runEval).
export async function rescoreRun(runDir, { readText } = {}) {
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const plannedCases = manifest.planned ?? [];
  const read = readText ?? (async (c) => readFileSync(join(piiDir, c.file), "utf8"));

  const planned = [];
  for (const c of plannedCases) {
    const text = await read(c);
    planned.push({
      file: c.file,
      total: (c.entities ?? []).length,
      expected: annotateOccurrences(text, caseEntities(c)).length,
    });
  }

  const raw = readFileSync(join(runDir, "records.jsonl"), "utf8");
  const contentLines = raw.split("\n").filter((l) => l.trim() !== "");
  const parsed = [];
  let truncated = false;
  let malformed = null;
  contentLines.forEach((line, idx) => {
    const last = idx === contentLines.length - 1;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      if (last) truncated = true;
      else if (malformed === null) malformed = `unparseable records.jsonl line ${idx + 1}`;
    }
  });

  const integrity = checkRecordIntegrity(parsed, plannedCases);
  const reasons = [];
  if (!integrity.ok) reasons.push(integrity.reason);
  if (malformed !== null) reasons.push(malformed);
  if (truncated) reasons.push("truncated partial last line ignored");
  const combined = reasons.length > 0
    ? { ok: false, reason: reasons.join("; ") }
    : { ok: true, reason: null };

  // Exactly one terminal record per planned case, in planned order. Missing
  // cases (including the interrupted tail) become explicit not_run records.
  const firstByFile = new Map();
  for (const r of parsed) {
    if (typeof r?.file === "string" && !firstByFile.has(r.file)) firstByFile.set(r.file, r);
  }
  const ordered = plannedCases.map((c) => {
    const r = firstByFile.get(c.file);
    if (r !== undefined) return r;
    return { file: c.file, hits: 0, total: (c.entities ?? []).length, status: "not_run" };
  });

  const summary = summarizeWithIntegrity(ordered, planned);
  if (!combined.ok) {
    summary.complete = false;
    summary.all_valid = false;
    summary.integrity = combined;
  }
  const misses = ordered.flatMap((r) => r.misses ?? []);
  const spanMisses = ordered.flatMap((r) => r.span_misses ?? []);
  const output = JSON.parse(JSON.stringify({ run_id: manifest.run_id, ...summary, misses, span_misses: spanMisses }));
  const report = formatReport(ordered, summary, misses, spanMisses);
  return {
    run_id: manifest.run_id,
    records: ordered,
    summary,
    misses,
    span_misses: spanMisses,
    output,
    report,
    complete: summary.complete,
    truncated,
    integrity: summary.integrity,
  };
}

const isMainEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainEntry) {
  rescoreLegacyGlimmerRun();
}
