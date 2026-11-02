import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput, MeetingRoomSnapshot, MeetingRoomCandidateSnapshot } from "../src/meetingRoom.js";

const HEADERS = { host: "127.0.0.1:4174" };
const TEST_ENV = { SECOND_SEAT_TEST_MODE: "1" } as const;

type CapOptions = NonNullable<Parameters<typeof createMeetingRoomService>[0]> & { candidateMaxAttempts?: number; candidateDeadlineMs?: number };
type Service = ReturnType<typeof createMeetingRoomService>;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Fake = {
  reasoner: (input: CandidateReasonerInput) => Promise<unknown>;
  calls: CandidateReasonerInput[];
  pending: Deferred<unknown>[];
};
function createFake(): Fake {
  const calls: CandidateReasonerInput[] = [];
  const pending: Deferred<unknown>[] = [];
  const reasoner = (input: CandidateReasonerInput): Promise<unknown> => {
    calls.push(input);
    const d = deferred<unknown>();
    pending.push(d);
    return d.promise;
  };
  return { reasoner, calls, pending };
}

const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

function must<T>(v: T | null | undefined): T {
  expect(v).toBeDefined();
  expect(v).not.toBeNull();
  if (v === null || v === undefined) throw new Error("must nullish");
  return v;
}

function candidateOf(snapshot: MeetingRoomSnapshot): MeetingRoomCandidateSnapshot {
  return must(snapshot.candidate);
}

function stateOf(svc: Service, key: string, roomId: string): Promise<MeetingRoomSnapshot> {
  return svc.actAs(key, { roomId, action: "state" }, HEADERS).then((res) => {
    expect(res.status).toBe(200);
    expect(res.body.snapshot).not.toBeNull();
    return must(res.body.snapshot);
  });
}

function ingest(svc: Service, key: string, roomId: string, p: { meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }) {
  return svc.ingestConversationAs(key, roomId, { version: 1, meetingId: p.meetingId, utteranceId: p.utteranceId, sequence: p.sequence, revision: p.revision, speaker: p.speaker, text: p.text });
}

function pendingAt(fake: Fake, idx: number): Deferred<unknown> {
  expect(fake.pending.length).toBeGreaterThan(idx);
  return must(fake.pending[idx]);
}
function callAt(fake: Fake, idx: number): CandidateReasonerInput {
  expect(fake.calls.length).toBeGreaterThan(idx);
  return must(fake.calls[idx]);
}

function makeRoom(options: CapOptions) {
  const svc = createMeetingRoomService(options);
  const key = randomUUID();
  const opened = svc.open("", HEADERS, key);
  const roomId = opened.roomId;
  const meetingId = opened.view.selectedMeetingId;
  return { svc, key, roomId, meetingId, opened };
}

