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
export const MEETING_ROOM_POST_FIELDS = ["roomId", "action", "text", "id", "packageId"] as const;

/** Largest accepted `packageId` for Approve and Send, in characters. */
export const MEETING_ROOM_MAX_PACKAGE_ID_CHARS = 400;

/**
 * Server-derived identity of the outgoing package the page displays: the
 * selected meeting plus the sha256 of the complete composed package body.
 * Approve and Send must echo it back; any other value is refused.
 */
export function meetingRoomPackageId(view: TwinRoomView): string {
  return `${view.selectedMeetingId}:${view.draft.sha256}`;
}

/** Announcement when Approve or Send arrives without a valid package identity. */
export const PACKAGE_ID_MISSING_REASON =
  "Approve and Send need the package you reviewed. Reload the room and review it.";

/** Announcement when Approve or Send names a package that is no longer current. */
export const PACKAGE_ID_STALE_REASON =
  "The package changed since you reviewed it. Review the current package, then approve again.";

/** Demo note when the guided Send step is not attempted (sending unavailable). */
export const DEMO_SEND_NOT_SENT =
  "Step 6 not sent: sending is unavailable on this public demo, so nothing was sent and there is no send receipt. The guide continues with the approved, unsent package.";

/** Largest accepted `text` for the "guide" action, in characters. */
export const MEETING_ROOM_MAX_GUIDANCE_CHARS = 2_000;

/** Largest accepted `text` for the "edit-draft" action, in characters. */
export const MEETING_ROOM_MAX_DRAFT_CHARS = 20_000;

/** Largest accepted `text` for the "compare" action, in characters. */
export const MEETING_ROOM_MAX_COMPARE_CHARS = 20_000;

/** Largest number of guidance entries recorded per meeting. */
export const MEETING_ROOM_MAX_GUIDANCE_ENTRIES = 50;

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

// Actions that change room state; only a successful one marks a store key
// as acted. GET open, state, evidence-export, compare and refused actions
// do not, so cheap reads cannot shield a flood of keys from eviction.
const ACTING_ACTIONS = new Set([
  "stream-next",
  "guide",
  "select-meeting",
  "edit-draft",
  "approve",
  "takeover",
  "run-plugins",
  "plugin-include",
  "plugin-exclude",
  "plugin-refresh",
  "send",
  "demo-next",
  "demo-restart",
]);

const COOKIE_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function cookieHostIsLoopback(value: string | undefined): boolean {
  if (value === undefined) return false;
  const name = value.trim().toLowerCase().replace(/:\d+$/, "");
  return COOKIE_LOOPBACK_HOSTS.has(name);
}

/**
 * Set-Cookie value for the meeting room store key. Adds `Secure` unless the
 * request is plain http on a loopback Host (local dev and the loopback test
 * server, where browsers would drop a Secure cookie). Duplicated headers,
 * a non-loopback Host or X-Forwarded-Host, or X-Forwarded-Proto https all
 * get `Secure`.
 */
