import { it, expect } from "vitest";
import { createAuthenticatedMeetDriver, type MeetDriverPage, type MeetDriverLocator } from "../src/meetAdmissionDriver.js";
import { createMeetAdmissionBrowser } from "../src/meetAdmissionBrowser.js";
const A = "https://meet.google.com/abc-defg-hij";
function makeFake(signedEmail: string, opts?: { failVisible?: boolean; hang?: boolean; onWaitFor?: () => void }): { page: MeetDriverPage; gotos: string[]; joins: { n: number } } {
  const gotos: string[] = [];
  const joins = { n: 0 };
  let leaveVisible = false;
  const page: MeetDriverPage = {
    goto(url: string) {
      gotos.push(url);
      return Promise.resolve();
    },
    url() {
      return gotos[gotos.length - 1] ?? "";
    },
    getByRole(role: "button", options?: { name?: string }) {
      const name = options?.name ?? "";
      if (name === "Continue without microphone and camera") {
        const loc: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return loc; } };
        return loc;
      }
      if (name === "Join now") {
        const loc: MeetDriverLocator = {
          waitFor() { return Promise.resolve(); },
          count() { return Promise.resolve(1); },
          isVisible() { return Promise.resolve(!leaveVisible); },
          click() { joins.n += 1; leaveVisible = true; return Promise.resolve(); },
          or(other: MeetDriverLocator) {
            const self = loc;
            return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return self; } };
          },
        };
        return loc;
      }
      if (name === "Leave call") {
        const loc: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(leaveVisible); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return loc; } };
        return loc;
      }
      if (name === "Switch here") {
        const loc: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return loc; } };
        return loc;
      }
      const loc: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return loc; } };
      return loc;
    },
    getByText(text: string) {
      const visible = text === signedEmail;
      const loc: MeetDriverLocator = {
        waitFor() {
          if (opts?.onWaitFor) opts.onWaitFor();
          if (opts?.hang) return new Promise<void>(() => {});
          if (opts?.failVisible && !visible) return Promise.reject(new Error("not visible"));
          if (!visible) return Promise.reject(new Error("not visible"));
          return Promise.resolve();
        },
        count() { return Promise.resolve(visible ? 1 : 0); },
        isVisible() { return Promise.resolve(visible); },
        click() { return Promise.resolve(); },
        or(other: MeetDriverLocator) {
          const self = loc;
          return {
            waitFor() { return Promise.resolve(); },
            count() { return Promise.resolve(1); },
            isVisible() { return Promise.resolve(visible || false); },
            click() { return Promise.resolve(); },
            or(o: MeetDriverLocator) { return self; },
          };
        },
      };
      return loc;
    },
  };
  return { page, gotos, joins };
}
it("home before meeting in the same isolated context", async () => {
  const Aurl = A;
  const fake = makeFake("owner@example.test");
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 1000 });
  let ctxCalls = 0;
  let closeCalls = 0;
  const launch = () => Promise.resolve({ newContext: () => { ctxCalls += 1; return Promise.resolve({ newPage: () => Promise.resolve(fake.page) }); }, close: () => { closeCalls += 1; return Promise.resolve(); } });
  const transport = createMeetAdmissionBrowser<MeetDriverPage>({ meetingUrl: Aurl, displayName: "Bridgett AI twin (test)" }, { launch, admit: driver });
  const signal = new AbortController().signal;
  const ok = await transport.join(Aurl, "Bridgett AI twin (test)", signal);
  expect(ok).toBe(true);
  expect(fake.gotos).toEqual(["https://meet.google.com/", Aurl]);
  expect(ctxCalls).toBe(1);
  expect(fake.joins.n).toBe(1);
  await transport.leave();
  expect(closeCalls).toBe(1);
});
it("wrong owner is refused before the meeting", async () => {
  const fake = makeFake("wrong@example.test", { failVisible: true });
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 1000 });
  const r = await driver(fake.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(fake.gotos).toEqual(["https://meet.google.com/"]);
  expect(fake.joins.n).toBe(0);
});
it("abort during sign-in stops without reaching the meeting", async () => {
  let entered = false;
  let resolveEntered: () => void = () => {};
  const enteredPromise = new Promise<void>((res) => { resolveEntered = res; });
  const controller = new AbortController();
  const fake = makeFake("owner@example.test", { hang: true, onWaitFor: () => { if (!entered) { entered = true; resolveEntered(); } } });
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 1000 });
  const p = driver(fake.page, { meetingUrl: A, displayName: "x" }, controller.signal);
  await enteredPromise;
  controller.abort();
  const r = await p;
  expect(r).toBe(false);
  expect(fake.gotos).toEqual(["https://meet.google.com/"]);
  expect(fake.joins.n).toBe(0);
});
