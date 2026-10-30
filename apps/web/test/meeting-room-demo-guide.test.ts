import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { IncomingHttpHeaders, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";
// --- end of F140-4 test part 1 ---

// F140-4: the guided demo never stalls at Send when sending is unavailable,
// and Restart gives a fresh demo room. Synthetic text, fake transport,
// private loopback server, awaited responses as barriers (no sleeps).
const LOOPBACK: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const PUBLIC: IncomingHttpHeaders = { host: "second-seat.example.com", "x-forwarded-host": "second-seat.example.com" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const API = "/api/meeting-room";
// --- end of F140-4 test part 2 ---

type Snap = {
  roomId: string;
  demo: { completed: number; total: number; done: boolean; sendNote?: string | null } | null;
  view: { transcript: string[]; twinStatus: string; draft: { body: string; approved: boolean; sendState: string } };
};

async function step(svc: MeetingRoomService, roomId: string, action: string, headers: IncomingHttpHeaders) {
  const res = await svc.act({ roomId, action }, headers);
  return { status: res.status, snap: res.body.snapshot as unknown as Snap, notes: res.body.announcements };
}
// --- end of F140-4 test part 3 ---

/** Click Next until the guide reports done; returns every HTTP status. */
async function runGuide(svc: MeetingRoomService, roomId: string, headers: IncomingHttpHeaders) {
  const statuses: number[] = [];
  const notes: string[] = [];
  let last: Snap | null = null;
  for (let i = 0; i < 12; i += 1) {
    const r = await step(svc, roomId, "demo-next", headers);
    statuses.push(r.status);
    notes.push(...r.notes);
    last = r.snap;
    if (r.status !== 200 || r.snap.demo?.done === true) break;
  }
  return { statuses, notes, last };
}
// --- end of F140-4 test part 4 ---
