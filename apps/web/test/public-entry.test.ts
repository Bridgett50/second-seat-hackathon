import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PUBLIC_BIND_HOST, publicEntryProblems, startPublicServer } from "../src/public-entry.js";
import { WEB_BIND_HOST } from "../src/server.js";

// Offline public entry (apps/web/src/public-entry.ts): environment refusal,
// 0.0.0.0/PORT binding, blocked test and send routes, and the synthetic
// nine-step guide with Restart over HTTP. Synthetic data only; no model,
// email or meeting calls. Test mode stays "0" throughout.
const OFFLINE_ENV: Record<string, string> = {
  SECOND_SEAT_MODE: "offline",
  SECOND_SEAT_TEST_MODE: "0",
  LIVE_DEV: "0",
  SECOND_SEAT_EXPERIMENTAL_IMAGES: "0",
  PORT: "4173",
};

describe("PE-1 public entry environment checks", () => {
  it("PE-1a allows offline with test mode, LIVE_DEV and experimental images unset or 0", () => {
    expect(publicEntryProblems(OFFLINE_ENV)).toEqual([]);
    expect(publicEntryProblems({ SECOND_SEAT_MODE: "offline", PORT: "10000" })).toEqual([]);
  });

  it("PE-1b refuses a missing or non-offline SECOND_SEAT_MODE", () => {
    for (const mode of [undefined, "", "live", "OFFLINE"]) {
      expect(publicEntryProblems({ ...OFFLINE_ENV, SECOND_SEAT_MODE: mode }), String(mode)).toContain(
        "SECOND_SEAT_MODE must be offline",
      );
    }
  });

  it("PE-1c refuses SECOND_SEAT_TEST_MODE, LIVE_DEV or SECOND_SEAT_EXPERIMENTAL_IMAGES turned on", () => {
    for (const name of ["SECOND_SEAT_TEST_MODE", "LIVE_DEV", "SECOND_SEAT_EXPERIMENTAL_IMAGES"]) {
      for (const value of ["1", "true"]) {
        expect(publicEntryProblems({ ...OFFLINE_ENV, [name]: value }), `${name}=${value}`).toContain(
          `${name} must be unset or 0`,
        );
      }
    }
  });

  it("PE-1d refuses a missing or invalid PORT", () => {
    for (const port of [undefined, "", "abc", "70000"]) {
      expect(publicEntryProblems({ ...OFFLINE_ENV, PORT: port }), String(port)).toContain(
        "PORT must be a port number",
      );
    }
  });
});

describe("PE-2 startPublicServer refuses unsafe environments before listening", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  const unsafe = [
    ["SECOND_SEAT_TEST_MODE", "1"],
    ["SECOND_SEAT_MODE", "live"],
    ["LIVE_DEV", "1"],
    ["SECOND_SEAT_EXPERIMENTAL_IMAGES", "1"],
  ] as const;
  for (const [name, value] of unsafe) {
    it(`PE-2 ${name}=${value} is refused`, async () => {
      for (const [k, v] of Object.entries(OFFLINE_ENV)) vi.stubEnv(k, v);
      vi.stubEnv(name, value);
      await expect(startPublicServer()).rejects.toThrow(/refusing to start/);
      vi.unstubAllEnvs();
    });
  }
});

// --- end of public-entry test part 1 ---

type Res = { status: number; headers: IncomingHttpHeaders; text: string };
type Snap = {
  demo: { completed: number; done: boolean; sendNote?: string | null } | null;
  view: { selectedMeetingId: string | null; draft: { sendState: string; sha256: string } };
};
type Room = { roomId: string; cookie: string };

