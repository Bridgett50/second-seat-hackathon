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
