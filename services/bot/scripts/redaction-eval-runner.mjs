// Testable evaluation runner for scripts/redaction-eval.mjs (offline only).
//
// runEval() owns the whole eval flow: precompute planned expectations BEFORE
// any dispatch, run the canary + the concurrent remainder, serialize records
// through the same JSON round-trip used for GLIMMER_RESULT_JSON, and build the
// summary + printable report. The CLI in redaction-eval.mjs is a thin wrapper
// that supplies live file/redactor factories.
//
// Span scoring and over-redaction use entities + names (c.names, falling back
// to c.extra_entities). The legacy entity-disappearance metric uses ONLY
// c.entities so the historical item count is preserved.
import { annotateOccurrences, scoreSpans, summarize } from "./redaction-eval-lib.mjs";

// Every supported PII string for span purposes: legacy entities plus the
// separately annotated names/extra entities.
export function caseEntities(c) {
  return [...(c.entities ?? []), ...(c.names ?? c.extra_entities ?? [])];
}

// Serialized per-case record. ok records always carry misses (legacy entity
// misses as "file: entity" strings) and span_misses (uncovered expected spans
// with original-text offsets), even when both are empty.
export function toRecord(r) {
  if (r.status === "ok") {
    return {
      file: r.file,
      hits: r.hits,
      total: r.total,
      status: "ok",
      misses: r.misses ?? [],
      span_misses: r.span_misses ?? [],
      span: r.span,
    };
  }
  if (r.status === "not_run") return { file: r.file, hits: 0, total: r.total, status: "not_run" };
  return { file: r.file, hits: 0, total: r.total, status: "error", error: r.error };
}

function errorRecord(c, err) {
  return {
    file: c.file,
    hits: 0,
    total: (c.entities ?? []).length,
    status: "error",
    error: err?.message ?? String(err),
  };
}

async function runCase(c, text, redactor) {
  const result = await redactor.redactText(text);
  let hits = 0;
  const misses = [];
  for (const e of c.entities ?? []) {
    if (!result.maskedText.includes(e)) hits += 1;
    else misses.push(`${c.file}: ${e}`);
  }
  const expected = annotateOccurrences(text, caseEntities(c));
  const scored = scoreSpans(text, expected, result.spans ?? []);
  const span = {
    covered: scored.covered,
    expected: scored.expected,
    piiChars: scored.piiChars,
    piiCharsMasked: scored.piiCharsMasked,
    nonPii: scored.nonPii,
    nonPiiMasked: scored.nonPiiMasked,
  };
  const span_misses = scored.missed.map((m) => ({
    file: c.file,
    start: m.start,
    end: m.end,
    text: text.slice(m.start, m.end),
  }));
  return { file: c.file, hits, total: (c.entities ?? []).length, status: "ok", misses, span_misses, span };
}

function ratio(k, n) {
  return n ? (k / n).toFixed(3) : "n/a (no positives)";
}

