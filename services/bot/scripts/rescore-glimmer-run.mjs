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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  annotateOccurrences,
  checkRecordIntegrity,
  scoreSpans,
  summarize,
  summarizeWithIntegrity,
} from "./redaction-eval-lib.mjs";
import { annotationSha256, buildOkRecord, caseEntities, formatReport, sha256Hex } from "./redaction-eval-runner.mjs";

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

function readSavedSummary(runDir) {
  try {
    return JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
  } catch {
    return null;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Offline replay from immutable evidence. Read-only: never writes.
// Recomputes ONLY from manifest.json, inputs/, glimmer-raw.jsonl and
// records.jsonl (record keys/status only; never trust saved hits/spans).
//
// Returns { ok, complete, errors, mismatches, truncated, records, output,
// report, run_id, summary, misses, span_misses, integrity }.
async function rescoreStrict(runDir, { parseAnswer }) {
  const errors = [];
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const runId = manifest.run_id;
  const plannedCases = manifest.planned ?? [];
  const plannedByFile = new Map(plannedCases.map((c) => [c.file, c]));

  // Immutable inputs + annotation hashes.
  const texts = new Map();
  for (const c of plannedCases) {
    let text = null;
    try {
      text = readFileSync(join(runDir, "inputs", c.file), "utf8");
    } catch (err) {
      errors.push(`missing input file ${c.file}: ${err?.message ?? err}`);
      texts.set(c.file, "");
      continue;
    }
    texts.set(c.file, text);
    if (sha256Hex(text) !== c.input_sha256) {
      errors.push(`input hash mismatch for ${c.file}: inputs/${c.file} does not match manifest input_sha256`);
    }
    const expectedAnnot = annotationSha256({ entities: c.entities, names: c.names, extra_entities: c.extra_entities });
    if (typeof c.annotation_sha256 !== "string" || c.annotation_sha256 !== expectedAnnot) {
      errors.push(`annotation hash mismatch for ${c.file}: manifest annotation_sha256 does not match entities/names/extra_entities`);
    }
  }

  // Records: truncated/unparseable last line is ignored with truncated=true.
  let truncated = false;
  let parsed = [];
  try {
    const raw = readFileSync(join(runDir, "records.jsonl"), "utf8");
    const segments = raw.split("\n");
    // Drop the single trailing empty segment from a file ending in newline.
    if (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();
    const lines = segments.filter((l) => l.trim() !== "");
    lines.forEach((line, idx) => {
      const last = idx === lines.length - 1;
      try {
        parsed.push(JSON.parse(line));
      } catch {
        if (last) truncated = true;
        else errors.push(`unparseable records.jsonl line ${idx + 1}`);
      }
    });
  } catch (err) {
    errors.push(`missing records.jsonl: ${err?.message ?? err}`);
  }

  // Record key verification.
  const seen = new Set();
  const firstByFile = new Map();
  for (const r of parsed) {
    const file = r?.file;
    if (typeof file !== "string") {
      errors.push(`record missing case id: ${JSON.stringify(r)?.slice(0, 80)}`);
      continue;
    }
    if (seen.has(file)) {
      errors.push(`duplicate record for ${file}`);
      continue;
    }
    seen.add(file);
    if (!firstByFile.has(file)) firstByFile.set(file, r);
    if (!plannedByFile.has(file)) {
      errors.push(`unexpected record case ${file}: not in planned manifest`);
      continue;
    }
    const plannedEntry = plannedByFile.get(file);
    if (r?.run_id !== runId) {
      errors.push(`run_id mismatch for ${file}: record run_id does not match manifest run_id`);
    }
    if (r?.case_id !== file) {
      errors.push(`case mismatch for ${file}: record case_id does not match file`);
    }
    if (typeof r?.input_sha256 !== "string" || r.input_sha256 !== plannedEntry.input_sha256) {
      errors.push(`input hash mismatch for ${file}: record input_sha256 does not match manifest`);
    }
    const status = r?.status;
    if (status !== "ok" && status !== "error" && status !== "not_run") {
      errors.push(`invalid status for ${file}: ${JSON.stringify(status)}`);
    }
  }
  for (const c of plannedCases) {
    if (!seen.has(c.file)) errors.push(`missing record for ${c.file}`);
  }

  // Raw receipts keyed by run_id + case_id + input_sha256.
  const receiptsByKey = new Map();
  try {
    const raw = readFileSync(join(runDir, "glimmer-raw.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      let obj = null;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj !== null && typeof obj === "object") {
        receiptsByKey.set(`${obj.run_id}\n${obj.case_id}\n${obj.input_sha256}`, obj);
      }
    }
  } catch {
    /* no raw file: records carrying raw_sha256 will error below */
  }
  const receiptFor = (run_id, case_id, input_sha256) =>
    receiptsByKey.get(`${run_id}\n${case_id}\n${input_sha256}`) ?? null;

  for (const r of parsed) {
    if (typeof r?.file !== "string" || !plannedByFile.has(r.file)) continue;
    if (r.status !== "ok" && r.status !== "error") continue;
    if (typeof r.raw_sha256 !== "string") {
      errors.push(`missing raw_sha256 for ${r.file}: record carries no raw hash`);
      continue;
    }
    const receipt = receiptFor(r.run_id, r.case_id, r.input_sha256);
    if (receipt === null) {
      errors.push(`missing raw receipt for ${r.file}: no glimmer-raw.jsonl entry for run_id+case_id+input_sha256`);
      continue;
    }
    if (typeof receipt.content !== "string" || sha256Hex(receipt.content) !== r.raw_sha256) {
      errors.push(`raw hash mismatch for ${r.file}: receipt content does not match record raw_sha256`);
    }
  }

  // Per-case recompute from raw evidence only. Missing planned cases get no
  // synthesized record (the missing error forces incomplete); truncated tails
  // are already dropped above.
  const recomputed = [];
  for (const c of plannedCases) {
    const text = texts.get(c.file) ?? "";
    const saved = firstByFile.get(c.file);
    const total = (c.entities ?? []).length;
    if (saved === undefined) continue;
    if (saved.status === "not_run") {
      recomputed.push({ file: c.file, hits: 0, total, status: "not_run" });
      continue;
    }
    if (saved.status !== "ok" && saved.status !== "error") {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: `invalid status ${JSON.stringify(saved.status)}` });
      continue;
    }
    const receipt = receiptFor(saved.run_id, saved.case_id, saved.input_sha256);
    if (receipt === null) {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: `missing raw receipt for ${c.file}` });
      continue;
    }
    if (typeof receipt.error === "string" && receipt.error !== "") {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: receipt.error });
      continue;
    }
    let spans;
    try {
      const out = parseAnswer(text, receipt.content, receipt.finish_reason ?? "stop");
      spans = out?.spans ?? out;
      if (!Array.isArray(spans)) throw new Error("glimmer: no JSON in reply");
    } catch (err) {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: err?.message ?? String(err) });
      continue;
    }
    recomputed.push(buildOkRecord({ file: c.file, entities: c.entities, names: c.names, extra_entities: c.extra_entities }, text, spans));
  }

  const planned = plannedCases.map((c) => {
    const text = texts.get(c.file) ?? "";
    return {
      file: c.file,
      total: (c.entities ?? []).length,
      expected: annotateOccurrences(text, caseEntities(c)).length,
    };
  });

  const summary = summarizeWithIntegrity(recomputed, planned);
  if (errors.length > 0) {
    summary.complete = false;
    summary.all_valid = false;
  }
  const misses = recomputed.flatMap((r) => r.misses ?? []);
  const spanMisses = recomputed.flatMap((r) => r.span_misses ?? []);
  const output = JSON.parse(JSON.stringify({ run_id: runId, ...summary, misses, span_misses: spanMisses }));
  if (errors.length > 0) output.complete = false;
  const report = formatReport(recomputed, summary, misses, spanMisses);

  const savedSummary = readSavedSummary(runDir);
  const mismatches = [];
  if (savedSummary !== null && typeof savedSummary === "object") {
    for (const key of Object.keys(savedSummary)) {
      if (!deepEqual(savedSummary[key], output[key])) mismatches.push(key);
    }
  }

  const ok = errors.length === 0;
  const complete = ok && !truncated && output.complete === true;
  return {
    ok,
    complete,
    errors,
    mismatches,
    truncated,
    records: recomputed,
    output,
    report,
    run_id: runId,
    summary,
    misses,
    span_misses: spanMisses,
    integrity: summary.integrity,
  };
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
export async function rescoreRun(runDir, { parseAnswer, readText } = {}) {
  if (typeof parseAnswer === "function") return rescoreStrict(runDir, { parseAnswer });
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
  const savedSummary = readSavedSummary(runDir);
  const mismatches = [];
  if (savedSummary !== null && typeof savedSummary === "object") {
    for (const key of Object.keys(savedSummary)) {
      if (!deepEqual(savedSummary[key], output[key])) mismatches.push(key);
    }
  }
  const errors = combined.ok ? [] : [combined.reason];
  return {
    ok: combined.ok,
    errors,
    mismatches,
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
  const argv = process.argv.slice(2);
  const runDirFlag = argv.indexOf("--run-dir");
  if (runDirFlag !== -1) {
    const runDir = argv[runDirFlag + 1];
    if (runDir === undefined) {
      console.error("error: --run-dir <dir> required");
      process.exit(2);
    }
    const { parseGlimmerAnswer } = await import("../dist/src/private/redact.js");
    const re = await rescoreRun(runDir, { parseAnswer: parseGlimmerAnswer });
    console.log(JSON.stringify({ ok: re.ok, complete: re.complete, truncated: re.truncated, errors: re.errors, mismatches: re.mismatches }));
    process.exit(re.ok ? 0 : 1);
  }
  const { parseGlimmerAnswer } = await import("../dist/src/private/redact.js");
  void parseGlimmerAnswer;
  rescoreLegacyGlimmerRun();
}
