# Recording script: Second Seat (target 2:45, hard limit 3:00)

This is the offline engineering proof. It is not a decision that the submission must be offline-only. Speech is about 150 words per minute. The timing table counts clicks, corrections, waiting, and pauses as well as speech.

## Opening line (founder-supplied, spoken verbatim)

> "Just last month, on September 7, a vendor and I agreed on seven hundred dollars a month for point-of-sale hardware. The written quote said seven hundred fifty. I caught the difference and he corrected it. I built Second Seat for myself first. The idea predates this hackathon. This week's build is the live engine."

That line is 54 words, about 22 seconds, plus about 3 seconds to show the disclosure card. It fits in 0:00–0:25. It is not shortened.

All meeting data below is made up. Nobody in it is real. Don't paste real meeting text on camera.

## Before you hit record (not on camera)

1. `pnpm install && pnpm -r build`
2. Offline take: `SECOND_SEAT_TEST_MODE=1 pnpm --filter @second-seat/web serve`. The page labels itself "Offline demo".
3. Open http://localhost:4173/session?demo=1. Zoom the browser to 125%.
4. Copy `demo/synthetic-transcript.txt` to the clipboard. That file is the paste. It is fictional.

## NOT YET AUTHORIZED / NOT YET RECORDED

A future live hero clip would replace time inside this 2:45 plan. It would not extend the total. No deploy, warmup, or secret steps belong in this script. The Oct 28 owner-attested run summary stays with commit `0365fdb` and that run's own input. It is not this synthetic transcript and not an independently checked clip. User observations, the video URL, and Windows citation and clipboard checks stay pending.

## The script

| Time | On screen (click by click) | Voiceover |
|---|---|---|
| 0:00–0:25 | On camera. Disclosure card visible: "Pre-existing: the Second Seat idea and an earlier prototype. Built this week (Oct 26–Nov 4): everything in this repo." | "Just last month, on September 7, a vendor and I agreed on seven hundred dollars a month for point-of-sale hardware. The written quote said seven hundred fifty. I caught the difference and he corrected it. I built Second Seat for myself first. The idea predates this hackathon. This week's build is the live engine." |
| 0:25–0:40 | Demo Mode on. "Offline demo" label visible. Paste `demo/synthetic-transcript.txt`. Click **Redact**. Wait for "Review required". | "I paste that made-up call in. This is an offline demo." |
| 0:40–0:50 | Full names and the phone are masked. Bare Amira is still visible. The email `ellis.ward@northglass-retail.example` is still visible. Do not correct them yet. | "The phone and the full names are masked. Bare Amira and the email are still visible." |
| 0:50–1:08 | Click **Approve** while the email is still visible. Click **Analyze**. The state returns to review required. No findings. | "This Analyze attempt was blocked before downstream analysis." |
| 1:08–1:30 | Replace the email with `[REDACTED_email]` and bare Amira with `[REDACTED_person]`. Click **Approve**. Click **Analyze**. Wait for "Completed". | "I replace the email and the bare first name, then I approve this exact text." |
| 1:30–1:48 | Two findings. Click a citation that is actually on this page. No pressure item. The heading says needs owner review and that claim support was not checked. Do not say the screen caught a fifty-dollar gap or a November 15 badge. | "Only the text I approved gets analyzed. I see two findings and no pressure item. The heading says the claim check did not run." |
| 1:48–1:56 | No pressure checkbox is on screen. Do not tick one. | "There is nothing to check here. Copy is not waiting on a pressure box for this meeting." |
| 1:56–2:24 | Type: "Please send a corrected written quote. I have not accepted the deadline." Click **Approve draft**. Click **Copy** once. Change one word. Copy turns off. | "I write the reply, I approve that exact text, and I copy it once. I change one word and Copy turns off. Second Seat never sends a reply or message to the vendor." |
| 2:24–2:34 | One card already on screen. Small samples from existing files, not from this take: 9/9 seeded errors and 0/4 false alarms; 71/71 seeded mutants blocked or escalated and 0/13 semantic gaps caught. | "Small samples, not from this take. Nine of nine seeded errors, zero of four false alarms. Seventy-one of seventy-one mutants blocked, zero of thirteen gaps caught." |
| 2:34–2:45 | End card. | "A human in the final seat." |

## Timing (unspoken)

| Beat | Clock | Speech words | Speech at 150 wpm | Actions | Slot |
|---|---|---|---|---|---|
| Founder, verbatim, plus disclosure card | 0:00–0:25 | 54 | 22 s | show the card, about 3 s | 25 s |
| Paste and Redact | 0:25–0:40 | 11 | 4 s | paste, click, wait, about 8 s | 15 s |
| Point at mock misses | 0:40–0:50 | 14 | 6 s | point, about 4 s | 10 s |
| Blocked Analyze | 0:50–1:08 | 8 | 3 s | approve, analyze, wait, about 12 s | 18 s |
| Hand correction, approve, analyze | 1:08–1:30 | 16 | 6 s | two replacements, approve, analyze, about 14 s | 22 s |
| Two findings and one citation | 1:30–1:48 | 24 | 10 s | click the citation, about 4 s | 18 s |
| No pressure checkbox | 1:48–1:56 | 16 | 6 s | look, about 2 s | 8 s |
| Draft, one Copy, edit | 1:56–2:24 | 32 | 13 s, overlapping the typing | type, approve, copy, edit one word, about 16 s | 28 s |
| Evidence card | 2:24–2:34 | 26 | 10 s | card already visible | 10 s |
| Close | 2:34–2:45 | 6 | 2 s | logo hold | 11 s |
| Total | 0:00–2:45 | 207 | about 82 s of speech | actions and pauses fill the rest | 165 s |

## Rules for the take

- Use only `demo/synthetic-transcript.txt`. Do not edit that file.
- Say "offline demo" while the Offline demo label is visible.
- The blocked Analyze is one refused request. Do not say that nothing was ever sent, or that raw text never left a server.
- Do not say the local mock caught every sensitive detail, the fifty-dollar gap, or a November 15 pressure badge.
- Both Approve clicks must be visible. Demo Mode does not skip them.
- Never show a terminal with keys, `env` output, or `.env` files.
