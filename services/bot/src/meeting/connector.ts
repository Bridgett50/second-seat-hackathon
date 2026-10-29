/**
 * Owner-scoped meeting connector. Protocol meeting-connector/1.
 * Production provider dispatch stays disabled. Tests inject principals;
 * there is no public owner-id header.
 *
 * Jobs are authoritative server-issued records: `issueJob` binds a trusted
 * owner, meeting, session, source revision and authority generation under a
 * server-generated jobId. `resolveCallback` and `replay` honor only an
 * envelope that matches a pending issued job AND current state. Caller-built
 * callbacks without an issued jobId are rejected, never trusted. Source
 * edits, revocation, deletion, expiry and session suspension invalidate
 * dependent pending jobs immediately. Replay of one dispatch intent invokes
 * the transport at most once; distinct jobs are independent (no global
 * exactly-once claim).
 */
export const MEETING_CONNECTOR_PROTOCOL = "meeting-connector/1" as const;

export class MeetingDenied extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`denied: ${operation}`);
    this.name = "MeetingDenied";
    this.operation = operation;
  }
}

export type OwnerPrincipal = { readonly ownerId: string };

export type MeetingAction =
  | { type: "read" }
  | { type: "edit"; text: string }
  | { type: "approve" }
  | { type: "export" }
  | { type: "delete" };

type Meeting = {
  id: string;
  ownerId: string;
  text: string;
  authorityGeneration: number;
  sourceRevision: number;
  revoked: boolean;
  expiresAt: number | null;
  approvedRevision: number | null;
};

type Session = {
  ownerId: string;
  generationId: string;
  suspended: boolean;
  inbox: string[];
  boundMeetingId: string | null;
};

export type IssuedJob = {
  readonly jobId: string;
  readonly ownerId: string;
  readonly meetingId: string;
  readonly generationId: string;
  readonly authorityGeneration: number;
  readonly sourceRevision: number;
};

export type StoredCallback = {
  readonly jobId?: string;
  readonly ownerId: string;
  readonly meetingId: string;
  readonly generationId: string;
  readonly authorityGeneration: number;
  readonly sourceRevision?: number;
  readonly artifact: string;
};

export type ProviderKind = "brain" | "capture" | "voice" | "avatar" | "email";

type JobStatus = "pending" | "consumed" | "invalidated";

