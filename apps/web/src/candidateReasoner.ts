import type { GatedText, PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import type { CandidateReasoner, CandidateReasonerInput } from "./meetingRoom.js";

export type CandidateBinding = Readonly<{
  roomId: string;
  ownerId: string;
  meetingId: string;
  contextRevision: number;
  policyGeneration: number;
  epoch?: number;
}>;

export type CandidateReasonerDeps = {
  gate: PrivacyGate;
  requestOwnerApproval: (runId: string, redactedPreview: string, binding: CandidateBinding) => Promise<string | null>;
  isCurrent: (binding: CandidateBinding) => boolean;
  callModel: (gated: GatedText) => Promise<unknown>;
};

export function createCandidateReasoner(
  env: Readonly<Record<string, string | undefined>>,
  deps?: CandidateReasonerDeps,
): CandidateReasoner | undefined {
  if (env["SECOND_SEAT_CANDIDATE_REASONER"] !== "1") return undefined;
  if (env["SECOND_SEAT_TEST_MODE"] === "1") return undefined;
  if (!deps || !deps.gate || !deps.requestOwnerApproval || !deps.isCurrent || !deps.callModel) return undefined;
  const { gate, requestOwnerApproval, isCurrent, callModel } = deps;
  return async (input: CandidateReasonerInput): Promise<unknown> => {
    const binding: CandidateBinding = Object.freeze({
      roomId: input.roomId,
      ownerId: input.ownerId,
      meetingId: input.meetingId,
      contextRevision: input.contextRevision,
      policyGeneration: input.policyGeneration,
      ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
    });
    if (!isCurrent(binding)) throw new Error("stale context");
    const serialized = input.utterances.map((u) => `${u.utteranceId} ${u.revision} ${u.speaker} ${u.text}`).join("\n");
    const prepared = await gate.prepare(serialized);
    try {
      if (!isCurrent(binding)) throw new Error("stale context");
      input.registerRevoke?.(() => gate.revoke(prepared.runId));
      const token = await requestOwnerApproval(prepared.runId, prepared.redactedText, binding);
      if (!isCurrent(binding)) throw new Error("stale context");
      if (token === null) throw new Error("approval denied");
      return await gate.send(prepared.runId, token, async (gated) => {
        if (!isCurrent(binding)) throw new Error("stale context");
        return callModel(gated);
      });
    } finally {
      gate.revoke(prepared.runId);
    }
  };
}
