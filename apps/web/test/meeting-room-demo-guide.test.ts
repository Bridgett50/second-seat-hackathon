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
