# Offline rehearsal of demo/synthetic-transcript.txt

Executed locally on Linux with Playwright Chromium against the offline test server (`SECOND_SEAT_TEST_MODE=1`). No provider call. This is not a screen-recorded video and not an owner-attested Spark result.

Observed on the current stack:

- `#offline-label` is visible and Demo Mode is on for `/session?demo=1`.
- After Redact, names and `555-013-8844` are masked. `ellis.ward@northglass-retail.example` remains.
- Approve plus Analyze while that email remains does not send the email or the phone to the analyzer.
- After the email is replaced with `[REDACTED_email]`, Analyze completes with two entries and zero pressure items.
- The verification heading is "Needs owner review" and claims are `not_run`.
- Each citation href matches an element on the page.
- `navigator.clipboard.writeText` receives `Please send a corrected written quote. I have not accepted the deadline.` once.
- Editing the draft disables Copy.

The browser spec is `apps/web/e2e/fr9-synthetic.spec.ts`. A Windows citation or clipboard check of this flow is still unverified.