// Printable report lines. Completed-case metrics and full-batch (end-to-end)
// metrics are labelled separately; null recalls print as "n/a (no positives)".
export function formatReport(records, summary, misses, spanMisses) {
  const lines = [];
  const { k, n } = summary.recall;
  const [lo, hi] = summary.wilson95;
  lines.push(`recall: ${k}/${n} = ${ratio(k, n)}`);
  lines.push(`wilson95: [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  const rc = summary.recall_completed;
  const re = summary.recall_end_to_end;
  lines.push(`span_coverage_completed: ${rc ? `${rc.k}/${rc.n} = ${ratio(rc.k, rc.n)}` : "n/a (no positives)"}`);
  lines.push(`span_coverage_end_to_end: ${re ? `${re.k}/${re.n} = ${ratio(re.k, re.n)}` : "n/a (no positives)"}`);
  const cc = summary.char_coverage;
  lines.push(`char_coverage: ${cc.masked}/${cc.total} = ${cc.completed === null ? "n/a (no positives)" : cc.completed.toFixed(3)}`);
  lines.push(`over_redaction_rate: ${summary.over_redaction_rate.toFixed(3)}`);
  for (const r of records) {
    if (r.status === "ok") lines.push(`case ${r.file}: ${r.hits}/${r.total}`);
    else if (r.status === "error") lines.push(`case ${r.file}: error ${r.error}`);
    else lines.push(`case ${r.file}: not_run`);
  }
  const completed = records.filter((r) => r.status === "ok").length;
  lines.push(`completion: ${completed}/${records.length}`);
  lines.push(`execution_failures: ${summary.failures.length}`);
  for (const f of summary.failures) lines.push(` - ${f}`);
  lines.push(`not_run: ${summary.not_run.length}`);
  for (const f of summary.not_run) lines.push(` - ${f}`);
  if (misses.length === 0 && spanMisses.length === 0) {
    lines.push("misses: none");
  } else {
    lines.push("misses:");
    for (const m of misses) lines.push(` - ${m}`);
    lines.push("span_misses:");
    for (const m of spanMisses) lines.push(` - ${m.file} [${m.start},${m.end}): ${JSON.stringify(m.text)}`);
  }
  return lines.join("\n");
}

// Run the eval over planned cases with an injected redactor factory.
//
//   cases:        parsed cases.json entries ({ file, entities, names? })
//   readText:     async (case) => transcript text
//   makeRedactor: () => redactor with redactText(text) and optional timeoutMs
//   deadlineMs:   global budget in ms from eval start (optional)
//   concurrency:  worker count for the non-canary remainder (default 2)
//
// Returns { records, summary, misses, span_misses, output, report, complete,
// canaryFailed }. records and output have been through the same
// JSON.stringify/parse round-trip as the GLIMMER_RESULT_JSON file payload.
export async function runEval({ cases, readText, makeRedactor, deadlineMs, concurrency = 2 }) {
  const startedAt = Date.now();
  const deadline =
    Number.isInteger(deadlineMs) && deadlineMs > 0 ? startedAt + deadlineMs : Infinity;
  const remainingMs = () => deadline - Date.now();
  const applyTimeout = (redactor) => {
    const perRequest = Math.max(1, Math.min(90_000, remainingMs() === Infinity ? 90_000 : remainingMs()));
    if (redactor !== null && typeof redactor === "object" && "timeoutMs" in redactor) {
      redactor.timeoutMs = perRequest;
    } else {
      process.env["GLIMMER_TIMEOUT_MS"] = String(perRequest);
    }
  };

  // Precompute every planned case's text, annotated spans and expected count
  // BEFORE any dispatch, so failed/not_run cases keep planned denominators.
  const texts = new Map();
  const planned = [];
  for (const c of cases) {
    const text = await readText(c);
    texts.set(c.file, text);
    planned.push({
      file: c.file,
      total: (c.entities ?? []).length,
      expected: annotateOccurrences(text, caseEntities(c)).length,
    });
  }

  const finish = (allRecords, canaryFailed) => {
    const records = JSON.parse(JSON.stringify(allRecords.map(toRecord)));
    const summary = summarize(records, planned);
    const misses = records.flatMap((r) => r.misses ?? []);
    const spanMisses = records.flatMap((r) => r.span_misses ?? []);
    const output = JSON.parse(JSON.stringify({ ...summary, misses, span_misses: spanMisses }));
    return {
      records,
      summary,
      misses,
      span_misses: spanMisses,
      output,
      report: formatReport(records, summary, misses, spanMisses),
      complete: summary.complete,
      canaryFailed,
    };
  };

  // Canary: case 1 runs first; an execution error stops the eval.
  const records = [];
  try {
    const redactor = makeRedactor();
    applyTimeout(redactor);
    records.push(await runCase(cases[0], texts.get(cases[0].file), redactor));
  } catch (err) {
    records.push(errorRecord(cases[0], err));
    return finish(records, true);
  }

  // Remaining cases run concurrently.
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
        results[i] = { file: c.file, hits: 0, total: (c.entities ?? []).length, status: "not_run" };
        continue;
      }
      try {
        const redactor = makeRedactor();
        applyTimeout(redactor);
        results[i] = await runCase(c, texts.get(c.file), redactor);
      } catch (err) {
        results[i] = errorRecord(c, err);
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, concurrency); w++) workers.push(worker());
  await Promise.all(workers);
  records.push(...results);
  return finish(records, false);
}
