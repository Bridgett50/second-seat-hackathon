// Written fresh in the event repo on Oct 29, 2026 by Muse Code; behavior
// follows holo PR #6 (8499e74); no holo code copied.
//
// Socket-free meeting room service (no HTML in this session). One in-memory
// room store per store key (one per browser via cookie) so a reopened room
// restores its own state without leaking into other browsers; a fake
// transport that only records bodies (no network ever); and a per-request
// fake-send gate (exact "1" test mode plus a loopback host).

import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import {
  DEMO_STEPS,
  SEND_DISABLED_REASON,
  createDemoController,
  createInMemoryRoomStore,
  createTwinRoom,
  demoStepAnnouncement,
  diffAnnouncements,
  fakeSendAllowed,
  isDemoMode,
  type DemoController,
  type RoomStore,
  type TwinRoom,
  type TwinRoomView,
} from "@second-seat/bot/dist/src/t2-room.js";

export const MEETING_ROOM_PATH = "/meeting-room";
export const MEETING_ROOM_API = "/api/meeting-room";
export const MEETING_ROOM_POST_FIELDS = ["roomId", "action", "text", "id"] as const;

/** Cookie carrying one browser's meeting-room store key. */
export const MEETING_ROOM_COOKIE = "mr_store";

const STORE_KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the meeting-room store key from a Cookie header. Returns the
 * `mr_store` value only when it is a UUID, else null (absent, malformed,
 * or duplicated-then-joined headers included).
 */
export function meetingRoomStoreKey(
  cookieHeader: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : (cookieHeader ?? "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== MEETING_ROOM_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return STORE_KEY_RE.test(value) ? value : null;
  }
  return null;
}

/**
 * Server-side fake-send gate for one request. OFF BY DEFAULT: without exactly
 * `SECOND_SEAT_TEST_MODE=1` and a loopback Host (plus a loopback
 * X-Forwarded-Host when present) this is false. A duplicated header (array)
 * is always refused.
 */
export function meetingRoomFakeSendAllowed(
  env: Readonly<Record<string, string | undefined>>,
  headers: IncomingHttpHeaders,
): boolean {
  const host = headers.host;
  const forwardedHost = headers["x-forwarded-host"] ?? null;
  if (Array.isArray(host) || Array.isArray(forwardedHost)) return false;
  return fakeSendAllowed({
    testModeEnv: env.SECOND_SEAT_TEST_MODE,
    host,
    forwardedHost,
  });
}

export type MeetingRoomSnapshot = {
  readonly roomId: string;
  readonly demo: null | {
    readonly stepLabel: string | null;
    readonly completed: number;
    readonly total: number;
    readonly done: boolean;
    readonly caption: string | null;
  };
  readonly fakeSend: boolean;
  readonly restored: boolean;
  readonly view: TwinRoomView;
  readonly approvalNote: string | null;
  readonly copyText: string | null;
  readonly mailtoHref: string | null;
};

export type MeetingRoomActionResult = {
  readonly snapshot: MeetingRoomSnapshot | null;
  readonly announcements: string[];
  readonly evidenceJson?: string;
  readonly comparison?: unknown;
};

export type MeetingRoomService = {
  open(search: string, headers: IncomingHttpHeaders, storeKey?: string): MeetingRoomSnapshot;
  act(
    body: Readonly<Record<string, unknown>>,
    headers: IncomingHttpHeaders,
  ): Promise<{ status: number; body: MeetingRoomActionResult }>;
  sentBodies(): readonly string[];
};

type RoomEntry = {
  readonly room: TwinRoom;
  readonly demo: DemoController | null;
  readonly testMode: boolean;
};

/**
 * Create a meeting room service. `env` defaults to `process.env` and is read
 * at each call (never cached), so flipping `SECOND_SEAT_TEST_MODE` later
 * changes later gates. Rooms live in a Map capped at `maxRooms` (default
 * 200) by evicting the oldest entry.
 */