type JobRecord = {
  jobId: string;
  ownerId: string;
  meetingId: string;
  generationId: string;
  authorityGeneration: number;
  sourceRevision: number;
  status: JobStatus;
  dispatched: boolean;
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function bareHost(host: string): string {
  return host.startsWith("[") && host.endsWith("]") && host.length > 2 ? host.slice(1, -1) : host;
}

export function createMeetingConnector(opts?: { now?: () => number }) {
  const now = opts?.now ?? (() => Date.now());
  const meetings = new Map<string, Meeting>();
  const sessions = new Map<string, Session>();
  const jobs = new Map<string, JobRecord>();
  let seq = 0;
  let outbound = 0;

  function requirePrincipal(principal: OwnerPrincipal | null | undefined): OwnerPrincipal {
    if (!principal || typeof principal.ownerId !== "string" || principal.ownerId.length === 0) {
      throw new MeetingDenied("missing-identity");
    }
    return principal;
  }

  function owned(principal: OwnerPrincipal, meetingId: string, operation: string): Meeting {
    const meeting = meetings.get(meetingId);
    if (!meeting || meeting.ownerId !== principal.ownerId) {
      throw new MeetingDenied(operation);
    }
    return meeting;
  }

  function ownedSession(principal: OwnerPrincipal, generationId: string, operation: string): Session {
    const session = sessions.get(generationId);
    if (!session || session.ownerId !== principal.ownerId) {
      throw new MeetingDenied(operation);
    }
    return session;
  }

  function policyOpen(meeting: Meeting): boolean {
    if (meeting.revoked) return false;
    if (meeting.expiresAt !== null && now() >= meeting.expiresAt) return false;
    return true;
  }

  function invalidateMeetingJobs(meetingId: string): void {
    for (const job of jobs.values()) {
      if (job.meetingId === meetingId && job.status === "pending") {
        job.status = "invalidated";
      }
    }
  }

  function invalidateSessionJobs(generationId: string): void {
    for (const job of jobs.values()) {
      if (job.generationId === generationId && job.status === "pending") {
        job.status = "invalidated";
      }
    }
  }

  function bindSession(session: Session, meetingId: string, operation: string): void {
    if (session.boundMeetingId === null) {
      session.boundMeetingId = meetingId;
    } else if (session.boundMeetingId !== meetingId) {
      throw new MeetingDenied(operation);
    }
  }

  function envelopeMatches(callback: StoredCallback, record: JobRecord): boolean {
    return (
      callback.jobId === record.jobId &&
      callback.ownerId === record.ownerId &&
      callback.meetingId === record.meetingId &&
      callback.generationId === record.generationId &&
      callback.authorityGeneration === record.authorityGeneration &&
      callback.sourceRevision === record.sourceRevision
    );
  }

  function currentStateOk(record: JobRecord): boolean {
    const meeting = meetings.get(record.meetingId);
    const session = sessions.get(record.generationId);
    if (!meeting || meeting.ownerId !== record.ownerId || !policyOpen(meeting)) return false;
    if (
      meeting.authorityGeneration !== record.authorityGeneration ||
      meeting.sourceRevision !== record.sourceRevision
    ) {
      return false;
    }
    if (!session || session.ownerId !== record.ownerId || session.suspended) return false;
    if (session.boundMeetingId !== null && session.boundMeetingId !== record.meetingId) return false;
    return true;
  }

  return {
    protocol: MEETING_CONNECTOR_PROTOCOL,
    outboundCount: () => outbound,
    createMeeting(principal: OwnerPrincipal | null, text: string): { meetingId: string } {
      const owner = requirePrincipal(principal);
      seq += 1;
      const id = `m-${seq}`;
      meetings.set(id, {
        id,
        ownerId: owner.ownerId,
        text,
        authorityGeneration: 1,
        sourceRevision: 1,
        revoked: false,
        expiresAt: null,
        approvedRevision: null,
      });
      return { meetingId: id };
    },
    act(
      principal: OwnerPrincipal | null,
      meetingId: string,
      action: MeetingAction,
      claimedOwnerId?: string,
    ): { text?: string } {
      const owner = requirePrincipal(principal);
      if (claimedOwnerId !== undefined && claimedOwnerId !== owner.ownerId) {
        // The client claim is ignored. Authorization stays on the principal.
      }
      const meeting = owned(owner, meetingId, action.type);
      if (action.type === "read" || action.type === "export") {
        if (!policyOpen(meeting)) throw new MeetingDenied(action.type);
        return { text: meeting.text };
      }
      if (action.type === "edit") {
        if (!policyOpen(meeting)) throw new MeetingDenied("edit");
        meeting.text = action.text;
        meeting.sourceRevision += 1;
        meeting.approvedRevision = null;
        invalidateMeetingJobs(meetingId);
        return {};
      }
      if (action.type === "approve") {
        if (!policyOpen(meeting)) throw new MeetingDenied("approve");
        meeting.approvedRevision = meeting.sourceRevision;
        return {};
      }
      invalidateMeetingJobs(meetingId);
      meetings.delete(meetingId);
      return {};
    },
    openSession(principal: OwnerPrincipal | null, meetingId?: string): { generationId: string } {
      const owner = requirePrincipal(principal);
      let boundMeetingId: string | null = null;
      if (meetingId !== undefined) {
        owned(owner, meetingId, "open-session");
        boundMeetingId = meetingId;
      }
      seq += 1;
      const generationId = `g-${seq}`;
      sessions.set(generationId, {
        ownerId: owner.ownerId,
        generationId,
        suspended: false,
        inbox: [],
        boundMeetingId,
      });
      return { generationId };
    },
    issueJob(
      principal: OwnerPrincipal | null,
      meetingId: string,
      generationId: string,
    ): IssuedJob {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "issue");
      if (!policyOpen(meeting)) throw new MeetingDenied("issue");
      const session = ownedSession(owner, generationId, "issue");
      if (session.suspended) throw new MeetingDenied("issue");
      bindSession(session, meetingId, "issue");
      seq += 1;
      const jobId = `j-${seq}`;
      const record: JobRecord = {
        jobId,
        ownerId: owner.ownerId,
        meetingId,
        generationId,
        authorityGeneration: meeting.authorityGeneration,
        sourceRevision: meeting.sourceRevision,
        status: "pending",
        dispatched: false,
      };
      jobs.set(jobId, record);
      return {
        jobId,
        ownerId: owner.ownerId,
        meetingId,
        generationId,
        authorityGeneration: meeting.authorityGeneration,
        sourceRevision: meeting.sourceRevision,
      };
    },
    suspendGeneration(principal: OwnerPrincipal | null, generationId: string): void {
      const owner = requirePrincipal(principal);
      const session = ownedSession(owner, generationId, "suspend");
      session.suspended = true;
      invalidateSessionJobs(generationId);
    },
    inbox(principal: OwnerPrincipal | null, generationId: string): string[] {
      const owner = requirePrincipal(principal);
      const session = sessions.get(generationId);
      if (!session || session.ownerId !== owner.ownerId) return [];
      return [...session.inbox];
    },
    resolveCallback(viewer: OwnerPrincipal | null, callback: StoredCallback): { delivered: boolean } {
      const who = requirePrincipal(viewer);
      const before = outbound;
      const fail = (): { delivered: boolean } => {
        if (outbound !== before) throw new Error("outbound changed on a rejected callback");
        return { delivered: false };
      };
      if (!callback || typeof callback.jobId !== "string") return fail();
      const record = jobs.get(callback.jobId);
      if (!record || record.status !== "pending") return fail();
      if (who.ownerId !== record.ownerId) return fail();
      if (!envelopeMatches(callback, record)) return fail();
      if (!currentStateOk(record)) return fail();
      const session = sessions.get(record.generationId);
      if (!session) return fail();
      session.inbox.push(callback.artifact);
      record.status = "consumed";
      return { delivered: true };
    },
    revoke(principal: OwnerPrincipal | null, meetingId: string): number {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "revoke");
      meeting.authorityGeneration += 1;
      meeting.revoked = true;
      meeting.approvedRevision = null;
      invalidateMeetingJobs(meetingId);
      return meeting.authorityGeneration;
    },
    expire(principal: OwnerPrincipal | null, meetingId: string, at: number): void {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "expire");
      meeting.expiresAt = at;
      meeting.approvedRevision = null;
      invalidateMeetingJobs(meetingId);
    },
    authorityGeneration(principal: OwnerPrincipal | null, meetingId: string): number {
      const owner = requirePrincipal(principal);
      return owned(owner, meetingId, "read").authorityGeneration;
    },
    approved(principal: OwnerPrincipal | null, meetingId: string): boolean {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "read");
      return meeting.approvedRevision === meeting.sourceRevision && policyOpen(meeting);
    },
    replay(callback: StoredCallback, transport: () => void): { ran: boolean } {
      if (!callback || typeof callback.jobId !== "string") return { ran: false };
      const record = jobs.get(callback.jobId);
      if (!record || record.status === "invalidated" || record.dispatched) return { ran: false };
      if (!envelopeMatches(callback, record)) return { ran: false };
      if (!currentStateOk(record)) return { ran: false };
      outbound += 1;
      transport();
      record.dispatched = true;
      return { ran: true };
    },
  };
}

export function callProvider(
  kind: ProviderKind,
  target: string | { inProcess: true },
  transport: (url: string) => void,
): "fake" | "loopback" {
  if (typeof target !== "string") {
    if (!target || (target as { inProcess?: unknown }).inProcess !== true) {
      throw new MeetingDenied(`${kind}-bad-target`);
    }
    transport("in-process");
    return "fake";
  }
  let host = "";
  try {
    const url = new URL(target);
    if (url.protocol !== "http:") {
      throw new MeetingDenied(`${kind}-unsupported-scheme`);
    }
    host = bareHost(url.hostname);
  } catch (err) {
    if (err instanceof MeetingDenied) throw err;
    throw new MeetingDenied(`${kind}-bad-url`);
  }
  if (!LOOPBACK.has(host)) {
    throw new MeetingDenied(`${kind}-non-loopback`);
  }
  transport(target);
  return "loopback";
}

/** Production send stays off until a reviewed policy path exists. */
export function productionDispatch(): never {
  throw new MeetingDenied("production-dispatch-disabled");
}
