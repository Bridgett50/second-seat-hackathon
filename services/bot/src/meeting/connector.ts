/**
 * Owner-scoped meeting connector. Protocol meeting-connector/1.
 * Production provider dispatch stays disabled. Tests inject principals;
 * there is no public owner-id header.
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
};

export type StoredCallback = {
  ownerId: string;
  meetingId: string;
  generationId: string;
  authorityGeneration: number;
  artifact: string;
};

export type ProviderKind = "brain" | "capture" | "voice" | "avatar" | "email";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function createMeetingConnector(opts?: { now?: () => number }) {
  const now = opts?.now ?? (() => Date.now());
  const meetings = new Map<string, Meeting>();
  const sessions = new Map<string, Session>();
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

  function policyOpen(meeting: Meeting): boolean {
    if (meeting.revoked) return false;
    if (meeting.expiresAt !== null && now() >= meeting.expiresAt) return false;
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
        return {};
      }
      if (action.type === "approve") {
        if (!policyOpen(meeting)) throw new MeetingDenied("approve");
        meeting.approvedRevision = meeting.sourceRevision;
        return {};
      }
      meetings.delete(meetingId);
      return {};
    },
    openSession(principal: OwnerPrincipal | null): { generationId: string } {
      const owner = requirePrincipal(principal);
      seq += 1;
      const generationId = `g-${seq}`;
      sessions.set(generationId, { ownerId: owner.ownerId, generationId, suspended: false, inbox: [] });
      return { generationId };
    },
    suspendGeneration(principal: OwnerPrincipal | null, generationId: string): void {
      const owner = requirePrincipal(principal);
      const session = sessions.get(generationId);
      if (!session || session.ownerId !== owner.ownerId) throw new MeetingDenied("suspend");
      session.suspended = true;
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
      const session = sessions.get(callback.generationId);
      const meeting = meetings.get(callback.meetingId);
      const sameOwner = who.ownerId === callback.ownerId;
      const generationOk = session !== undefined && session.ownerId === callback.ownerId && !session.suspended;
      const authorityOk =
        meeting !== undefined &&
        meeting.ownerId === callback.ownerId &&
        meeting.authorityGeneration === callback.authorityGeneration &&
        policyOpen(meeting);
      if (!sameOwner || !generationOk || !authorityOk) {
        if (outbound !== before) throw new Error("outbound changed on a rejected callback");
        return { delivered: false };
      }
      session.inbox.push(callback.artifact);
      return { delivered: true };
    },
    revoke(principal: OwnerPrincipal | null, meetingId: string): number {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "revoke");
      meeting.authorityGeneration += 1;
      meeting.revoked = true;
      meeting.approvedRevision = null;
      return meeting.authorityGeneration;
    },
    expire(principal: OwnerPrincipal | null, meetingId: string, at: number): void {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "expire");
      meeting.expiresAt = at;
      meeting.approvedRevision = null;
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
      const meeting = meetings.get(callback.meetingId);
      if (
        meeting === undefined ||
        meeting.authorityGeneration !== callback.authorityGeneration ||
        !policyOpen(meeting)
      ) {
        return { ran: false };
      }
      outbound += 1;
      transport();
      return { ran: true };
    },
  };
}

export function callProvider(
  kind: ProviderKind,
  target: string | { inProcess: true },
  transport: (url: string) => void,
): "fake" | "loopback" {
  if (typeof target !== "string") return "fake";
  let host = "";
  try {
    host = new URL(target).hostname;
  } catch {
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
