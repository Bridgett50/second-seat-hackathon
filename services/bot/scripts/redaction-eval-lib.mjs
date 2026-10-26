// Pure helpers for scripts/redaction-eval.mjs (unit-tested, no I/O).
export function wilson(k, n, z = 1.96) {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

// cases: [{ file, hits, total, status: "ok" | "error" | "not_run", error? }]
// Recall is computed ONLY over completed ("ok") cases.
export function summarize(cases) {
  const completed = cases.filter((c) => c.status === "ok");
  const failures = cases
    .filter((c) => c.status === "error")
    .map((c) => `${c.file}: ${c.error ?? "unknown error"}`);
  const notRun = cases.filter((c) => c.status === "not_run").map((c) => c.file);
  const k = completed.reduce((s, c) => s + c.hits, 0);
  const n = completed.reduce((s, c) => s + c.total, 0);
  const [lo, hi] = wilson(k, n);
  return {
    complete: cases.length > 0 && failures.length === 0 && notRun.length === 0,
    recall: { k, n },
    wilson95: [lo, hi],
    cases,
    failures,
    not_run: notRun,
  };
}
