import { describe, expect, it, vi } from "vitest";
import { createPrivacyGate, GatedText } from "@second-seat/bot/dist/src/private/gate.js";
import { createCandidateReasoner } from "../src/candidateReasoner.js";
import type { CandidateReasonerInput } from "../src/meetingRoom.js";

function fakeRedactor() {
  return {
    label: "test-fake",
    redactText: async (text: string) => {
      const needle = "alice@example.com";
      const idx = text.indexOf(needle);
      if (idx !== -1) {
        return { maskedText: text.slice(0, idx) + "[REDACTED_email]" + text.slice(idx + needle.length), spans: [{ start: idx, end: idx + needle.length, label: "email" }] };
      }
      return { maskedText: text, spans: [] };
    },
    redactImage: async () => { throw new Error("no images"); },
    health: async () => ({ ok: true, label: "test-fake" }),
  };
}

function baseInput(): CandidateReasonerInput {
  return { roomId: "r1", ownerId: "o1", meetingId: "m1", contextRevision: 7, policyGeneration: 3, utterances: [{ utteranceId: "u1", sequence: 0, revision: 1, speaker: "alice", text: "hi alice@example.com" }], guidance: ["SECRET_GUIDANCE_XYZ"], notes: ["SECRET_NOTES_ABC"] };
}

describe("candidateReasoner", () => {
  it("OFF", () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const deps = { gate, requestOwnerApproval: async () => null, isCurrent: () => true, callModel: async (_g: GatedText) => null };
    expect(createCandidateReasoner({}, deps)).toBeUndefined();
    expect(createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "0" }, deps)).toBeUndefined();
    expect(createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" })).toBeUndefined();
    expect(createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1", SECOND_SEAT_TEST_MODE: "1" }, deps)).toBeUndefined();
  });
  it("approved containment + frozen binding", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "model-ok");
    let seenBinding: unknown;
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (runId, redactedPreview, binding) => { seenBinding = binding; return gate.approve(runId, redactedPreview); }, isCurrent: () => true, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    await expect(reasoner(baseInput())).resolves.toBe("model-ok");
    expect(model).toHaveBeenCalledTimes(1);
    const call = model.mock.calls[0];
    if (call === undefined) throw new Error("no call");
    const gated = call[0];
    expect(gated).toBeInstanceOf(GatedText);
    expect(gated.text).toContain("[REDACTED_email]");
    expect(gated.text).toContain("u1");
    expect(gated.text).not.toContain("alice@example.com");
    expect(gated.text).not.toContain("SECRET_GUIDANCE_XYZ");
    expect(gated.text).not.toContain("SECRET_NOTES_ABC");
    expect(Object.isFrozen(seenBinding)).toBe(true);
    expect(seenBinding).toEqual({ roomId: "r1", ownerId: "o1", meetingId: "m1", contextRevision: 7, policyGeneration: 3 });
  });
  it("denial", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "ok");
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async () => null, isCurrent: () => true, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    await expect(reasoner(baseInput())).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(0);
  });
  it("held approval goes stale", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "ok");
    let current = true;
    let capturedRunId = "";
    let capturedPreview = "";
    let resolveEntered: (v: void) => void = () => {};
    const entered = new Promise<void>((res) => { resolveEntered = res; });
    let resolveToken: (v: string) => void = () => {};
    const heldToken = new Promise<string>((res) => { resolveToken = res; });
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (r, red) => { capturedRunId = r; capturedPreview = red; resolveEntered(); return heldToken; }, isCurrent: () => current, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    const p = reasoner(baseInput());
    await entered;
    current = false;
    const realToken = gate.approve(capturedRunId, capturedPreview);
    resolveToken(realToken);
    await expect(p).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(0);
    const fn = vi.fn(async (_g: GatedText) => "x");
    await expect(gate.send(capturedRunId, realToken, fn)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});