export function meetingRoomSetCookie(key: string, headers: IncomingHttpHeaders): string {
  const base = `${MEETING_ROOM_COOKIE}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
  const host = headers.host;
  const fwdHost = headers["x-forwarded-host"];
  const fwdProto = headers["x-forwarded-proto"];
  if (Array.isArray(host) || Array.isArray(fwdHost) || Array.isArray(fwdProto)) return `${base}; Secure`;
  if (typeof fwdProto === "string" && fwdProto.split(",")[0]?.trim().toLowerCase() !== "http") return `${base}; Secure`;
  if (fwdHost !== undefined && !cookieHostIsLoopback(fwdHost)) return `${base}; Secure`;
  return cookieHostIsLoopback(host) ? base : `${base}; Secure`;
}

export type MeetingRoomSnapshot = {
  readonly roomId: string;
  readonly demo: null | {
    readonly stepLabel: string | null;
    readonly completed: number;
    readonly total: number;
    readonly done: boolean;
    readonly caption: string | null;
    /** Set when the guided Send step was not attempted; null otherwise. */
    readonly sendNote: string | null;
  };
  readonly fakeSend: boolean;
  readonly restored: boolean;
  readonly view: TwinRoomView;
  readonly approvalNote: string | null;
  readonly copyText: string | null;
  readonly mailtoHref: string | null;
  /** Identity of the displayed outgoing package (see meetingRoomPackageId). */
  readonly packageId: string;
  /** Visible notice for a refused Send; null otherwise. */
  readonly sendNotice: string | null;
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
  /**
   * act() bound to a browser: answers 404 with no snapshot, before reading
   * or changing anything, unless `callerKey` (the store key from this
   * request's own mr_store cookie) is the key that opened the room.
   */
  actAs(
    callerKey: string | null,
    body: Readonly<Record<string, unknown>>,
    headers: IncomingHttpHeaders,
  ): Promise<{ status: number; body: MeetingRoomActionResult }>;
  sentBodies(): readonly string[];
  /** Test-visible counts: pages, stores, activity entries and demo pages held. */
  sizes(): { pages: number; stores: number; activity: number; demoPages: number };
};

/** Thrown by open() when no idle store key can be evicted to admit a new one. */
export class MeetingRoomBusyError extends Error {
  constructor() {
    super("Meeting room is busy. Try again later.");
    this.name = "MeetingRoomBusyError";
  }
}

type RoomEntry = {
  readonly room: TwinRoom;
  readonly demo: DemoController | null;
  readonly testMode: boolean;
  readonly reused: boolean;
  readonly storeKey: string;
};

/**
 * Create a meeting room service. `env` defaults to `process.env` and is read
 * at each call (never cached), so flipping `SECOND_SEAT_TEST_MODE` later
 * changes later gates. Stores are capped at `maxStores` (default 200): when
 * open() needs a new store key, a key that never acted (open only) is evicted first, least
 * recently opened, else the least-recently-active key idle for at least `idleMs` (default 30
 * minutes), with its shared rooms and pages; only when every key acted within `idleMs` is a
 * `MeetingRoomBusyError` thrown and nothing evicted. Pages are capped at `maxPagesPerKey`
 * (default 20) per store
 * key by evicting only that key's own oldest page, so one browser flooding
 * the page can never evict another browser's rooms. Demo (?demo=1) pages are
 * capped at `maxDemoPages` (default 200) globally by evicting the oldest demo
 * page, never count against a key's page cap, and record no activity.
 */
export function createMeetingRoomService(opts?: {
  env?: Readonly<Record<string, string | undefined>>;
  maxStores?: number;
  maxPagesPerKey?: number;
  maxDemoPages?: number;
  idleMs?: number;
  now?: () => number;
}): MeetingRoomService {
  const env = opts?.env ?? process.env;
  const maxStores = opts?.maxStores ?? 200;
  const maxPagesPerKey = opts?.maxPagesPerKey ?? 20;
  const maxDemoPages = opts?.maxDemoPages ?? 200;
  const idleMs = opts?.idleMs ?? 30 * 60_000;
  const now = opts?.now ?? Date.now;
  const stores = new Map<string, RoomStore>();
  const sent: string[] = [];
  const rooms = new Map<string, RoomEntry>();
  // Last activity per store key, set on open() and on every act() for a
  // page of that key. Drives idle eviction of whole store keys.
  const lastActive = new Map<string, number>();
  // Store keys that have acted (any act() on one of their pages). Keys that
  // only ever opened a page are evicted first, so a flood of plain GETs can
  // never lock new visitors out.
  const acted = new Set<string>();
  // Demo (?demo=1) page roomIds in open order, capped at maxDemoPages
  // globally; the oldest demo page is evicted first.
  const demoPages = new Set<string>();
  // One shared twin room per store key and test-mode flag (the flag is
  // fixed at creation). Two tabs with the same cookie share one room so a
  // send in one tab is visible in the other and cannot go out twice.
  const shared = new Map<string, TwinRoom>();
  const transport = async (body: string): Promise<void> => {
    sent.push(body);
  };

  /** Store for one browser key, created on first use (no eviction here). */
  function storeFor(storeKey: string): RoomStore {
    const existing = stores.get(storeKey);
    if (existing !== undefined) return existing;
    const created = createInMemoryRoomStore();
    stores.set(storeKey, created);
    return created;
  }

  /**
   * Drop a whole store key: its store, both shared rooms (`${key}:t` and
   * `${key}:p`), all its pages, and its activity record.
   */
  function evictStoreKey(storeKey: string): void {
    stores.delete(storeKey);
    shared.delete(`${storeKey}:t`);
    shared.delete(`${storeKey}:p`);
    for (const [roomId, entry] of rooms) {
      if (entry.storeKey === storeKey) {
        rooms.delete(roomId);
        demoPages.delete(roomId);
      }
    }
    lastActive.delete(storeKey);
    acted.delete(storeKey);
  }

  /**
   * The store key to evict for a new key, or null when every key has acted
   * within `idleMs`. Never-acted (open-only) keys go first, least recently
   * opened; then acted keys idle for at least `idleMs`, least recently active.
   */
  function pickVictim(at: number): string | null {
    let openOnly: string | null = null;
    let openOnlyAt = Infinity;
    let idle: string | null = null;
    let idleAt = Infinity;
    for (const key of stores.keys()) {
      const active = lastActive.get(key) ?? Number.NEGATIVE_INFINITY;
      if (!acted.has(key)) {
        if (active < openOnlyAt) {
          openOnly = key;
          openOnlyAt = active;
        }
      } else if (at - active >= idleMs && active < idleAt) {
        idle = key;
        idleAt = active;
      }
    }
    return openOnly ?? idle;
  }

  function snap(roomId: string, entry: RoomEntry, view: TwinRoomView, sendNotice: string | null = null): MeetingRoomSnapshot {
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
              sendNote:
                (entry.demo.result("demo-send") as { skipped?: boolean } | undefined)?.skipped === true
                  ? DEMO_SEND_NOT_SENT
                  : null,
            },
      fakeSend: entry.testMode,
      restored: entry.reused || entry.room.restoredFromStore(),
      view,
      approvalNote: entry.room.approvalNote(),
      copyText: entry.room.copyText(),
      mailtoHref: entry.room.mailtoHref(),
      packageId: meetingRoomPackageId(view),
      sendNotice,
    };
  }

  function notFound(): { status: number; body: MeetingRoomActionResult } {
    return {
      status: 404,
      body: { snapshot: null, announcements: ["This room expired. Reload to start again."] },
    };
  }

  const service: MeetingRoomService = {
    open(search: string, headers: IncomingHttpHeaders, storeKey = "default"): MeetingRoomSnapshot {
      const testMode = meetingRoomFakeSendAllowed(env, headers);
      // A new store key past the cap evicts an open-only key first, else a
      // key idle for idleMs; only when every key acted recently is the page
      // refused, so neither a GET flood nor one browser can push others out.
      // A ?demo=1 page always gets its own fresh, unshared room and store;
      // it uses no store slot and records no activity for its key.
      const demoMode = isDemoMode(search);
      if (!demoMode && !stores.has(storeKey) && stores.size >= maxStores) {
        const victim = pickVictim(now());
        if (victim === null) throw new MeetingRoomBusyError();
        evictStoreKey(victim);
      }
      if (!demoMode) lastActive.set(storeKey, now());
      const sharedKey = `${storeKey}:${testMode ? "t" : "p"}`;
      const existingRoom = demoMode ? undefined : shared.get(sharedKey);
      const reused = existingRoom !== undefined;
      const room =
        existingRoom ??
        (() => {
          const created = createTwinRoom({
            testMode,
            store: demoMode ? createInMemoryRoomStore() : storeFor(storeKey),
            transport,
          });
          if (!demoMode) shared.set(sharedKey, created);
          return created;
        })();
      // The demo controller and roomId stay per page (per open() call).
      const demo = demoMode ? createDemoController(room) : null;
      const roomId = randomUUID();
      if (demoMode) {
        // Cap demo pages globally, evicting only the oldest demo page.
        if (demoPages.size >= maxDemoPages) {
          const oldestDemo = demoPages.values().next().value;
          if (oldestDemo !== undefined) {
            demoPages.delete(oldestDemo);
            rooms.delete(oldestDemo);
          }
        }
      } else {
        // Cap real pages per store key, evicting only this key's own oldest
        // real page; demo pages never count against the key.
        let pages = 0;
        let oldestOfKey: string | null = null;
        for (const [id, entry] of rooms) {
          if (entry.storeKey === storeKey && entry.demo === null) {
            pages += 1;
            if (oldestOfKey === null) oldestOfKey = id;
          }
        }
        if (pages >= maxPagesPerKey && oldestOfKey !== null) {
          rooms.delete(oldestOfKey);
        }
      }
      const entry: RoomEntry = { room, demo, testMode, reused, storeKey };
      rooms.set(roomId, entry);
      if (demoMode) demoPages.add(roomId);
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
      // Demo pages record no activity (their key may have no store).
      if (entry.demo === null) lastActive.set(entry.storeKey, now());
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
              snapshot: snap(roomId, entry, entry.room.view(), SEND_DISABLED_REASON),
              announcements: [SEND_DISABLED_REASON],
            },
          };
        }
        const before = entry.room.view();
        const outcome = await entry.room.send();
        const after = entry.room.view();
        const notice = outcome.ok ? null : (outcome.reason || "Send was refused.");
        if (entry.demo === null) acted.add(entry.storeKey);
        return {
          status: 200,
          body: {
            snapshot: snap(roomId, entry, after, notice),
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
      // Input caps: refuse over-limit text (or a full guidance log) before
      // calling any room method. Only `text.length` is checked; over-limit
      // text is never scanned or redacted. The room is left unchanged.
      const overLimit = (
        message: string,
      ): { status: number; body: MeetingRoomActionResult } => ({
        status: 413,
        body: {
          snapshot: snap(roomId, entry, entry.room.view()),
          announcements: [message],
        },
      });
      if (
        action === "guide" &&
        (text as string).length > MEETING_ROOM_MAX_GUIDANCE_CHARS
      ) {
        return overLimit("Guidance is limited to 2,000 characters.");
      }
      if (
        action === "edit-draft" &&
        (text as string).length > MEETING_ROOM_MAX_DRAFT_CHARS
      ) {
        return overLimit("Draft edits are limited to 20,000 characters.");
      }
      if (
        action === "compare" &&
        (text as string).length > MEETING_ROOM_MAX_COMPARE_CHARS
      ) {
        return overLimit("Compared text is limited to 20,000 characters.");
      }
      if (
        action === "guide" &&
        entry.room.view().guidance.length >= MEETING_ROOM_MAX_GUIDANCE_ENTRIES
      ) {
        return {
          status: 400,
          body: {
            snapshot: snap(roomId, entry, entry.room.view()),
            announcements: ["At most 50 guidance entries per meeting."],
          },
        };
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
      if (entry.demo === null && ACTING_ACTIONS.has(action)) acted.add(entry.storeKey);
      return { status: 200, body: result };
    },

    async actAs(
      callerKey: string | null,
      body: Readonly<Record<string, unknown>>,
      headers: IncomingHttpHeaders,
    ): Promise<{ status: number; body: MeetingRoomActionResult }> {
      const roomId = body["roomId"];
      const entry = typeof roomId === "string" ? rooms.get(roomId) : undefined;
      if (callerKey === null || entry === undefined || entry.storeKey !== callerKey) {
        return notFound();
      }
      const action = body["action"];
      if (action === "approve" || action === "send") {
        // Bind Approve and Send to the package this browser displayed. No
        // await runs between this check and the room action in act().
        const packageId = body["packageId"];
        const view = entry.room.view();
        if (
          typeof packageId !== "string" ||
          packageId.length > MEETING_ROOM_MAX_PACKAGE_ID_CHARS ||
          !/:[0-9a-f]{64}$/.test(packageId)
        ) {
          return {
            status: 400,
            body: {
              snapshot: snap(roomId as string, entry, view),
              announcements: [PACKAGE_ID_MISSING_REASON],
            },
          };
        }
        if (packageId !== meetingRoomPackageId(view)) {
          return {
            status: 409,
            body: {
              snapshot: snap(roomId as string, entry, view),
              announcements: [PACKAGE_ID_STALE_REASON],
            },
          };
        }
      }
      return service.act(body, headers);
    },

    sentBodies(): readonly string[] {
      return [...sent];
    },

    sizes(): { pages: number; stores: number; activity: number; demoPages: number } {
      return {
        pages: rooms.size,
        stores: stores.size,
        activity: lastActive.size,
        demoPages: demoPages.size,
      };
    },
  };
  return service;
}