export function createMeetingRoomService(opts?: {
  env?: Readonly<Record<string, string | undefined>>;
  maxRooms?: number;
}): MeetingRoomService {
  const env = opts?.env ?? process.env;
  const maxRooms = opts?.maxRooms ?? 200;
  const stores = new Map<string, RoomStore>();
  const sent: string[] = [];
  const rooms = new Map<string, RoomEntry>();

  /** Store for one browser key, created on first use (cap 200, evict oldest). */
  function storeFor(storeKey: string): RoomStore {
    const existing = stores.get(storeKey);
    if (existing !== undefined) return existing;
    const created = createInMemoryRoomStore();
    if (stores.size >= 200) {
      const oldest = stores.keys().next();
      if (!oldest.done) stores.delete(oldest.value);
    }
    stores.set(storeKey, created);
    return created;
  }

  function snap(roomId: string, entry: RoomEntry, view: TwinRoomView): MeetingRoomSnapshot {
    const current = entry.demo?.current() ?? null;
    return {
      roomId,
      demo:
        entry.demo === null
          ? null
          : {
              stepLabel: current?.label ?? null,
              completed: entry.demo.completed(),
              total: DEMO_STEPS.length,
              done: current === null,
              caption: current?.caption ?? null,
            },
      fakeSend: entry.testMode,
      restored: entry.room.restoredFromStore(),
      view,
      approvalNote: entry.room.approvalNote(),
      copyText: entry.room.copyText(),
      mailtoHref: entry.room.mailtoHref(),
    };
  }

  function notFound(): { status: number; body: MeetingRoomActionResult } {
    return {
      status: 404,
      body: { snapshot: null, announcements: ["Unknown meeting room."] },
    };
  }

  return {
    open(search: string, headers: IncomingHttpHeaders, storeKey = "default"): MeetingRoomSnapshot {
      const testMode = meetingRoomFakeSendAllowed(env, headers);
      const room = createTwinRoom({
        testMode,
        store: storeFor(storeKey),
        transport: async (body: string): Promise<void> => {
          sent.push(body);
        },
      });
      const demo = isDemoMode(search) ? createDemoController(room) : null;
      const roomId = randomUUID();
      if (rooms.size >= maxRooms) {
        const oldest = rooms.keys().next();
        if (!oldest.done) rooms.delete(oldest.value);
      }
      const entry: RoomEntry = { room, demo, testMode };
      rooms.set(roomId, entry);
      return snap(roomId, entry, room.view());
    },

    async act(
      body: Readonly<Record<string, unknown>>,
      headers: IncomingHttpHeaders,
    ): Promise<{ status: number; body: MeetingRoomActionResult }> {
      const roomId = body["roomId"];
      if (typeof roomId !== "string") return notFound();
      const entry = rooms.get(roomId);
      if (entry === undefined) return notFound();
      const bad = (
        message: string,
      ): { status: number; body: MeetingRoomActionResult } => ({
        status: 400,
        body: {
          snapshot: snap(roomId, entry, entry.room.view()),
          announcements: [message],
        },
      });
      const action = body["action"];
      if (typeof action !== "string") return bad("Unknown meeting room action.");
      if (action === "send") {
        // Re-check the gate with THIS request's headers and the current env;
        // a room opened in test mode still refuses a public Host here.
        if (!meetingRoomFakeSendAllowed(env, headers) || !entry.testMode) {
          return {
            status: 403,
            body: {
              snapshot: snap(roomId, entry, entry.room.view()),
              announcements: [SEND_DISABLED_REASON],
            },
          };
        }
        const before = entry.room.view();
        const outcome = await entry.room.send();
        const after = entry.room.view();
        return {
          status: 200,
          body: {
            snapshot: snap(roomId, entry, after),
            announcements: diffAnnouncements(before, after, {
              sendReason: outcome.reason,
            }),
          },
        };
      }
      const id = body["id"];
      const text = body["text"];
      if (
        (action === "select-meeting" ||
          action === "plugin-include" ||
          action === "plugin-exclude" ||
          action === "plugin-refresh") &&
        typeof id !== "string"
      ) {
        return bad(`Action ${action} needs a string id.`);
      }
      if (
        (action === "guide" || action === "edit-draft" || action === "compare") &&
        typeof text !== "string"
      ) {
        return bad(`Action ${action} needs string text.`);
      }
      const before = entry.room.view();
      switch (action) {
        case "state":
          break;
        case "select-meeting": {
          try {
            entry.room.selectMeeting(id as string);
          } catch {
            return {
              status: 404,
              body: {
                snapshot: snap(roomId, entry, entry.room.view()),
                announcements: ["Unknown meeting."],
              },
            };
          }
          break;
        }
        case "stream-next":
          entry.room.streamNextLine();
          break;
        case "guide":
          entry.room.guide(text as string);
          break;
        case "takeover":
          entry.room.takeOver();
          break;
        case "edit-draft":
          entry.room.editDraft(text as string);
          break;
        case "approve":
          entry.room.approve();
          break;
        case "run-plugins":
          entry.room.runPlugins();
          break;
        case "plugin-include":
          entry.room.approvePluginOutput(id as string);
          break;
        case "plugin-exclude":
          entry.room.rejectPluginOutput(id as string);
          break;
        case "plugin-refresh":
          entry.room.refreshPluginOutput(id as string);
          break;
        case "compare":
          break;
        case "evidence-export":
          break;
        case "demo-next": {
          if (entry.demo === null) return bad("Demo is not enabled for this room.");
          if (
            entry.demo.current()?.id === "demo-send" &&
            (!meetingRoomFakeSendAllowed(env, headers) || !entry.testMode)
          ) {
            return {
              status: 403,
              body: {
                snapshot: snap(roomId, entry, entry.room.view()),
                announcements: [SEND_DISABLED_REASON],
              },
            };
          }
          const step = await entry.demo.next();
          const after = entry.room.view();
          const announcements = diffAnnouncements(before, after);
          if (step !== null) {
            announcements.push(
              demoStepAnnouncement({ label: step.label, caption: step.caption }),
            );
          }
          return {
            status: 200,
            body: { snapshot: snap(roomId, entry, after), announcements },
          };
        }
        case "demo-restart": {
          if (entry.demo === null) return bad("Demo is not enabled for this room.");
          entry.demo.reset();
          break;
        }
        default:
          return bad("Unknown meeting room action.");
      }
      const after = entry.room.view();
      const result: {
        snapshot: MeetingRoomSnapshot;
        announcements: string[];
        evidenceJson?: string;
        comparison?: unknown;
      } = {
        snapshot: snap(roomId, entry, after),
        announcements: diffAnnouncements(before, after),
      };
      if (action === "compare") result.comparison = entry.room.compareImported(text as string);
      if (action === "evidence-export") {
        const json = entry.room.exportEvidenceJson();
        if (json !== null) result.evidenceJson = json;
      }
      return { status: 200, body: result };
    },

    sentBodies(): readonly string[] {
      return [...sent];
    },
  };
}
