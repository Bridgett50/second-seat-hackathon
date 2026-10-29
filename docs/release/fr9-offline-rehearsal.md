# Offline rehearsal of demo/synthetic-transcript.txt

Linux Chromium, offline test server (`SECOND_SEAT_TEST_MODE=1`). No provider call. Not a screen recording and not an owner-attested Spark result. Windows citation and clipboard checks are UNVERIFIED.

Parent of this hardening: `cb5347fbc9361d04617117722c77f2c71494e1f1`. The existing blocked-state assertion was already:

`await expect(page.locator("#session-state")).toHaveText("Review required — check the redacted preview, then approve.")`

That assertion passed on the parent before this change (`playwright test e2e/fr9-synthetic.spec.ts`, 1 passed). It does not accept a generic Error or Completed label.

## What the unchanged transcript does

Initial mock masking does not catch everything:

- `555-013-8844`, `Ellis Ward`, and `Amira Solano` are masked.
- Bare `Amira` remains. Bare `Ellis` does not. `ellis.ward@northglass-retail.example` remains.

The test then replaces the email and bare `Amira` by hand. The one analyzer callback receives that corrected text and does not contain the phone, the email, `Amira`, or `Ellis`.

Approve plus Analyze while the email remains returns to review required, with zero new analyzer callbacks, no new dispatch receipt, a null result, and `draft === null`. The draft section stays hidden and Copy stays disabled. A programmatic click does not call `writeText`.

The later Copy calls `navigator.clipboard.writeText` once. That argument equals the approved draft exactly. On this Linux Chromium, `readText()` also equals that draft, including its spaces. Those are separate checks. A Windows LF-to-CRLF readback was not run.

The approval flag is true only when the stored `approvedHash` matches `hashDraft` from `apps/web/src/draftApproval.ts` (FNV-1a 32-bit, hex). The browser check reads that stored hash from the session state and compares it with `hashDraft` of the exact `writeText` argument. Editing the draft clears that approval and disables Copy. The same session id is used from paste through that edit. Each citation target's text is contained in the corrected approved text.

## Stored approval hash

The session state draft now includes the stored `approvedHash`. The spec compares that value with production `hashDraft` of the exact `writeText` argument.

Seed, not committed. `approveDraft` stored `"seed-corrupt"` instead of `hashDraft(text)`, and the snapshot's approved bit ignored the hash mismatch so the earlier `approved === true` check still passed. The hash assertion then failed:

```text
Expected: "a246f4ec"
Received: "seed-corrupt"
expect(sameDraft.approvedHash).toBe(productionHashDraft(writes[0]))
```

That seed was restored before the clean run.

## B-8 sensitivity

These were seeded, then restored. They are not production transitions left in the tree.

- Zero callbacks. Synthetic injection: the analyze route recorded `seeded-callback` before the real analyze. The blocked label still appeared. `expect(leaked).toEqual([])` then failed. Received: `["seeded-callback"]`. Skipping only the session redaction return would still be stopped by the privacy gate and would not reach this callback assertion.
- Stale draft. Seeded assignment on the redaction-block path: `draft` set to `{ text: "stale reply", approved: true }` instead of null. `expect(blocked.draft).toBeNull()` failed. Received that object.
- Exact copy input. Seeded copy handler passed `text + " "` to `writeText`. `expect(writes[0]).toBe(DRAFT)` failed. Received the draft plus one trailing space.

Clean `e2e/fr9-synthetic.spec.ts` was run again after those files were restored.
