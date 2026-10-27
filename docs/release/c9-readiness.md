# C9 evidence run and release — preparation only

> **Preparation only. No sealed-data access, model execution, Modal activity, or spending is authorized by this document. Every box below is unchecked.**

This checklist prepares — but does not launch — the C9 evidence run and release.
Identities below are roles and field names only; no sealed values are recorded here.

## 1) Readiness checklist (C1–C7 acceptance by criterion id)

- [ ] Readiness requires C1–C7 acceptance by criterion id, not just green CI. Green CI alone is not sufficient.
- [ ] C1 acceptance (draft PR #54): C1-1, C1-2, C1-3, C1-4, C1-5, C1-6, C1-7, C1-8.
- [ ] C2 acceptance (draft PR #55): C2-1, C2-2, C2-3, C2-4, C2-5, C2-6.
- [ ] C3 acceptance (draft PR #56): C3-1, C3-2, C3-3, C3-4, C3-5, C3-6.
- [ ] C4 acceptance (draft PR #57): C4-1, C4-2, C4-3, C4-4, C4-5, C4-6.
- [ ] C5 acceptance (draft PR #58): C5-1, C5-2, C5-3, C5-4, C5-5, C5-6, C5-7, C5-8, C5-9, C5-10, C5-11, C5-12.
- [ ] C6 acceptance (draft PR #53): C6-1, C6-2, C6-3, C6-4, C6-5, C6-6.
- [ ] C7 acceptance (draft PR #59): C7-1, C7-2, C7-3, C7-4, C7-5, C7-6, C7-7, C7-8.

## 2) Sealed holdout review

- [ ] Sealed holdout review: BLOCKED pending separate authorization and independent human review.

## 3) Run configuration binding

- [ ] The eventual run configuration binds actual source, dataset identity, model revision, image digest, prompt hash, schema hash, scorer hash, decoding settings, token limits, timeouts and retry policy via services/bot/src/release/runConfig.ts (validateRunConfig and sparkProofClientOptions).
- [ ] The Spark proof configuration makes at most one actual HTTP attempt (retry maxAttempts equals 1).

## 4) Modal and Glimmer bounds

- [ ] Plan allows one Modal allocation, scored canary, bounded concurrency, declared limits, teardown and complete evidence download.
- [ ] Any extra Glimmer demonstration request must be declared (glimmerDemoRequests field); no hidden second allocation.

## 5) Publication policy

- [ ] Publication policy preserves failures, incomplete runs and full planned denominators. No undisclosed reruns or cherry-picking.

## 6) Budget

- [ ] Budget: PROPOSED — $2 Modal + $0.10 Spark = $2.10. Prices, resource assumptions and enforcement must be checked before separate authorization. A timeout is not a hard billing guarantee.

## 7) Partner verification

- [ ] Partner verification: PENDING.

## 8) Release checklist

- [ ] One release identity across README, CI, results, screenshots and video.
- [ ] Video is short: 3-minute limit (3:00).
- [ ] Accessible submission links checked before November 4, 3 PM CT.

## 9) Blocked human/authorized tasks

- [ ] Authorize and complete independent sealed-holdout review.
- [ ] Authorize the exact frozen live configuration and spending.
- [ ] Approve the exact redacted payload for the Spark request.
- [ ] Execute and inspect the one bounded live run.
- [ ] Confirm actual costs, teardown and partner verification.
- [ ] Conduct recording, publish links and submit.
- [ ] Do not mark these complete because this checklist exists.

## Plan section

C9 — PREPARE EVIDENCE RUN AND RELEASE; EXECUTION BLOCKED

Muse Code may prepare checklists/configuration schemas and test them with
dummy values. Do not fill real sealed identities by accessing sealed data.

C9-P1
Readiness checklist requires C1–C7 acceptance, not just green CI.

C9-P2
Actual holdout review remains explicitly blocked pending separate
authorization and independent human review.

C9-P3
Eventual run configuration must bind actual source, dataset identity,
model revision, image digest, prompt/schema, scorer, decoding settings,
token limits, timeouts and retry policy.

C9-P4
Fake retryable failures prove the proposed Spark proof configuration
makes at most one actual HTTP attempt.

C9-P5
Plan allows one Modal allocation, scored canary, bounded concurrency,
declared limits, teardown and complete evidence download.

C9-P6
Any extra Glimmer demonstration request must be declared.
No hidden second allocation.

C9-P7
Publication policy preserves failures, incomplete runs and full planned
denominators. No undisclosed reruns or cherry-picking.

C9-P8
Budget remains PROPOSED:
$2 Modal + $0.10 Spark = $2.10.
Prices, resource assumptions and enforcement must be checked before
separate authorization. A timeout is not a hard billing guarantee.

C9-P9
Partner verification remains pending until actual confirmation exists.

C9-P10
Release checklist requires one release identity across README, CI,
results, screenshots and video; ≤3-minute video; accessible submission
links checked before November 4, 3 PM CT.

Blocked human/authorized execution tasks:
- Authorize and complete independent sealed-holdout review.
- Authorize the exact frozen live configuration and spending.
- Approve the exact redacted payload for the Spark request.
- Execute and inspect the one bounded live run.
- Confirm actual costs, teardown and partner verification.
- Conduct recording, publish links and submit.

Do not mark these tasks complete because their checklists exist.
