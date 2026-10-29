import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createMeetingRoomService } from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };

type FloodOpts = {
  env?: Record<string, string | undefined>;
  maxStores?: number;
  maxPagesPerKey?: number;
  idleMs?: number;
  now?: () => number;
};

function serviceWith(opts: FloodOpts): ReturnType<typeof createMeetingRoomService> {
  return createMeetingRoomService(
    opts as unknown as Parameters<typeof createMeetingRoomService>[0],
  );
}

type BusyModule = {
  MeetingRoomBusyError?: new () => Error;
};

async function loadBusyError(): Promise<new () => Error> {
  const mod = (await import("../src/meetingRoom.js")) as unknown as BusyModule;
  expect(
    typeof mod.MeetingRoomBusyError,
    "MeetingRoomBusyError must be exported",
  ).toBe("function");
  return mod.MeetingRoomBusyError as new () => Error;
}

describe("meeting room flood isolation", () => {
  it("MR-F1 opening pages under 250 new store keys does not evict an active user's room", async () => {
    const MeetingRoomBusyError = await loadBusyError();
    const svc = createMeetingRoomService({ env: {} });
    const keyA = randomUUID();
    const pageA = svc.open("", HEADERS, keyA);
    expect(
      (await svc.act({ roomId: pageA.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
    let busy = 0;
    for (let i = 0; i < 250; i += 1) {
      try {
        svc.open("", HEADERS, randomUUID());
      } catch (err) {
        expect(err instanceof MeetingRoomBusyError, "unexpected open() error").toBe(
          true,
        );
        busy += 1;
      }
    }
    expect(busy, "at least one flood open must have thrown MeetingRoomBusyError")
      .toBeGreaterThan(0);
    expect(
      (await svc.act({ roomId: pageA.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
    const reopened = svc.open("", HEADERS, keyA);
    expect(reopened.restored).toBe(true);
  });

  it("MR-F2 one key opening 500 pages evicts only its own oldest pages", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const keyA = randomUUID();
    const keyB = randomUUID();
    const pageA = svc.open("", HEADERS, keyA);
    const firstB = svc.open("", HEADERS, keyB);
    let lastB = firstB;
    for (let i = 1; i < 500; i += 1) {
      lastB = svc.open("", HEADERS, keyB);
    }
    expect(
      (await svc.act({ roomId: pageA.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
    expect(
      (await svc.act({ roomId: firstB.roomId, action: "state" }, HEADERS)).status,
    ).toBe(404);
    expect(
      (await svc.act({ roomId: lastB.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
  });

  it("MR-F3 an idle store key is evicted to admit a new key", async () => {
    let t = 1_000_000;
    const svc = serviceWith({ env: {}, maxStores: 2, idleMs: 1000, now: () => t });
    const keyA = randomUUID();
    const keyB = randomUUID();
    const keyC = randomUUID();
    const pageA = svc.open("", HEADERS, keyA);
    const pageB = svc.open("", HEADERS, keyB);
    t += 1500;
    expect(
      (await svc.act({ roomId: pageB.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
    const pageC = svc.open("", HEADERS, keyC);
    expect(pageC.roomId).toBeTruthy();
    expect(
      (await svc.act({ roomId: pageA.roomId, action: "state" }, HEADERS)).status,
    ).toBe(404);
    expect(
      (await svc.act({ roomId: pageB.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
  });

  it("MR-F4 with no idle key a new key is refused and nothing is evicted", async () => {
    const MeetingRoomBusyError = await loadBusyError();
    let t = 2_000_000;
    const svc = serviceWith({ env: {}, maxStores: 2, now: () => t });
    const keyA = randomUUID();
    const keyB = randomUUID();
    const keyC = randomUUID();
    const pageA = svc.open("", HEADERS, keyA);
    const pageB = svc.open("", HEADERS, keyB);
    try {
      svc.open("", HEADERS, keyC);
      expect.unreachable("open() for a new key must throw when no key is idle");
    } catch (err) {
      expect(err).toBeInstanceOf(MeetingRoomBusyError);
      expect((err as Error).message).toBe(
        "Meeting room is busy. Try again later.",
      );
    }
    expect(
      (await svc.act({ roomId: pageA.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
    expect(
      (await svc.act({ roomId: pageB.roomId, action: "state" }, HEADERS)).status,
    ).toBe(200);
  });

  it("MR-F5 server answers 503 without a cookie when the meeting room is busy", async () => {
    const serverPath = new URL("../src/server.ts", import.meta.url);
    const text = readFileSync(serverPath, "utf8");
    const condIdx = text.indexOf("MEETING_ROOM_PATH ||");
    expect(condIdx, "GET /meeting-room handler must exist").toBeGreaterThan(-1);
    const nextHandler = text.indexOf('url.pathname === "/gate"', condIdx);
    const handler = text.slice(
      condIdx,
      nextHandler === -1 ? condIdx + 4000 : nextHandler,
    );
    expect(handler, "GET /meeting-room must reference MeetingRoomBusyError").toContain(
      "MeetingRoomBusyError",
    );
    expect(handler, "GET /meeting-room must answer 503 when busy").toContain("503");
    expect(handler, "GET /meeting-room must send the busy message").toContain(
      "Meeting room is busy. Try again later.",
    );
  });
});
