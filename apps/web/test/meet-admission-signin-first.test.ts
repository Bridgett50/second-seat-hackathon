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
    getByRole(role: "button", options?: { name?: string | RegExp }) {
      const raw = options?.name ?? "";
      const name = typeof raw === "string" ? raw : raw.test("owner@example.test") ? "owner@example.test" : "";
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
      if (name === "owner@example.test") {
        const loc: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("not visible")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return loc; } };
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
it("T1 email on accounts then home proceeds", async () => {
  const Aurl = A;
  const exp = "owner@example.test";
  let loc: string = "";
  let joins = 0;
  let leaveVisible = false;
  let isVisibleCalls = 0;
  const gotos: string[] = [];
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = url === "https://meet.google.com/" ? "https://accounts.google.com/" : url; return Promise.resolve(); },
    url() { return loc; },
    getByRole(role: "button", options?: { name?: string | RegExp }) {
      const raw = options?.name ?? "";
      const name = typeof raw === "string" ? raw : raw.test(exp) ? exp : "";
      if (name === exp) {
        const loc2: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return loc2; } };
        return loc2;
      }
      if (name === "Continue without microphone and camera") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Join now") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(!leaveVisible); }, click() { joins += 1; leaveVisible = true; return Promise.resolve(); }, or(other: MeetDriverLocator) { const self = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return self; } }; } }; return l; }
      if (name === "Leave call") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(leaveVisible); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Switch here") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l;
    },
    getByText(text: string) {
      const loc2: MeetDriverLocator = {
        waitFor() { return Promise.resolve(); },
        count() { return Promise.resolve(1); },
        isVisible() {
          isVisibleCalls += 1;
          if (isVisibleCalls === 1) {
            loc = "https://meet.google.com/";
            return Promise.resolve(true);
          }
          return Promise.resolve(true);
        },
        click() { return Promise.resolve(); },
        or(other: MeetDriverLocator) { const self = loc2; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return self; } }; }
      };
      return loc2;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 5000 });
  const r = await driver(page, { meetingUrl: Aurl, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(true);
  expect(gotos).toEqual(["https://meet.google.com/", Aurl]);
  expect(joins).toBe(1);
});
it("T2 timeout on accounts never reaches meeting", async () => {
  const exp = "owner@example.test";
  let loc = "";
  const gotos: string[] = [];
  let joins = 0;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = "https://accounts.google.com/"; return Promise.resolve(); },
    url() { return loc; },
    getByRole(_r: "button", o?: { name?: string }) {
      const n = o?.name ?? "";
      if (n === "Join now") return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { joins += 1; return Promise.resolve(); }, or(other: MeetDriverLocator) { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o2: MeetDriverLocator) { return l; } }; return l; } };
      if (n === "Leave call") return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { const x: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o2: MeetDriverLocator) { return x; } }; return x; } };
      const l: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return l; } };
      return l;
    },
    getByText(_t: string) {
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { const s = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(x: MeetDriverLocator) { return s; } }; } };
      return l;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 200 });
  const r = await driver(page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(gotos).toEqual(["https://meet.google.com/"]);
  expect(joins).toBe(0);
});
it("T3 abort while on accounts stays closed", async () => {
  const exp = "owner@example.test";
  let loc = "";
  const gotos: string[] = [];
  const controller = new AbortController();
  let joins = 0;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = "https://accounts.google.com/"; return Promise.resolve(); },
    url() { return loc; },
    getByRole(_r: "button", o?: { name?: string }) {
      const n = o?.name ?? "";
      if (n === "Join now") return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { joins += 1; return Promise.resolve(); }, or(other: MeetDriverLocator) { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o2: MeetDriverLocator) { return l; } }; return l; } };
      const l: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(other: MeetDriverLocator) { return l; } };
      return l;
    },
    getByText(_t: string) {
      let calls = 0;
      const l: MeetDriverLocator = {
        waitFor() { return Promise.resolve(); },
        count() { return Promise.resolve(1); },
        isVisible() {
          calls += 1;
          if (calls === 2) controller.abort();
          return Promise.resolve(true);
        },
        click() { return Promise.resolve(); },
        or(o: MeetDriverLocator) { const s = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(x: MeetDriverLocator) { return s; } }; }
      };
      return l;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 10000 });
  const r = await driver(page, { meetingUrl: A, displayName: "x" }, controller.signal);
  expect(r).toBe(false);
  expect(gotos).toEqual(["https://meet.google.com/"]);
  expect(joins).toBe(0);
});
it("T5 aria-label-only on home and meeting joins", async () => {
  const exp = "owner@example.test";
  const Aurl = A;
  let loc = "";
  const gotos: string[] = [];
  let joins = 0;
  let leaveVisible = false;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = url; return Promise.resolve(); },
    url() { return loc; },
    getByRole(role: "button", opts?: { name?: string | RegExp }) {
      const raw = opts?.name ?? "";
      const name = typeof raw === "string" ? raw : raw.test(exp) ? exp : "";
      if (name === exp) {
        const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
        return l;
      }
      if (name === "Continue without microphone and camera") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Join now") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(!leaveVisible); }, click() { joins += 1; leaveVisible = true; return Promise.resolve(); }, or(other: MeetDriverLocator) { const self = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return self; } }; } }; return l; }
      if (name === "Leave call") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(leaveVisible); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Switch here") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l;
    },
    getByText(text: string) {
      if (text === exp) {
        const l: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { const s = l; return { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(x: MeetDriverLocator) { return s; } }; } };
        return l;
      }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
      return l;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 5000 });
  const r = await driver(page, { meetingUrl: Aurl, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(true);
  expect(gotos).toEqual(["https://meet.google.com/", Aurl]);
  expect(joins).toBe(1);
});
it("T6 meeting aria-label for a different email refuses", async () => {
  const exp = "owner@example.test";
  const other = "other@example.test";
  const Aurl = A;
  let loc = "";
  const gotos: string[] = [];
  let joins = 0;
  let leaveVisible = false;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = url; return Promise.resolve(); },
    url() { return loc; },
    getByRole(role: "button", opts?: { name?: string | RegExp }) {
      const raw = opts?.name ?? "";
      const name = typeof raw === "string" ? raw : raw.test(exp) ? exp : "";
      if (name === exp) {
        const l: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
        return l;
      }
      if (name === other) {
        const onHome = (): boolean => loc === "https://meet.google.com/";
        const l: MeetDriverLocator = { waitFor() { if (onHome()) return Promise.reject(new Error("hidden")); return Promise.resolve(); }, count() { return Promise.resolve(onHome() ? 0 : 1); }, isVisible() { return Promise.resolve(!onHome()); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
        return l;
      }
      if (name === "Continue without microphone and camera") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Join now") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(!leaveVisible); }, click() { joins += 1; leaveVisible = true; return Promise.resolve(); }, or(otherBtn: MeetDriverLocator) { const self = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return self; } }; } }; return l; }
      if (name === "Leave call") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(leaveVisible); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Switch here") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l;
    },
    getByText(text: string) {
      if (text === exp) {
        const onHome = (): boolean => loc === "https://meet.google.com/";
        const l: MeetDriverLocator = { waitFor() { if (onHome()) return Promise.resolve(); return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(onHome() ? 1 : 0); }, isVisible() { return Promise.resolve(onHome()); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { const s = l; return { waitFor() { if (onHome()) return Promise.resolve(); return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(onHome() ? 1 : 0); }, isVisible() { return Promise.resolve(onHome()); }, click() { return Promise.resolve(); }, or(x: MeetDriverLocator) { return s; } }; } };
        return l;
      }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
      return l;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 5000 });
  const r = await driver(page, { meetingUrl: Aurl, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(gotos).toEqual(["https://meet.google.com/", Aurl]);
  expect(joins).toBe(0);
});
it("T4 aria-label-only on home still joins", async () => {
  const exp = "owner@example.test";
  const Aurl = A;
  let loc = "";
  const gotos: string[] = [];
  let joins = 0;
  let leaveVisible = false;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = url; return Promise.resolve(); },
    url() { return loc; },
    getByRole(role: "button", opts?: { name?: string | RegExp }) {
      const raw = opts?.name ?? "";
      const name = typeof raw === "string" ? raw : raw.test(exp) ? exp : "";
      if (name === exp) {
        const onHome = (): boolean => loc === "https://meet.google.com/";
        const l: MeetDriverLocator = { waitFor() { if (onHome()) return Promise.resolve(); return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(onHome() ? 1 : 0); }, isVisible() { return Promise.resolve(onHome()); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
        return l;
      }
      if (name === "Continue without microphone and camera") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Join now") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(!leaveVisible); }, click() { joins += 1; leaveVisible = true; return Promise.resolve(); }, or(other: MeetDriverLocator) { const self = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return self; } }; } }; return l; }
      if (name === "Leave call") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(leaveVisible); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      if (name === "Switch here") { const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l;
    },
    getByText(text: string) {
      if (text === exp) {
        const onHome = (): boolean => loc === "https://meet.google.com/";
        const l: MeetDriverLocator = { waitFor() { if (onHome()) return Promise.reject(new Error("hidden")); return Promise.resolve(); }, count() { return Promise.resolve(onHome() ? 0 : 1); }, isVisible() { return Promise.resolve(!onHome()); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { const s = l; return { waitFor() { if (onHome()) return Promise.reject(new Error("hidden")); return Promise.resolve(); }, count() { return Promise.resolve(onHome() ? 0 : 1); }, isVisible() { return Promise.resolve(!onHome()); }, click() { return Promise.resolve(); }, or(x: MeetDriverLocator) { return s; } }; } };
        return l;
      }
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } };
      return l;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 5000 });
  const r = await driver(page, { meetingUrl: Aurl, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(true);
  expect(gotos).toEqual(["https://meet.google.com/", Aurl]);
  expect(joins).toBe(1);
});
