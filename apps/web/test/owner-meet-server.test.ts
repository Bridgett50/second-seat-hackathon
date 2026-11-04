import { test, expect, afterEach } from "vitest";
import { createServer } from "node:net";
import { request } from "node:http";
import { startOwnerMeetServer, assertOwnerMeetCliEnvironment } from "../src/ownerMeetServer.js";
import type { StartCapture } from "../src/ownerMeetRuntime.js";
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let r!: (v: T) => void;
  const p = new Promise<T>((res) => { r = res; });
  return { promise: p, resolve: r };
}
async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((res) => s.listen(0, "127.0.0.1", () => res()));
  const addr = s.address() as { port: number };
  const p = addr.port;
  await new Promise<void>((res) => s.close(() => res()));
  // race between reserve close and rebind - no retries
  return p;
}
function httpReq(opts: { port: number; method: string; path: string; cookie?: string }): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: "localhost:" + opts.port };
    if (opts.method === "POST") { headers["Origin"] = "http://localhost:" + opts.port; headers["Content-Type"] = "application/json"; }
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    const req = request({ hostname: "127.0.0.1", port: opts.port, method: opts.method, path: opts.path, agent: false, headers }, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: d, headers: res.headers as Record<string, string | string[] | undefined> }));
    });
    req.on("error", reject);
    req.end(opts.method === "POST" ? JSON.stringify({}) : undefined);
  });
}
function postConnect(port: number, roomId: string, cookie: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const body = JSON.stringify({ meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat AI twin (test)", roomId });
    const req = request({ hostname: "127.0.0.1", port, method: "POST", path: "/api/meeting-room/worker/connect", agent: false, headers: { Host: "localhost:" + port, Origin: "http://localhost:" + port, "Content-Type": "application/json", Cookie: cookie, "Content-Length": Buffer.byteLength(body).toString() } }, (res) => {
      let d = ""; res.on("data", (c) => d += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: d }));
    });
    req.on("error", reject); req.write(body); req.end();
  });
}
const handles: { stop: () => Promise<void>; server: { listening: boolean } }[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  for (const r of releases.splice(0)) try { r(); } catch {}
  for (const h of handles.splice(0)) {
    try { await h.stop(); } catch (e) {
      if (!h.server.listening) { expect((e as Error).message).toBe("Owner Meet cleanup unconfirmed"); } else throw e;
    }
  }
});
test("A TCP + held cleanup ACK", async () => {
  const port = await freePort();
  let launches = 0;
  const entered = deferred<void>();
  const held = deferred<void>();
  const closeEntered = deferred<void>();
  releases.push(()=>held.resolve(undefined));
  let scope!: Parameters<StartCapture>[0];
  const fake: StartCapture = async (s) => { launches++; scope = s; entered.resolve(undefined); return { sample: async () => [], stop: () => { closeEntered.resolve(undefined); return held.promise; } }; };
  const h = await startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port, startCapture: fake });
  handles.push(h as unknown as typeof handles[number]);
  expect(h.url).toBe(`http://localhost:${port}/meeting-room`);
  const addr = (h.server.address() as { address: string });
  expect(addr.address).toBe("127.0.0.1");
  const page = await httpReq({ port, method: "GET", path: "/meeting-room" });
  expect(page.status).toBe(200);
  expect(page.body).toMatch(/data-meet-worker="1"/);
  expect(page.body).toMatch(/data-ai-drafting="0"/);
  const roomId = page.body.match(/data-room-id="([^"]+)"/)?.[1] ?? "";
  expect(roomId).toBeTruthy();
  expect(launches).toBe(0);
  const cookie = (page.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
  const st = await httpReq({ port, method: "GET", path: "/api/meeting-room/worker/status?roomId="+encodeURIComponent(roomId), cookie });
  expect(st.status).toBe(200);
  expect(JSON.parse(st.body).canPrepare).toBe(false);
  const conn = await postConnect(port, roomId, cookie);
  expect(conn.status).toBe(202);
  await entered.promise;
  const p1 = h.stop(); const p2 = h.stop();
  expect(p1).toBe(p2);
  expect(scope.isCurrent()).toBe(false);
  await closeEntered.promise;
  expect(h.server.listening).toBe(true);
  let ackSettled = false; p1.then(() => ackSettled = true, () => ackSettled = true);
  await Promise.resolve(); expect(ackSettled).toBe(false);
  held.resolve(undefined);
  await p1;
  expect(h.server.listening).toBe(false);
  expect(launches).toBe(1);
});
test("B pure guards + bad ports", async () => {
  const envBefore = { ...process.env };
  expect(() => assertOwnerMeetCliEnvironment({})).not.toThrow();
  expect(() => assertOwnerMeetCliEnvironment({ SECOND_SEAT_TEST_MODE: "0" })).not.toThrow();
  expect(() => assertOwnerMeetCliEnvironment({ SECOND_SEAT_TEST_MODE: "1" })).toThrow();
  expect(() => assertOwnerMeetCliEnvironment({ LIVE_DEV: "1" })).toThrow();
  expect(() => assertOwnerMeetCliEnvironment({ SECOND_SEAT_EXPERIMENTAL_IMAGES: "1" })).toThrow();
  expect(() => assertOwnerMeetCliEnvironment({ SECOND_SEAT_MODE: "live" })).toThrow();
  const envBeforeSecondSeatTestMode = process.env["SECOND_SEAT_TEST_MODE"];
  expect(process.env["SECOND_SEAT_TEST_MODE"]).toBe(envBeforeSecondSeatTestMode);
  for (const bad of [0, 1023, 65536, 1.5, NaN]) {
    let called = 0;
    const fake: StartCapture = async () => { called++; return { sample: async () => [], stop: async () => {} }; };
    await expect(startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port: bad, startCapture: fake })).rejects.toThrow();
    expect(called).toBe(0);
  }
});
test("C occupied port", async () => {
  const blocker = createServer();
  await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
  const port = (blocker.address() as { port: number }).port;
  let called = 0;
  const fake: StartCapture = async () => { called++; return { sample: async () => [], stop: async () => {} }; };
  try {
    await expect(startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port, startCapture: fake })).rejects.toThrow(/Owner Meet start failed/);
    expect(called).toBe(0);
    expect(blocker.listening).toBe(true);
  } finally { await new Promise<void>((r) => blocker.close(() => r())); }
});
test("D cleanup failure after connect", async () => {
  const port = await freePort();
  const entered = deferred<void>();
  const fake: StartCapture = async () => { entered.resolve(undefined); return { sample: async () => [], stop: async () => { throw new Error("do-not-leak"); } }; };
  const h = await startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port, startCapture: fake });
  handles.push(h as unknown as typeof handles[number]);
  const page = await httpReq({ port, method: "GET", path: "/meeting-room" });
  const roomId = page.body.match(/data-room-id="([^"]+)"/)?.[1] ?? "";
  const cookie = (page.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
  const conn = await postConnect(port, roomId, cookie);
  expect(conn.status).toBe(202);
  await entered.promise;
  const p1 = h.stop(); const p2 = h.stop();
  expect(p1).toBe(p2);
  await expect(p1).rejects.toThrow(/Owner Meet cleanup unconfirmed/);
  try { await p1; } catch (e) { expect((e as Error).message).not.toMatch(/do-not-leak/); expect((e as Error).cause).toBeUndefined(); }
  expect(h.server.listening).toBe(false);
});