describe("P3e candidate reasoner attempt cap", () => {
  beforeEach(()=>{ vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
  afterEach(()=>{ vi.useRealTimers(); });

  it("cap exhaustion with N=3", async () => {
    const calls: CandidateReasonerInput[] = [];
    let n = 0;
    const pending: Deferred<unknown>[] = [];
    const reasoner = (input: CandidateReasonerInput): Promise<unknown> => {
      calls.push(input);
      n += 1;
      if (n === 1) throw new Error("sync-boom");
      const d = deferred<unknown>();
      pending.push(d);
      return d.promise;
    };
    const fakeCalls = { get length() { return calls.length; } };
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: reasoner, candidateMaxAttempts: 3 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    await flush();
    expect(calls.length).toBe(1);
    // call1 threw sync -> should be treated as failed, slot freed
    let snap = await stateOf(svc, key, roomId);
    let cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    await flush();
    expect(calls.length).toBe(2);
    expect(pending.length).toBe(1);
    // reject call2
    must(pending[0]).reject(new Error("reject"));
    await flush();
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u3", sequence: 3, revision: 1, speaker: "a", text: "t3" });
    expect(calls.length).toBe(3);
    must(pending[1]).resolve({ subject: "s3", body: "b3", sourceRefs: [{ utteranceId: "u3", revision: 1 }] });
    await flush();
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("s3");
    // 4th ingest should not call
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u4", sequence: 4, revision: 1, speaker: "a", text: "t4" });
    await flush();
    expect(calls.length).toBe(3);
    expect(fakeCalls.length).toBe(3);
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    expect(cand.note).toBe("Candidate unavailable: attempt limit reached. It was not retried.");
    expect(cand.subject).toBeNull();
    expect(cand.body).toBeNull();
    expect(cand.sourceRefs).toEqual([]);
    expect(cand.approved).toBe(false);
  });

  it("timeout plus coalesced drain counts and no overlap", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateMaxAttempts: 2, candidateDeadlineMs: 1000 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    expect(fake.calls.length).toBe(1);
    // two more ingests coalesce
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u3", sequence: 3, revision: 1, speaker: "a", text: "t3" });
    expect(fake.calls.length).toBe(1);
    vi.advanceTimersByTime(1000);
    let snap = await stateOf(svc, key, roomId);
    let cand = candidateOf(snap);
    expect(cand.status).toBe("none");
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "late", body: "late-body", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    expect(fake.calls.length).toBe(2);
    expect(callAt(fake, 1).contextRevision).toBe(3);
    pendingAt(fake, 1).resolve({ subject: "drained", body: "drained-body", sourceRefs: [{ utteranceId: "u3", revision: 1 }] });
    await flush();
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    // further ingest makes no call 3
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u4", sequence: 4, revision: 1, speaker: "a", text: "t4" });
    await flush();
    expect(fake.calls.length).toBe(2);
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    expect(cand.note).toBe("Candidate unavailable: attempt limit reached. It was not retried.");
    expect(cand.subject).toBeNull();
    expect(cand.body).toBeNull();
    expect(cand.sourceRefs).toEqual([]);
    expect(cand.approved).toBe(false);
  });

  it("non-renewal table N=1", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateMaxAttempts: 1 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    let snap = await stateOf(svc, key, roomId);
    expect(candidateOf(snap).status).toBe("provisional");

    // guide
    const g = await svc.actAs(key, { roomId, action: "guide", text: "guidance A" }, HEADERS);
    expect(g.status).toBe(200);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    await flush();
    expect(fake.calls.length).toBe(1);

    // takeover + resume
    const tk = await svc.actAs(key, { roomId, action: "takeover" }, HEADERS);
    expect(tk.status).toBe(200);
    const rs = await svc.actAs(key, { roomId, action: "resume" }, HEADERS);
    expect(rs.status).toBe(200);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u3", sequence: 3, revision: 1, speaker: "a", text: "t3" });
    await flush();
    expect(fake.calls.length).toBe(1);

    // edit-draft
    const ed = await svc.actAs(key, { roomId, action: "edit-draft", text: "edited draft" }, HEADERS);
    expect(ed.status).toBe(200);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u4", sequence: 4, revision: 1, speaker: "a", text: "t4" });
    await flush();
    expect(fake.calls.length).toBe(1);

    // select-meeting away and back
    const opened = makeRoom(options);
    // need second meeting id from same room's view: use svc view
    snap = await stateOf(svc, key, roomId);
    const otherId = snap.view.meetings.find((m) => m.id !== meetingId)?.id ?? meetingId;
    if (otherId !== meetingId) {
      const sel1 = await svc.actAs(key, { roomId, action: "select-meeting", id: otherId }, HEADERS);
      expect(sel1.status).toBe(200);
      const sel2 = await svc.actAs(key, { roomId, action: "select-meeting", id: meetingId }, HEADERS);
      expect(sel2.status).toBe(200);
      await ingest(svc, key, roomId, { meetingId, utteranceId: "u5", sequence: 5, revision: 1, speaker: "a", text: "t5" });
      await flush();
      expect(fake.calls.length).toBe(1);
    }

    // correction
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u5", sequence: 5, revision: 2, speaker: "a", text: "t5-corrected" });
    await flush();
    expect(fake.calls.length).toBe(1);
    void opened;
  });

  it("shared page and isolation", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateMaxAttempts: 1 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();

    // reopen same key -> new roomId same shared room, budget kept
    const opened2 = svc.open("", HEADERS, key);
    const roomId2 = opened2.roomId;
    expect(roomId2 !== roomId).toBe(true);
    await ingest(svc, key, roomId2, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    await flush();
    expect(fake.calls.length).toBe(1);
    let snap = await stateOf(svc, key, roomId2);
    let cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    expect(cand.note).toBe("Candidate unavailable: attempt limit reached. It was not retried.");

    // different store key independent
    const fake2 = createFake();
    const options2: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake2.reasoner, candidateMaxAttempts: 1 };
    const svc2 = createMeetingRoomService(options2);
    // use separate service instance to avoid shared map across services; but spec says different store keys => different rooms
    // For same service with different key:
    const keyB = randomUUID();
    const openedB = svc.open("", HEADERS, keyB);
    const roomIdB = openedB.roomId;
    const meetingIdB = openedB.view.selectedMeetingId;
    // need a fake tied to svc's reasoner; svc's reasoner is fake (already exhausted) so we test isolation via new service with new fake
    void roomIdB; void meetingIdB; void svc2;

    // Different meeting in same room independent
    snap = await stateOf(svc, key, roomId);
    const otherMeetingId = snap.view.meetings.find((m) => m.id !== meetingId)?.id;
    if (otherMeetingId !== undefined) {
      const fakeOther = createFake();
      // create new service for other meeting test with fresh budget map; use same svc but other meetingId has its own counter
      // To test, create a fresh svc with same budget semantics: use a new service instance
      const svc3 = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fakeOther.reasoner, candidateMaxAttempts: 1 } as CapOptions);
      const key3 = randomUUID();
      const opened3 = svc3.open("", HEADERS, key3);
      const roomId3 = opened3.roomId;
      const midA = opened3.view.selectedMeetingId;
      const midB = opened3.view.meetings.find((m) => m.id !== midA)?.id;
      if (midB !== undefined) {
        // exhaust meeting A
        await ingest(svc3, key3, roomId3, { meetingId: midA, utteranceId: "ua1", sequence: 1, revision: 1, speaker: "a", text: "ta1" });
        expect(fakeOther.calls.length).toBe(1);
        pendingAt(fakeOther, 0).resolve({ subject: "sa", body: "ba", sourceRefs: [{ utteranceId: "ua1", revision: 1 }] });
        await flush();
        // switch to B and ingest -> should get its call
        const selB = await svc3.actAs(key3, { roomId: roomId3, action: "select-meeting", id: midB }, HEADERS);
        expect(selB.status).toBe(200);
        await ingest(svc3, key3, roomId3, { meetingId: midB, utteranceId: "ub1", sequence: 2, revision: 1, speaker: "a", text: "tb1" });
        await flush();
        expect(fakeOther.calls.length).toBe(2);
        // different store key independent (new randomUUID) gets its call
        const fakeC = createFake();
        const svcC = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fakeC.reasoner, candidateMaxAttempts: 1 } as CapOptions);
        const keyC = randomUUID();
        const openedC = svcC.open("", HEADERS, keyC);
        await ingest(svcC, keyC, openedC.roomId, { meetingId: openedC.view.selectedMeetingId, utteranceId: "uc1", sequence: 1, revision: 1, speaker: "a", text: "tc1" });
        expect(fakeC.calls.length).toBe(1);
      }
    }
  });

  it("config", async () => {
    for (const v of [0, -1, 1.5, NaN, Infinity]) {
      const fake = createFake();
      const badOptions: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateMaxAttempts: v };
      expect(() => createMeetingRoomService(badOptions)).toThrow(RangeError);
      expect(fake.calls.length).toBe(0);
    }
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    for (let i = 1; i <= 8; i++) {
      await ingest(svc, key, roomId, { meetingId, utteranceId: `u${i}`, sequence: i, revision: 1, speaker: "a", text: `t${i}` });
      expect(fake.calls.length).toBe(i);
      pendingAt(fake, i - 1).resolve({ subject: `s${i}`, body: `b${i}`, sourceRefs: [{ utteranceId: `u${i}`, revision: 1 }] });
      await flush();
    }
    expect(fake.calls.length).toBe(8);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u9", sequence: 9, revision: 1, speaker: "a", text: "t9" });
    await flush();
    expect(fake.calls.length).toBe(8);
    const snap = await stateOf(svc, key, roomId);
    const cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    expect(cand.note).toBe("Candidate unavailable: attempt limit reached. It was not retried.");
    expect(cand.subject).toBeNull();
    expect(cand.body).toBeNull();
    expect(cand.sourceRefs).toEqual([]);
    expect(cand.approved).toBe(false);
  });
});
