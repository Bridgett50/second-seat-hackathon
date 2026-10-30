import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";

// F140-3: the package editor edits only the owner-written base; included
// plugin sections stay managed by Include/Exclude. Private loopback server,
// test mode only in the injected service env, synthetic text only, real
// browser clicks, barriers (awaited responses) instead of sleeps.
const OWNER_BASE = "Synthetic owner summary for the review.\nAction items\n- Synthetic owner-written follow-up, not from the plugin.";
// --- end of F140-3 test part 1 ---
const OWNER_ADDENDUM = "\nSynthetic owner addendum after review.";
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const API = "/api/meeting-room";
const PLUGIN = "action-items";

type ActResult = { status: number; json: Record<string, unknown> | null };
type View = {
  draft: { body: string; approved: boolean; sendState: string };
  transcript: string[];
// --- end of F140-3 test part 2 ---
};

let svc: MeetingRoomService;
let server: Server;
let base = "";
let browser: Browser;

beforeAll(async () => {
  svc = createMeetingRoomService({ env: TEST_ENV });
  server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
// --- end of F140-3 test part 3 ---
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

// --- end of F140-3 test part 4 ---
function isApi(url: string): boolean {
  return new URL(url).pathname === API;
}

/** Click a rendered control and wait for its /api/meeting-room response. */
async function clickAndWait(page: Page, selector: string): Promise<ActResult> {
  const pending = page.waitForResponse((r) => isApi(r.url()) && r.request().method() === "POST");
  await page.locator(selector).first().click();
  const res = await pending;
  return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
// --- end of F140-3 test part 5 ---
}

function viewOf(r: ActResult): View {
  const snap = (r.json?.["snapshot"] ?? null) as { view: View } | null;
  if (snap === null) throw new Error(`no snapshot (status ${r.status})`);
  return snap.view;
}

/** Let the page run queued tasks (response handlers) after a response. */
async function settle(page: Page): Promise<void> {
// --- end of F140-3 test part 6 ---
