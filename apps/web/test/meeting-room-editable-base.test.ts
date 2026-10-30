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
