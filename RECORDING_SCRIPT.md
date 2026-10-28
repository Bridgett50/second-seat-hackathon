# Recording script: Second Seat (target 2:50, hard limit 3:00)

## Opening line (founder-supplied)

> "In September, a vendor and I agreed on seven hundred dollars a month by phone. The written quote said seven-fifty. I caught it, and they fixed it. Second Seat helps the next owner catch it too."

All meeting data below is made up. Nobody in it is real. Don't paste real meeting text on camera.

## Before you hit record (not on camera)

1. In a terminal: `pnpm install && pnpm -r build`.
2. **Live take** (the live path passed 3/3 on Oct 28, 2026 at `0365fdb`; label the take as a recorded run):
   - Set `GLIMMER_BASE_URL` and `META_API_KEY` in the shell. Never show them on screen.
   - Run `scripts/warmup.sh` and wait for `warmup: done`. Glimmer cold starts can take many minutes.
   - Start the server with `SECOND_SEAT_MODE=live pnpm --filter @second-seat/web serve`.
3. **Offline take** (the public link, and the default): `SECOND_SEAT_TEST_MODE=1 pnpm --filter @second-seat/web serve`. The page labels itself "Offline demo". Say "offline demo" in the voiceover. The public link is this demo mode, with recorded examples.
4. Browser tabs:
   - Tab 1: http://localhost:4173/session?demo=1 (Live take: http://localhost:4173/session?mode=live&demo=1)
   - Tab 2: http://localhost:4173/briefs/demo
   - Tab 3: the latest green CI run for the release PR
5. Copy the made-up transcript below to the clipboard. Zoom the browser to 125%.

Made-up transcript (paste exactly):

```
Dana Whitfield (Acme Freight): Thanks for joining. You can reach me at 555-0142 or dana.whitfield@acmefreight.example.
Dana Whitfield: We can do the pilot at $18,000 for 3 months, starting November 15.
You: We still need our security review before we sign anything.
Dana Whitfield: Honestly, this price is a last chance. It expires tonight and we only have 2 spots left.
Dana Whitfield: You already agreed on the last call that you would sign this week.
You: Can you send the data retention terms in writing?
```

## The script

| Time | On screen (click by click) | Voiceover |
|---|---|---|
| 0:00–0:08 | Title card with this text: "Pre-existing: the Second Seat idea and an earlier prototype. Built this week (Oct 26–Nov 4): everything in this repo." | Read the card exactly as written. |
| **Pain** 0:08–0:30 | Tab 1, the empty session page. Hover over the header: Mode, Demo Mode on, the step bar. | "After a vendor call, I have a transcript full of personal details, a price, a deadline, and a little pressure. I want a brief I can trust, without handing raw meeting text to anyone, and without anything acting on my behalf." |
| **Live Magic: Glimmer** 0:30–1:05 | 1. Click into **Paste transcript** and paste. 2. Click **Redact**. 3. Wait for "Review required". 4. Point at the redacted preview: the name is masked. 5. If the phone or email is still visible (it will be in the Offline take, where local masking only handles names), select `555-0142` in the preview and type `[REDACTED_phone]`, then select the email and type `[REDACTED_email]`. 6. Click **Approve**. | Live take: "Raw text goes only to Glimmer, Meta's open-weights model, which we self-host with vLLM on Modal at temperature zero. It masks personal details, and I can fix anything it missed. Nothing goes further until I approve." Offline take: "In this offline demo, local masking stands in for Glimmer, so I fix the phone and email myself. If I didn't, the privacy gate would refuse to send residual PII." |
| **Live Magic: Spark** 1:05–1:40 | 1. Click **Analyze**. 2. Wait for "Completed". 3. Scroll through the findings. In the Offline take these are the $18,000 / 3-month / November 15 pilot line [seg-2] and the retention-terms ask [seg-6]; a Live brief will word and group them differently. 4. Scroll to **Possible pressure**: "last chance / expires tonight / only 2 spots left" (scarcity) and "you already agreed" (commitment). 5. Tick **Reviewed** on each pressure item. | "Spark only sees the redacted text I approved. It writes a short brief, and every line cites the part of the meeting it came from. It also flags pressure tactics. That's an assessment, not a judgment of anyone's intent." |
| 1:40–1:55 | 1. In **Draft reply**, type: "Thanks, Dana. We'll decide after our security review. Please send the retention terms in writing." 2. Click **Approve draft**. 3. Click **Copy**. 4. Show "Copied locally. Nothing was sent." | "I write the reply, I approve that exact text, and I copy it myself. Second Seat never sends a reply or message to the vendor." |
| **Proof** 1:55–2:30 | 1. Click the citation link **[seg-2]** in a finding; the page jumps to that transcript segment. 2. Tab 2: scroll to the prompt-cache panel and point at the cache-hit ratio. 3. Tab 3: show the green CI run with all eight steps passing (unit tests, typecheck, build, Playwright, repeat and clean-build checks). | "Every claim links back to its source line. Each call family uses a stable prompt cache key, and we show the cache-hit ratio straight from the recorded token counts. The recorded brief shows zero cached tokens, and we say so. Every PR runs eight CI steps, including browser tests of this exact flow." |
| **Tech** 2:30–2:50 | Show the README section "How We Use Meta's Models", or a slide with the diagram: paste → Glimmer (vLLM on Modal) → owner approval → Spark brief → deterministic checks → owner approves draft → owner copies. | "Glimmer open weights on our own GPU for privacy. Spark for the cited brief with a strict schema. Deterministic checks reject citations that don't resolve. A cost guard caps spend. Two human approvals. No auto-send." |
| 2:50 | End card: "Second Seat. You decide." | (silence) |

## Rules for the take

- Use only the made-up transcript above.
- Don't say "live" in an Offline take. The "Offline demo" label must stay visible. A clip of the Oct 28 live run must be labeled as a recorded run. Organizers confirmed recorded runs are fine if labeled. The Oct 28 recording still masks "November 15" as a date of birth; #116 changes that prompt and was rehearsed without a new live model call.
- Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it. Do not describe it as finished.
- Never show a terminal with keys, `env` output, or `.env` files.
- Demo Mode doesn't skip approvals. Both Approve clicks must be visible on camera.