function call(port: number, method: string, path: string, headers: Record<string, string>, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

describe("PE-3 public entry server (offline, test mode 0)", () => {
  const PUBLIC_HOST = "second-seat.example.com";
  const pub: Record<string, string> = {
    host: PUBLIC_HOST,
    "x-forwarded-host": PUBLIC_HOST,
    "x-forwarded-proto": "https",
  };
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    port = await freePort();
    for (const [k, v] of Object.entries({ ...OFFLINE_ENV, PORT: String(port) })) vi.stubEnv(k, v);
    server = await startPublicServer();
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  async function openRoom(path: string): Promise<Room> {
    const page = await call(port, "GET", path, pub);
    expect(page.status, `${path} returns 200`).toBe(200);
    const roomId = /data-room-id="([^"]+)"/.exec(page.text)?.[1] ?? "";
    const cookie = (page.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
    expect(roomId, "page has a room id").not.toBe("");
    expect(cookie, "page sets the store cookie").toMatch(/^mr_store=/);
    return { roomId, cookie };
  }

  async function act(
    room: Room,
    action: string,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await call(
      port,
      "POST",
      "/api/meeting-room",
      { ...pub, cookie: room.cookie, "content-type": "application/json" },
      JSON.stringify({ roomId: room.roomId, action, ...extra }),
    );
    return { status: res.status, json: JSON.parse(res.text) as Record<string, unknown> };
  }

  it("PE-3a binds 0.0.0.0 on PORT and the loopback CLI host is unchanged", () => {
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("0.0.0.0");
    expect(addr.port).toBe(port);
    expect(PUBLIC_BIND_HOST).toBe("0.0.0.0");
    expect(WEB_BIND_HOST).toBe("127.0.0.1");
  });

  it("PE-3b test-only routes are not found on the public entry", async () => {
    expect((await call(port, "GET", "/api/test/outbound", pub)).status).toBe(404);
    const expire = await call(port, "POST", "/api/test/expire-approvals", { ...pub, "content-type": "application/json" }, "{}");
    expect(expire.status).toBe(404);
  });

  it("PE-3c a public meeting-room Send is refused and nothing is sent", async () => {
    const room = await openRoom("/meeting-room?demo=1");
    let approved: Snap | undefined;
    for (let i = 0; i < 5; i += 1) approved = (await act(room, "demo-next")).json["snapshot"] as Snap;
    const packageId = `${approved?.view.selectedMeetingId ?? ""}:${approved?.view.draft.sha256 ?? ""}`;
    expect(packageId, "the approved package has an identity").toMatch(/:[0-9a-f]{64}$/);
    const sent = await act(room, "send", { packageId });
    expect(sent.status).toBe(403);
    expect((sent.json["snapshot"] as Snap).view.draft.sendState).not.toBe("sent");
  });

  it("PE-3d the synthetic nine-step guide keeps comparison and unsent evidence, and Restart gives a fresh demo", async () => {
    const room = await openRoom("/meeting-room?demo=1");
    const steps: { status: number; json: Record<string, unknown> }[] = [];
    for (let i = 0; i < 9; i += 1) steps.push(await act(room, "demo-next"));
    expect(steps.map((s) => s.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
    const comparison = steps[6]?.json["comparison"] as { identical?: boolean } | null | undefined;
    expect(comparison?.identical, "step 7 comparison").toBe(true);
    const evidence = JSON.parse(String(steps[7]?.json["evidenceJson"])) as { sendState: string; sentAt: number | null };
    expect(evidence.sendState).toBe("unsent");
    expect(evidence.sentAt).toBeNull();
    const last = steps[8]?.json["snapshot"] as Snap;
    expect(last.demo?.done).toBe(true);
    expect(last.demo?.sendNote ?? "").toContain("not sent");
    expect(last.view.draft.sendState).toBe("unsent");
    const restart = await act(room, "demo-restart");
    expect(restart.status).toBe(200);
    const fresh = restart.json["snapshot"] as Snap;
    expect(fresh.demo?.completed).toBe(0);
    expect(fresh.demo?.done).toBe(false);
    const again = await act(room, "demo-next");
    expect(again.status).toBe(200);
    expect((again.json["snapshot"] as Snap).demo?.completed).toBe(1);
  });
});
