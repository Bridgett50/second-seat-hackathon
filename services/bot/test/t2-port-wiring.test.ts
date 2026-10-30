import { describe, expect, it } from "vitest";
import { createTwinRoom as createCoreTwinRoom, packageHash as corePackageHash } from "@second-seat/core";
import { createMeetingConnector, packageHash as frozenPackageHash } from "../src/meeting/connector.js";
import { T2_CONNECTOR_FACTORY, createTwinRoom as createBotTwinRoom } from "../src/t2-room.js";

describe("T2 port wiring", () => {
  it("T2P-3 core packageHash equals the frozen connector packageHash", () => {
    const bodies = ["", "abc", "héllo ✓ 📎\n", "x".repeat(1000)];
    for (const body of bodies) {
      expect(corePackageHash(body)).toBe(frozenPackageHash(body));
    }
  });

  it("T2P-4 the bot twin room is built on the frozen createMeetingConnector", () => {
    expect(T2_CONNECTOR_FACTORY).toBe(createMeetingConnector);
    let calls = 0;
    const spy = () => {
      calls += 1;
      return createMeetingConnector();
    };
    createCoreTwinRoom({ connector: spy, testMode: true, transport: async () => {} });
    expect(calls).toBe(1);
    expect(createBotTwinRoom({ testMode: true, transport: async () => {} }).view().meetings.length).toBeGreaterThan(0);
  });

  it("T2P-5 the core twin room refuses to start without an injected connector", () => {
    expect(() => createCoreTwinRoom({} as never)).toThrow(/injected meeting connector/);
  });
});
