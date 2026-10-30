import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";
import { outboundStats } from "../src/netGuard.js";

// F140-5: the import panel tells the truth about where imported text goes.
// Synthetic text only, private loopback server, fake transport, test-mode
// --- end of F140-5 test part 1 ---
// network guard on, awaited responses as barriers (no sleeps).
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const API = "/api/meeting-room";
const MARKER = "SYNTHETIC_COMPARE_MARKER_140";
const ACCURATE = "Compare sends this text to this app's server";
let svc: MeetingRoomService;
let server: Server;
let base = "";
let browser: Browser;
let priorMode: string | undefined;
// --- end of F140-5 test part 2 ---

beforeAll(async () => {
  priorMode = process.env.SECOND_SEAT_TEST_MODE;
  process.env.SECOND_SEAT_TEST_MODE = "1";
  svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
  server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
// --- end of F140-5 test part 3 ---

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (priorMode === undefined) delete process.env.SECOND_SEAT_TEST_MODE;
  else process.env.SECOND_SEAT_TEST_MODE = priorMode;
});

async function openRoom(): Promise<{ page: Page; requests: string[]; blocked: string[] }> {
  const context = await browser.newContext();
// --- end of F140-5 test part 4 ---
