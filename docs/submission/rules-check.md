# Rules check

- [ ] Video shows only Oct 26+ work. The disclosure card is line 1, spoken and on screen.
- [ ] No banned category. This is an after-call review tool, not any of the excluded builds.
- [ ] Every number traces to a log. Any on-screen or spoken number without a source file in brackets gets cut before recording.
- [ ] X post is draft only. Bridgett posts it herself; nothing here auto-posts.
- [ ] No deploy. Fixture mode plus one capped live clip ONLY if a live run was actually performed and logged; otherwise no live clip. Spend cap $5/day plus daily call-count cap with refuse-and-stop behavior [docs/failure-modes.md].
- [ ] Replay honesty: "replay" or "offline demo," never "live analysis." Second Seat never joins calls and never sends a reply.
- [ ] Glimmer honesty: the incomplete historical run is shown WITH its limitations (6/8 requests, 18/29 on completed, 18/39 end-to-end, span coverage not re-scorable) [services/bot/fixtures/glimmer-run/rescore.json]. The n=10 10/10 figure [services/bot/fixtures/glimmer-live-eval-n10.json] is a small smoke test and is never the headline.
- [ ] SAM honesty: SAM/image features are experimental, off by default, and not in the core video at all.
- [ ] No PDF drop shown. The PDF normalizer was cut.
- [ ] No screenshot upload shown. The core video pastes transcript text only.
- [ ] Support numbers shown with misses: frozen rerun mismatched 2 cases [eval/results/support-table-frozen-live.md].
- [ ] No "catches everything" claim. No unsupported privacy guarantee: say what the code does (approved redacted text through the privacy gate; test mode offline even with credentials) [apps/web/src/liveConfig.ts], never "the raw transcript never left our server" as a guarantee.
- [ ] Founder story, user observations, video URLs: PENDING — not yet supplied. Nothing invented.
- [ ] Statuses stated accurately: A1–A9 merged, criteria met on the tested commits, live end-to-end verified Oct 28, 2026 on main 0365fdb (3/3 runs passed; the owner's private run summary second-seat-live3-run-summary.md is the record), partner none; draft PRs B1–B8 pending review.
