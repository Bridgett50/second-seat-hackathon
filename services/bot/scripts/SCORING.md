# Redaction eval scoring conventions

Applies to `scripts/redaction-eval-lib.mjs` (pure scorers) and
`scripts/redaction-eval-runner.mjs` (`runEval`, serialization, report).

## Case inputs

- `entities`: the legacy per-case PII strings. ONLY these feed the
  `legacy_entity_disappearance` metric (entity text absent from `maskedText`),
  whose historical item count (`n = 39` for `fixtures/pii`) is preserved.
- `names` (fallback: `extra_entities`): separately annotated person names and
  any other supported PII present in the transcript but not in `entities`.
- Span scoring and over-redaction use `entities + names`. The legacy metric
  keeps using ONLY `entities`.

## Offsets

- Offsets are JavaScript string indices: UTF-16 code units into the original
  transcript text, half-open `[start, end)`.
- `annotateOccurrences` finds every (possibly overlapping) occurrence of each
  entity string via `indexOf`; each occurrence is its own expected span.
- Predicted spans are also in original-text coordinates. A gold span counts as
  covered ONLY if 100% of its characters are predicted masked. Masking one
  digit of an account number therefore earns no span credit (only partial
  character coverage).
- Uncovered expected spans are reported as `span_misses` with `{ file, start,
  end, text }` in original-text coordinates.

## Whitespace

- Whitespace characters (`/\s/`) are excluded from every character metric: they
  count as neither PII chars nor non-PII chars, so masking or missing
  whitespace never moves char coverage or over-redaction.

## Zero positives

- A case (or batch) with no expected PII chars has `charCoverage` /
  `char_coverage.completed` = `null`, never 1/perfect.
- `recall_completed` / `recall_end_to_end` are `null` when their denominator
  is 0. The printed report renders nulls as `n/a (no positives)`.

## Completed vs end-to-end

- Planned expectations (text, annotated spans, expected count) are precomputed
  BEFORE any dispatch, so failed (`error`) and `not_run` cases keep their
  planned expected counts in end-to-end denominators.
- `request_completion`: `{ completed, planned }` request counts.
- `recall_completed`: span coverage over completed (`ok`) cases only.
- `recall_end_to_end`: same covered count over ALL planned cases.
- `legacy_entity_disappearance.completed` / `.end_to_end`: same split for the
  legacy entity metric.

## Serialization

- `toRecord` keeps per-case `misses` (legacy `"file: entity"` strings) and
  `span_misses` on every `ok` record. `runEval` returns records and the result
  payload after a `JSON.stringify`/`parse` round-trip identical to the
  `GLIMMER_RESULT_JSON` file payload, which carries top-level `misses` and
  `span_misses` lists alongside the summary.
