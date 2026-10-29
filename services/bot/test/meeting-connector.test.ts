import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MeetingDenied,
  callProvider,
  createMeetingConnector,
  productionDispatch,
  type OwnerPrincipal,
  type StoredCallback,
} from "../src/meeting/connector.js";

const A: OwnerPrincipal = { ownerId: "owner-a" };
const B: OwnerPrincipal = { ownerId: "owner-b" };
const SECRET = "acme-secret-note";

function denied(fn: () => void): MeetingDenied {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MeetingDenied);
    const error = err as MeetingDenied;
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain("owner-a");
    return error;
  }
  throw new Error("expected denial");
}

describe("meeting connector", () => {
  it("T1-1 owner B cannot read, edit, approve, export, or delete A's meeting", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    const before = store.act(A, meetingId, { type: "export" }).text;
    for (const action of [
      { type: "read" } as const,
      { type: "edit", text: "changed" } as const,
      { type: "approve" } as const,
      { type: "export" } as const,
      { type: "delete" } as const,
    ]) {
      denied(() => store.act(B, meetingId, action));
    }
    expect(store.act(A, meetingId, { type: "export" }).text).toBe(before);
    expect(store.outboundCount()).toBe(0);
  });

  it("T1-2 a claimed ownerId does not replace the authenticated principal", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    denied(() => store.act(B, meetingId, { type: "read" }, A.ownerId));
    expect(() => store.act(null, meetingId, { type: "read" })).toThrow(MeetingDenied);
    expect(store.act(A, meetingId, { type: "read" }).text).toBe(SECRET);
  });

  it("T1-3 a suspended generation cannot deliver A's callback into B's session", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    const aSession = store.openSession(A);
    const bSession = store.openSession(B);
    const generation = store.authorityGeneration(A, meetingId);
    store.suspendGeneration(A, aSession.generationId);
    const callback: StoredCallback = {
      ownerId: A.ownerId,
      meetingId,
      generationId: aSession.generationId,
      authorityGeneration: generation,
      artifact: SECRET,
    };
    expect(store.resolveCallback(B, callback).delivered).toBe(false);
    expect(store.inbox(B, bSession.generationId)).toEqual([]);
    expect(store.inbox(A, aSession.generationId)).toEqual([]);
    store.openSession(A);
    const fresh = store.openSession(A);
    const live: StoredCallback = { ...callback, generationId: fresh.generationId };
    expect(store.resolveCallback(A, live).delivered).toBe(true);
    expect(store.inbox(A, fresh.generationId)).toEqual([SECRET]);
    expect(store.inbox(B, bSession.generationId)).toEqual([]);
  });

  it("T1-4 revocation advances authority and a replayed job does not call out", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    store.act(A, meetingId, { type: "approve" });
    expect(store.approved(A, meetingId)).toBe(true);
    const generation = store.authorityGeneration(A, meetingId);
    const next = store.revoke(A, meetingId);
    expect(next).toBeGreaterThan(generation);
    expect(store.approved(A, meetingId)).toBe(false);
    let calls = 0;
    const replayed = store.replay(
      {
        ownerId: A.ownerId,
        meetingId,
        generationId: "g-old",
        authorityGeneration: generation,
        artifact: SECRET,
      },
      () => {
        calls += 1;
      },
    );
    expect(replayed.ran).toBe(false);
    expect(calls).toBe(0);
    expect(store.outboundCount()).toBe(0);
    expect(store.authorityGeneration(A, meetingId)).toBe(next);
  });

  it("T1-5 non-loopback provider URLs are rejected before transport; fake adapters still run", () => {
    let calls = 0;
    const transport = () => {
      calls += 1;
    };
    for (const kind of ["brain", "capture", "voice", "avatar", "email"] as const) {
      expect(() => callProvider(kind, "https://example.invalid/hook", transport)).toThrow(MeetingDenied);
    }
    expect(calls).toBe(0);
    expect(callProvider("email", { inProcess: true }, transport)).toBe("fake");
    expect(calls).toBe(0);
    expect(callProvider("brain", "http://127.0.0.1:9/fake", transport)).toBe("loopback");
    expect(calls).toBe(1);
    expect(() => productionDispatch()).toThrow(/production-dispatch-disabled/);
  });

  it("T1 regression: the web server does not import the meeting connector", () => {
    const server = readFileSync(resolve(__dirname, "../../../apps/web/src/server.ts"), "utf8");
    expect(server).not.toContain("meeting/connector");
    expect(server).not.toContain("createMeetingConnector");
    expect(server).not.toContain("productionDispatch");
  });
});
