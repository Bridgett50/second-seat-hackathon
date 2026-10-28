# C9 evidence run and release — preparation only

> **Preparation only. No sealed-data access, model execution, Modal activity, or spending is authorized by this document. Every box below is unchecked.**

This checklist prepares — but does not launch — the C9 evidence run and release.
Identities below are roles and field names only; no sealed values are recorded here.

## 1) Readiness checklist (C1–C7 acceptance by criterion id)

- [ ] Readiness requires C1–C7 acceptance by criterion id, not just green CI. Green CI alone is not sufficient. The canonical ID set lives in [acceptance-registry.md](acceptance-registry.md) (113 IDs); this section must contain exactly that set.
- [ ] C1 acceptance (draft PR #54, tested head `8d1ca970b1993b34112f1276b9915eb2219b0b7a`, probes `apps/web/e2e/c1-races.spec.ts` + `apps/web/test/c1-revisions.test.ts`): C1-1, C1-2, C1-3, C1-4, C1-5, C1-6, C1-7, C1-8, C1-9. Outcome: C1-1..C1-8 pass at store/browser boundary; C1-9 pending (D2-6). Limitation: HTTP regressions inspected not run; repo clock not explicitly paused; A→B→A open (F4).
- [ ] C2 acceptance (draft PR #55, tested head `2617b7978363963e5126d8e4ca643f176cecfd5f`, probe `apps/web/test/c2-receipts.test.ts`): C2-1, C2-2, C2-3, C2-4, C2-5, C2-6, C2-7. Outcome: C2-1..C2-6 pass at snapshot level (C2-2 partial, F3); C2-7 pending. Limitation: active pending page still stale (F3); refusal matrix not executed at this head.
- [ ] C3 acceptance (draft PR #56, tested head `fb4c216d60b08aef4308a05f25250b5f8adfa925`, probe `apps/web/test/c3-contract.test.ts`): C3-1, C3-2, C3-3, C3-4, C3-5, C3-6, C3-7, C3-8. Outcome: C3-1..C3-6 pass; C3-7/C3-8 pending. Limitation: head fails clean build from empty dist (F6).
- [ ] C4 acceptance (draft PR #57, tested head `b383e12615b5df48866c7f276d1095d7f116850c`, probe `services/bot/test/c4-replay.test.ts`, dummy bundles): C4-1, C4-2, C4-3, C4-4, C4-5, C4-6, C4-7, C4-8, C4-9, C4-10, C4-11. Outcome: C4-1..C4-6 + C4-10 pass; C4-7/C4-8/C4-9/C4-11 pending (D5). Limitation: manifest-plan duplicates and comparison states open (F8).
- [ ] C5 acceptance (draft PR #58, tested head `789ab3c3475145404484f39c428883dcc78557b7`, probe `services/bot/test/c5-wiring.test.ts`, inert stub): C5-1, C5-2, C5-3, C5-4, C5-5, C5-6, C5-7, C5-8, C5-9, C5-10, C5-11, C5-12. Outcome: pass except C5-3/C5-6 partial. Limitation: same-path drift (F2); all-zero identities on new TS path (F7); stub only.
- [ ] C6 acceptance (draft PR #53, tested head `7efcae01fa594a564165a69a2d065f86d9c15d03`, probe `services/bot/test/c6-hermetic.test.ts`): C6-1, C6-2, C6-3, C6-4, C6-5, C6-6, C6-7. Outcome: C6-1 pass; C6-2/C6-3/C6-5/C6-6 partial (static); C6-4/C6-7 pending (D3). Limitation: lexical guard only; CI boundary outside guard (F9).
- [ ] C7 acceptance (draft PR #59, tested head `1153dd8f6aae575a8f46788b9bf3432d28e43817`, probe `apps/web/test/c7-pressure.test.ts`): C7-1, C7-2, C7-3, C7-4, C7-5, C7-6, C7-7, C7-8. Outcome: C7-1/C7-4/C7-5/C7-6 pass; C7-2/C7-3/C7-7/C7-8 partial. Limitation: invalid labels → valid_negative (F5); provenance strings only (F10); request-side proof only.
- [ ] C8 acceptance (docs PR, tested head `f7a91a15571c179d5cc5bf4a3c86e866576bb7dd`, probe `apps/web/test/c8-docs.test.ts`): C8-1, C8-2, C8-3, C8-4, C8-5, C8-6, C8-7, C8-8, C8-9. Outcome: prose checks pass (C8-3/C8-4/C8-7 partial until D6). Limitation: prose matching, not behavioral proof.
- [ ] C9 preparation (tested head `c6829e3c2a1b12de73878b2462d6d3014542bdac`, probe `apps/web/test/c9-prep.test.ts`, dummy values): C9-P1, C9-P2, C9-P3, C9-P4, C9-P5, C9-P6, C9-P7, C9-P8, C9-P9, C9-P10. Outcome: checklists + schema pass; execution blocked. Limitation: validation is not runtime binding (F7).
- [ ] D-series acceptance: D1-1, D1-2, D1-3, D1-4, D1-5 (head `a23b46295c302113a294713adace48d10f97030a`, pass, fake transports); D2-1, D2-2, D2-3, D2-4, D2-5, D2-6 (head `9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1`, pass, probe `apps/web/e2e/d2-approval.spec.ts`, fake transport); D3-1, D3-2, D3-3, D3-4, D3-5 (head `7af1d4b077a68d4063546fc94553bb73aa271397`, pass, fake repo); D4-1, D4-2, D4-3, D4-4, D4-5, D4-6 (head `b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe`, pass, inert stub); D5-1, D5-2, D5-3, D5-4, D5-5 (head `6b37061ee2d1726077961e1ac077de20e954a02c`, pass, dummy bundles); D6-1, D6-2, D6-3, D6-4, D6-5 (head `TBD-head`, this docs change, file checks only).
- [ ] Per-row ledger (head, test/probe, outcome, limitation for every ID above): [acceptance-registry.md](acceptance-registry.md). No row passes on CI alone.

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
