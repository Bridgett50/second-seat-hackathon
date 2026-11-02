import { describe, expect, it } from "vitest";
import { applyGuidance } from "../src/t2/guidance.js";
import {
  SESSION_POLICY_VERSION,
  submitGuidance,
  evaluateOutgoing,
  holdCandidate,
  releaseHeld,
  resetAllPolicyState,
} from "../src/t2/session-policy.js";

// independent scanner for test assertions
function testHasProhibited(text: string): boolean {
  const pats: RegExp[] = [
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\.?/i,
    /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/,
    /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/,
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/i,
    /\b\d{1,2}:\d{2}\b/,
    /\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/i,
    /\b(?:today|tonight|tomorrow|yesterday)\b/i,
    /\b(?:next|this|last)\s+(?:week|month|quarter|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i,
    /\bin\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)\b/i,
    /\bend of (?:the )?(?:month|week|next week)\b/i,
  ];
  return pats.some((re) => re.test(text));
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("P1 session policy", () => {
  it("P1-1 no-dates guidance and four paraphrases suppress or hold every prohibited date disclosure", () => {
    const paraphrases = [
      "Please do not share any dates",
      "keep dates out of it",
      "don't mention when",
      "no timing details, I'll handle scheduling",
    ];
    const canonical = "Do not share dates. I will confirm the date myself.";
    const allGuidances = [canonical, ...paraphrases];

    const candidates = [
      "Launch is in March.",
      "Meeting on 03-14-2027 at office",
      "See you Tuesday at 3pm in room A",
      "Let's meet next Tuesday to review",
      "mar 14th is the deadline",
      "Due on 2027-03-14 please confirm",
      "Friday 15:30 works for me",
      "in two weeks we will deliver",
    ];

    let ownerIdx = 0;
    for (const g of allGuidances) {
      const owner = `owner-p1-1-${ownerIdx++}`;
      const meeting = "meet-A";
      resetAllPolicyState();
      const sub = submitGuidance(owner, meeting, g);
      // canonical must be applied
      if (g === canonical) {
        expect(sub.status).toBe("applied");
        expect(sub.version).toBe(SESSION_POLICY_VERSION);
      } else {
        // paraphrase: either applied or needs-clarification
        expect(["applied", "needs-clarification"]).toContain(sub.status);
        if (sub.status === "needs-clarification") {
          expect(sub.clarificationQuestion !== undefined && sub.clarificationQuestion.length > 0).toBe(true);
        }
      }

      for (const cand of candidates) {
        const res = evaluateOutgoing(owner, meeting, cand, "turn");
        if (res.outcome === "released") {
          expect(res.text !== undefined).toBe(true);
          expect(testHasProhibited(res.text as string)).toBe(false);
          // guidance text never echoed
          expect((res.text as string).includes(g)).toBe(false);
        } else {
          expect(res.outcome).toBe("held");
        }
      }
    }
  });

  it("P1-1b unmatched or ambiguous guidance never reports a false applied status", () => {
    resetAllPolicyState();
    const owner = "owner-p1-1b";
    const meeting = "meet-B";
    const unmatched = ["Keep it brief", "Thank Priya for the update"];
    for (const g of unmatched) {
      resetAllPolicyState();
      const sub = submitGuidance(owner, meeting, g);
      expect(sub.status).not.toBe("applied");
      const cand = "Launch is in March on Tuesday at 3pm";
      const res = evaluateOutgoing(owner, meeting, cand, "turn");
      expect(res.outcome).toBe("released");
      expect(res.text).toBe(cand);
    }
    resetAllPolicyState();
    const amb = submitGuidance(owner, meeting, "be careful about timing");
    expect(amb.status === "needs-clarification" || amb.status === "not-applied").toBe(true);
    expect(amb.status).not.toBe("applied");
  });

  it("P1-2 restriction persists across three turns and the follow-up draft for its meeting only", () => {
    resetAllPolicyState();
    const owner = "owner-p1-2";
    const meeting = "meet-1";
    submitGuidance(owner, meeting, "Do not share dates. I will confirm the date myself.");

    const turns = [
      "We will launch in March.",
      "See you on 3/14 at noon",
      "How about next Tuesday?",
    ];
    for (const t of turns) {
      const r = evaluateOutgoing(owner, meeting, t, "turn");
      if (r.outcome === "released") expect(testHasProhibited(r.text as string)).toBe(false);
      else expect(r.outcome).toBe("held");
      expect(r.version).toBe(SESSION_POLICY_VERSION);
      expect(typeof r.generation).toBe("number");
    }
    const draft = { subject: "Follow-up for March meeting", body: "Let's meet Friday 15:30 and finalize by 03-14-2027" };
    const dr = evaluateOutgoing(owner, meeting, draft, "follow-up-draft");
    if (dr.outcome === "released") expect(testHasProhibited(dr.text as string)).toBe(false);
    else expect(dr.outcome).toBe("held");

    // different meeting same owner -> released unchanged
    const otherMeeting = "meet-2";
    for (const t of turns) {
      const r2 = evaluateOutgoing(owner, otherMeeting, t, "turn");
      expect(r2.outcome).toBe("released");
      expect(r2.text).toBe(t);
    }
    // different owner same meeting id -> released unchanged
    const otherOwner = "owner-other";
    for (const t of turns) {
      const r3 = evaluateOutgoing(otherOwner, meeting, t, "turn");
      expect(r3.outcome).toBe("released");
      expect(r3.text).toBe(t);
    }
  });

  it("P1-3 guidance arriving while an output is held invalidates it before release", async () => {
    resetAllPolicyState();
    const owner = "owner-p1-3";
    const meeting = "meet-hold";
    const candidate = "Launch is in March next Tuesday";

    // pipeline that holds and awaits barrier
    const deferred = createDeferred<void>();
    const handle = holdCandidate(owner, meeting, candidate, "turn");
    let dispatchCount = 0;
    const dispatch = (): void => {
      dispatchCount += 1;
    };

    const pipeline = (async (): Promise<ReturnType<typeof releaseHeld>> => {
      await deferred.promise;
      return releaseHeld(handle, dispatch);
    })();

    // while held, submit new guidance for same scope (increments generation)
    submitGuidance(owner, meeting, "Keep it brief");
    deferred.resolve();
    const result = await pipeline;
    expect(result.outcome).toBe("invalidated");
    expect(result.text).toBeUndefined();
    expect(dispatchCount).toBe(0);
    // second release is single-use
    const second = releaseHeld(handle, dispatch);
    expect(second.outcome).toBe("invalidated");
    expect(dispatchCount).toBe(0);

    // control: different scope does not invalidate
    resetAllPolicyState();
    const owner2 = "owner-p1-3-ctrl";
    const handle2 = holdCandidate(owner2, meeting, candidate, "turn");
    let dispatchCount2 = 0;
    const deferred2 = createDeferred<void>();
    const pipeline2 = (async () => {
      await deferred2.promise;
      return releaseHeld(handle2, () => {
        dispatchCount2 += 1;
      });
    })();
    // guidance to different scope
    submitGuidance("other-owner", "other-meet", "Do not share dates. I will confirm the date myself.");
    deferred2.resolve();
    const result2 = await pipeline2;
    expect(result2.outcome).toBe("released");
    expect(dispatchCount2).toBe(1);
  });

  it("P1-4 seeded violation: a checker that lets March through is caught", () => {
    resetAllPolicyState();
    const owner = "owner-p1-4";
    const meeting = "meet-seeded";
    submitGuidance(owner, meeting, "Do not share dates. I will confirm the date myself.");

    const candidates = [
      "Launch is in March.",
      "Meeting on 3/14",
      "See you Tuesday at 3pm",
      "Let's do next Tuesday",
    ];

    function collectViolations(
      evalFn: (o: string, m: string, c: string) => { outcome: string; text?: string },
    ): string[] {
      const violations: string[] = [];
      for (const c of candidates) {
        const r = evalFn(owner, meeting, c);
        if (r.outcome === "released" && r.text !== undefined && testHasProhibited(r.text)) {
          violations.push(r.text);
        }
      }
      return violations;
    }

    // real checker: should have no violations
    const realViolations = collectViolations((o, m, c) => {
      const r = evaluateOutgoing(o, m, c, "turn");
      return { outcome: r.outcome, ...(r.text !== undefined ? { text: r.text } : {}) };
    });
    expect(realViolations.length).toBe(0);

    // broken checker: re-inserts March into released text
    const brokenViolations = collectViolations((o, m, c) => {
      const r = evaluateOutgoing(o, m, c, "turn");
      if (r.outcome === "released") {
        return { outcome: "released", text: `${r.text as string} March` };
      }
      // also broken: releases held as-is
      return { outcome: "released", text: c };
    });
    expect(brokenViolations.length > 0).toBe(true);
  });

  it("P1-5 legacy scripted applyGuidance behavior is unchanged", () => {
    expect(applyGuidance("Launch is in March.", "Keep it calm")).toBe("Noted — Launch is in March.");
    expect(applyGuidance("Launch is in March.", "no dates")).toBe("Launch is in a date Bridgett will confirm.");
  });
});
