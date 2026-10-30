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

describe("F140-4a public guided demo continues past Send without sending", () => {
  for (const [label, env] of [
    ["test mode absent", {}],
    ["test mode 0", { SECOND_SEAT_TEST_MODE: "0" }],
  ] as const) {
    it(`F140-4a ${label}: Next reaches the honest final state`, async () => {
      const svc = createMeetingRoomService({ env });
      const page = svc.open("?demo=1", PUBLIC, randomUUID());
      expect(page.fakeSend, "public demo cannot send").toBe(false);
      const run = await runGuide(svc, page.roomId, PUBLIC);
// --- end of F140-4 test part 5 ---
      expect(run.statuses, "every Next succeeds past step 5").toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
      const last = run.last as Snap;
      expect(last.demo?.completed, "all nine steps completed").toBe(9);
      expect(last.demo?.done, "guide finished").toBe(true);
      expect(last.demo?.sendNote ?? "", "visible not-sent explanation").toContain("not sent");
      expect(run.notes.join("\n"), "announced as not sent").toContain("not sent");
      expect(svc.sentBodies(), "zero fake transport calls").toEqual([]);
// --- end of F140-4 test part 6 ---
      expect(last.view.draft.approved, "approval is real and kept").toBe(true);
      expect(last.view.draft.sendState, "package stays unsent, no receipt").toBe("unsent");
      expect(last.view.twinStatus, "takeover really paused the twin").toBe("paused (you took over)");
      const evidence = await svc.act({ roomId: page.roomId, action: "evidence-export" }, PUBLIC);
      expect(evidence.status, "evidence export allowed").toBe(200);
      const send = await svc.act({ roomId: page.roomId, action: "send" }, PUBLIC);
      expect(send.status, "direct Send stays refused").toBe(403);
      expect(svc.sentBodies(), "still zero transport calls").toEqual([]);
    });
  }
// --- end of F140-4 test part 7 ---

  it("F140-4a browser: the Next control reaches the honest final state", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const server: Server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser: Browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/meeting-room?demo=1`);
// --- end of F140-4 test part 8 ---
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        if (await page.locator("#demo-next").isDisabled()) break;
        const pending = page.waitForResponse((r) => new URL(r.url()).pathname === API && r.request().method() === "POST");
        await page.locator("#demo-next").click();
        statuses.push((await pending).status());
      }
      expect(statuses, "every Next click succeeds").toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
// --- end of F140-4 test part 9 ---
      expect(await page.locator("#demo-progress").textContent(), "progress shows 9 of 9").toBe("9 / 9");
      expect(await page.locator("#demo-status").textContent(), "honest final caption").toBe("Demo complete");
      expect(await page.locator("#demo-send-note").textContent(), "visible not-sent note").toContain("not sent");
      expect(await page.locator("#demo-next").isDisabled(), "Next disabled at the end").toBe(true);
      expect(svc.sentBodies(), "zero fake transport calls").toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});
// --- end of F140-4 test part 10 ---

describe("F140-4b demo restart gives a fresh demo room", () => {
  it("F140-4b test mode 1: restart resets the real room and a second run sends once more", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("?demo=1", LOOPBACK, randomUUID());
    const first = await runGuide(svc, page.roomId, LOOPBACK);
    expect(first.statuses, "first run completes").toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
    expect(svc.sentBodies().length, "exactly one fake send").toBe(1);
    expect(first.last?.view.draft.sendState, "first run sent").toBe("sent");
// --- end of F140-4 test part 11 ---
    const restarted = await step(svc, page.roomId, "demo-restart", LOOPBACK);
    expect(restarted.status, "restart allowed").toBe(200);
    expect(restarted.snap.roomId, "same demo page").toBe(page.roomId);
    expect(restarted.snap.view.twinStatus, "twin active again").toBe("active");
    expect(restarted.snap.view.draft.approved, "package unapproved").toBe(false);
    expect(restarted.snap.view.draft.sendState, "package unsent, no prior receipt").toBe("unsent");
    expect(restarted.snap.view.transcript, "empty transcript").toEqual([]);
    expect(restarted.snap.demo?.completed, "zero progress").toBe(0);
    expect(restarted.snap.demo?.sendNote ?? null, "no carried-over send note").toBeNull();
// --- end of F140-4 test part 12 ---
    for (let i = 0; i < 3; i += 1) await step(svc, page.roomId, "demo-next", LOOPBACK);
    const streamed = await step(svc, page.roomId, "state", LOOPBACK);
    expect(streamed.snap.view.transcript.length, "fresh transcript streamed").toBeGreaterThan(0);
    const second = await runGuide(svc, page.roomId, LOOPBACK);
    expect(second.statuses.every((s) => s === 200), "second run completes").toBe(true);
    expect(second.last?.demo?.completed, "second run reaches nine").toBe(9);
    expect(second.last?.view.draft.sendState, "second run really sent").toBe("sent");
// --- end of F140-4 test part 13 ---
    const sent = svc.sentBodies();
    expect(sent.length, "exactly one additional fake call").toBe(2);
    expect(sent[1], "second send is the fresh run's package").toBe(second.last?.view.draft.body);
    expect(second.last?.view.twinStatus, "second takeover paused the fresh twin").toBe("paused (you took over)");
  });
// --- end of F140-4 test part 14 ---
