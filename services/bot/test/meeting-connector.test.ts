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
    const fresh = store.openSession(A);
    const job = store.issueJob(A, meetingId, fresh.generationId);
    const live: StoredCallback = {
      jobId: job.jobId,
      ownerId: A.ownerId,
      meetingId,
      generationId: fresh.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: SECRET,
    };
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
    expect(calls).toBe(1);
    expect(callProvider("brain", "http://127.0.0.1:9/fake", transport)).toBe("loopback");
    expect(calls).toBe(2);
    expect(() => productionDispatch()).toThrow(/production-dispatch-disabled/);
  });

  it("T1 regression: the web server does not import the meeting connector", () => {
    const server = readFileSync(resolve(__dirname, "../../../apps/web/src/server.ts"), "utf8");
    expect(server).not.toContain("meeting/connector");
    expect(server).not.toContain("createMeetingConnector");
    expect(server).not.toContain("productionDispatch");
  });
});

describe("R134 reproductions", () => {
  function setup() {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "Synthetic scheduling note v1");
    const { generationId } = c.openSession(A);
    const cb: StoredCallback = {
      ownerId: A.ownerId,
      meetingId,
      generationId,
      authorityGeneration: c.authorityGeneration(A, meetingId),
      artifact: "Synthetic answer v1",
    };
    return { c, meetingId, generationId, cb };
  }

  it("R134-1: a callback claiming another owner cannot execute replay transport", () => {
    const { c, cb } = setup();
    let calls = 0;
    c.replay({ ...cb, ownerId: B.ownerId }, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("R134-2: a suspended generation cannot execute replay transport", () => {
    const { c, cb, generationId } = setup();
    let calls = 0;
    c.suspendGeneration(A, generationId);
    c.replay(cb, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("R134-3: an unknown generation cannot execute replay transport", () => {
    const { c, cb } = setup();
    let calls = 0;
    c.replay({ ...cb, generationId: "never-created" }, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("R134-4: editing source evidence rejects its older callback", () => {
    const { c, meetingId, generationId, cb } = setup();
    c.act(A, meetingId, { type: "edit", text: "Synthetic scheduling note v2" });
    c.resolveCallback(A, cb);
    expect(c.inbox(A, generationId)).toEqual([]);
  });

  it("R134-5: duplicate callback resolution does not duplicate an artifact", () => {
    const { c, generationId, cb } = setup();
    c.resolveCallback(A, cb);
    c.resolveCallback(A, cb);
    expect(c.inbox(A, generationId).length).toBeLessThanOrEqual(1);
  });

  it("R134-6: documented IPv6 loopback accepts one injected fake transport", () => {
    let calls = 0;
    let result = "threw";
    try {
      result = callProvider("brain", "http://[::1]:9/fake", () => {
        calls += 1;
      });
    } catch {
      result = "threw";
    }
    expect(result).toBe("loopback");
    expect(calls).toBe(1);
  });

  it("R134-7: in-process fake adapter actually runs once", () => {
    let calls = 0;
    expect(
      callProvider("brain", { inProcess: true }, () => {
        calls += 1;
      }),
    ).toBe("fake");
    expect(calls).toBe(1);
  });

  it("CONTROL: revoked authority blocks replay", () => {
    const { c, meetingId, cb } = setup();
    let calls = 0;
    c.revoke(A, meetingId);
    c.replay(cb, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("CONTROL: cross-owner direct reads and production dispatch are denied", () => {
    const { c, meetingId } = setup();
    expect(() => c.act(B, meetingId, { type: "read" })).toThrow(MeetingDenied);
    expect(() => productionDispatch()).toThrow(MeetingDenied);
  });
});

describe("M1 issued jobs", () => {
  function issued(meetingText = "note v1"): {
    c: ReturnType<typeof createMeetingConnector>;
    meetingId: string;
    generationId: string;
  } {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, meetingText);
    const { generationId } = c.openSession(A);
    return { c, meetingId, generationId };
  }

  function envelope(
    job: { jobId: string; ownerId: string; meetingId: string; generationId: string },
    over: {
      jobId?: string;
      ownerId?: string;
      meetingId?: string;
      generationId?: string;
      authorityGeneration?: number;
      sourceRevision?: number;
      artifact?: string;
    },
    base: { authorityGeneration: number; sourceRevision: number },
  ): StoredCallback {
    return {
      jobId: over.jobId ?? job.jobId,
      ownerId: over.ownerId ?? job.ownerId,
      meetingId: over.meetingId ?? job.meetingId,
      generationId: over.generationId ?? job.generationId,
      authorityGeneration: over.authorityGeneration ?? base.authorityGeneration,
      sourceRevision: over.sourceRevision ?? base.sourceRevision,
      artifact: over.artifact ?? "answer",
    };
  }

  it("M1-1 forged owner, unknown generation and suspended generation cannot replay; fresh job dispatches", () => {
    const { c, meetingId, generationId } = issued();
    const job = c.issueJob(A, meetingId, generationId);
    const base = envelope(job, {}, job);
    let calls = 0;
    const transport = () => {
      calls += 1;
    };
    expect(c.replay({ ...base, ownerId: B.ownerId }, transport).ran).toBe(false);
    expect(calls).toBe(0);
    expect(c.replay({ ...base, generationId: "g-never-created" }, transport).ran).toBe(false);
    expect(calls).toBe(0);
    const other = c.openSession(A);
    const suspended = c.issueJob(A, meetingId, other.generationId);
    c.suspendGeneration(A, other.generationId);
    expect(c.replay(envelope(suspended, {}, suspended), transport).ran).toBe(false);
    expect(calls).toBe(0);
    expect(c.replay(base, transport).ran).toBe(true);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });

  it("M1-2 edited source rejects old work immediately; fresh revision-2 work succeeds", () => {
    const { c, meetingId, generationId } = issued("note v1");
    const old = c.issueJob(A, meetingId, generationId);
    const oldCb = envelope(old, { artifact: "answer v1" }, old);
    c.act(A, meetingId, { type: "edit", text: "note v2" });
    expect(c.resolveCallback(A, oldCb).delivered).toBe(false);
    expect(c.inbox(A, generationId)).toEqual([]);
    let calls = 0;
    expect(
      c.replay(oldCb, () => {
        calls += 1;
      }).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    const fresh = c.issueJob(A, meetingId, generationId);
    expect(fresh.sourceRevision).toBe(2);
    const freshCb = envelope(fresh, { artifact: "answer v2" }, fresh);
    expect(c.resolveCallback(A, freshCb).delivered).toBe(true);
    expect(c.inbox(A, generationId)).toEqual(["answer v2"]);
    expect(
      c.replay(freshCb, () => {
        calls += 1;
      }).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("M1-3 one-field tampering against valid same-owner records is rejected; unknown jobId fails", () => {
    const c = createMeetingConnector();
    const m1 = c.createMeeting(A, "m1").meetingId;
    const m2 = c.createMeeting(A, "m2").meetingId;
    const m3 = c.createMeeting(A, "m3").meetingId;
    const g1 = c.openSession(A).generationId;
    const g2 = c.openSession(A).generationId;
    c.act(A, m3, { type: "edit", text: "m3 rev 2" });
    c.revoke(A, m2);
    const j1 = c.issueJob(A, m1, g1);
    const env = (over: {
      jobId?: string;
      ownerId?: string;
      meetingId?: string;
      generationId?: string;
      authorityGeneration?: number;
      sourceRevision?: number;
    }): StoredCallback => envelope(j1, over, j1);
    let calls = 0;
    const transport = () => {
      calls += 1;
    };
    expect(c.resolveCallback(A, env({ meetingId: m2 })).delivered).toBe(false);
    expect(c.replay(env({ meetingId: m2 }), transport).ran).toBe(false);
    expect(c.resolveCallback(A, env({ generationId: g2 })).delivered).toBe(false);
    expect(c.replay(env({ generationId: g2 }), transport).ran).toBe(false);
    expect(c.resolveCallback(A, env({ authorityGeneration: 2 })).delivered).toBe(false);
    expect(c.replay(env({ authorityGeneration: 2 }), transport).ran).toBe(false);
    expect(c.resolveCallback(A, env({ sourceRevision: 2 })).delivered).toBe(false);
    expect(c.replay(env({ sourceRevision: 2 }), transport).ran).toBe(false);
    expect(calls).toBe(0);
    expect(c.outboundCount()).toBe(0);
    const unknown = env({ jobId: "j-never-issued" });
    expect(c.resolveCallback(A, unknown).delivered).toBe(false);
    expect(c.replay(unknown, transport).ran).toBe(false);
    expect(calls).toBe(0);
    const valid = env({});
    const oldShape: StoredCallback = {
      ownerId: valid.ownerId,
      meetingId: valid.meetingId,
      generationId: valid.generationId,
      authorityGeneration: valid.authorityGeneration,
      sourceRevision: valid.sourceRevision ?? j1.sourceRevision,
      artifact: valid.artifact,
    };
    expect(c.resolveCallback(A, oldShape).delivered).toBe(false);
    expect(c.replay(oldShape, transport).ran).toBe(false);
    expect(calls).toBe(0);
    expect(c.resolveCallback(A, valid).delivered).toBe(true);
    expect(c.inbox(A, g1)).toEqual(["answer"]);
  });

  it("M1-4 duplicate resolve yields one artifact; duplicate replay calls transport at most once", () => {
    const { c, meetingId, generationId } = issued();
    const job = c.issueJob(A, meetingId, generationId);
    const cb = envelope(job, { artifact: "answer" }, job);
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    expect(c.resolveCallback(A, cb).delivered).toBe(false);
    expect(c.inbox(A, generationId)).toEqual(["answer"]);
    let calls = 0;
    const transport = () => {
      calls += 1;
    };
    expect(c.replay(cb, transport).ran).toBe(true);
    expect(c.replay(cb, transport).ran).toBe(false);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
    const g2 = c.openSession(A).generationId;
    const job2 = c.issueJob(A, meetingId, g2);
    const cb2 = envelope(job2, { artifact: "answer 2" }, job2);
    expect(c.resolveCallback(A, cb2).delivered).toBe(true);
    expect(c.inbox(A, g2)).toEqual(["answer 2"]);
    expect(c.replay(cb2, transport).ran).toBe(true);
    expect(calls).toBe(2);
  });

  it("M1-5 each guard fails on its own: suspension, viewer, authority, expiry, revocation", () => {
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      c.suspendGeneration(A, generationId);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(A, cb).delivered).toBe(false);
      expect(c.inbox(A, generationId)).toEqual([]);
      let calls = 0;
      expect(
        c.replay(cb, () => {
          calls += 1;
        }).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(B, cb).delivered).toBe(false);
      expect(c.inbox(A, generationId)).toEqual([]);
      let calls = 0;
      expect(
        c.replay(
          { ...cb, ownerId: B.ownerId },
          () => {
            calls += 1;
          },
        ).ran,
      ).toBe(false);
      expect(calls).toBe(0);
      expect(c.resolveCallback(A, cb).delivered).toBe(true);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      expect(c.act(A, meetingId, { type: "read" }).text).toBe("note");
      let calls = 0;
      const tampered = envelope(job, { authorityGeneration: job.authorityGeneration + 1 }, job);
      expect(c.resolveCallback(A, tampered).delivered).toBe(false);
      expect(
        c.replay(tampered, () => {
          calls += 1;
        }).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      c.expire(A, meetingId, 0);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(A, cb).delivered).toBe(false);
      let calls = 0;
      expect(
        c.replay(cb, () => {
          calls += 1;
        }).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      c.revoke(A, meetingId);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(A, cb).delivered).toBe(false);
      let calls = 0;
      expect(
        c.replay(cb, () => {
          calls += 1;
        }).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
  });

  it("M1-6 fake adapter runs once and propagates errors; loopback matrix is exact", () => {
    const seen: string[] = [];
    expect(
      callProvider("brain", { inProcess: true }, (url) => {
        seen.push(url);
      }),
    ).toBe("fake");
    expect(seen.length).toBe(1);
    expect(() =>
      callProvider("brain", { inProcess: true }, () => {
        throw new Error("boom-fake");
      }),
    ).toThrow("boom-fake");
    expect(seen.length).toBe(1);
    for (const target of [
      "http://127.0.0.1:9/fake",
      "http://localhost:9/fake",
      "http://[::1]:9/fake",
    ] as const) {
      for (const kind of ["brain", "capture", "voice", "avatar", "email"] as const) {
        const before = seen.length;
        expect(
          callProvider(kind, target, (url) => {
            seen.push(url);
          }),
        ).toBe("loopback");
        expect(seen.length).toBe(before + 1);
      }
    }
    const stuck = seen.length;
    for (const kind of ["brain", "capture", "voice", "avatar", "email"] as const) {
      expect(() =>
        callProvider(kind, "http://example.invalid/hook", () => {
          seen.push("non-loopback-ran");
        }),
      ).toThrow(MeetingDenied);
      expect(() =>
        callProvider(kind, "https://example.invalid/hook", () => {
          seen.push("non-loopback-ran");
        }),
      ).toThrow(MeetingDenied);
      expect(() =>
        callProvider(kind, "not a url", () => {
          seen.push("bad-url-ran");
        }),
      ).toThrow(MeetingDenied);
      expect(() =>
        callProvider(kind, "ftp://127.0.0.1:9/fake", () => {
          seen.push("scheme-ran");
        }),
      ).toThrow(MeetingDenied);
    }
    expect(() =>
      callProvider("brain", {} as unknown as { inProcess: true }, () => {
        seen.push("bad-target-ran");
      }),
    ).toThrow(MeetingDenied);
    expect(seen.length).toBe(stuck);
  });
});