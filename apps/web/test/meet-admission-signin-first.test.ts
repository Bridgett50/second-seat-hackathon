import { it, expect, vi } from "vitest";
import { createAuthenticatedMeetDriver, type MeetDriverPage, type MeetDriverLocator, createGuestMeetDriver, resolveMeetGuestName, type MeetGuestPage, type MeetGuestLocator } from "../src/meetAdmissionDriver.js";
import { createMeetAdmissionBrowser } from "../src/meetAdmissionBrowser.js";
const A = "https://meet.google.com/abc-defg-hij";
const SA = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(A)}`;
const land = (u: string): string => (u === SA ? A : u);
const hidden = (): MeetDriverLocator => { const l: MeetDriverLocator = { waitFor() { return Promise.reject(new Error("hidden")); }, count() { return Promise.resolve(0); }, isVisible() { return Promise.resolve(false); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { return l; } }; return l; };
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
      return land(gotos[gotos.length - 1] ?? "");
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
it("meeting URL opened directly in the same isolated context", async () => {
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
  expect(fake.gotos).toEqual([SA]);
  expect(ctxCalls).toBe(1);
  expect(fake.joins.n).toBe(1);
  await transport.leave();
  expect(closeCalls).toBe(1);
});
it("wrong owner on pre-join is refused", async () => {
  const fake = makeFake("wrong@example.test", { failVisible: true });
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 1000 });
  const r = await driver(fake.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(fake.gotos).toEqual([SA]);
  expect(fake.joins.n).toBe(0);
});
it("abort while waiting for the owner closes cleanly", async () => {
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
  expect(fake.gotos).toEqual([SA]);
  expect(fake.joins.n).toBe(0);
});
it("T1 sign-in via accounts then back on meeting proceeds", async () => {
  const Aurl = A;
  const exp = "owner@example.test";
  let loc: string = "";
  let joins = 0;
  let leaveVisible = false;
  let isVisibleCalls = 0;
  const gotos: string[] = [];
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = url === SA ? "https://accounts.google.com/" : url; return Promise.resolve(); },
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
    getByText(text: string | RegExp) {
      if (typeof text !== "string") return hidden();
      const loc2: MeetDriverLocator = {
        waitFor() { return Promise.resolve(); },
        count() { return Promise.resolve(1); },
        isVisible() {
          isVisibleCalls += 1;
          if (isVisibleCalls === 2) {
            loc = Aurl;
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
  expect(gotos).toEqual([SA]);
  expect(joins).toBe(1);
});
it("T2 timeout on accounts never joins", async () => {
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
    getByText(_t: string | RegExp) {
      if (typeof _t !== "string") return hidden();
      const l: MeetDriverLocator = { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(o: MeetDriverLocator) { const s = l; return { waitFor() { return Promise.resolve(); }, count() { return Promise.resolve(1); }, isVisible() { return Promise.resolve(true); }, click() { return Promise.resolve(); }, or(x: MeetDriverLocator) { return s; } }; } };
      return l;
    }
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 200 });
  const r = await driver(page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(gotos).toEqual([SA]);
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
    getByText(_t: string | RegExp) {
      if (typeof _t !== "string") return hidden();
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
  expect(gotos).toEqual([SA]);
  expect(joins).toBe(0);
});
it("T5 aria-label-only on meeting joins", async () => {
  const exp = "owner@example.test";
  const Aurl = A;
  let loc = "";
  const gotos: string[] = [];
  let joins = 0;
  let leaveVisible = false;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = land(url); return Promise.resolve(); },
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
  expect(gotos).toEqual([SA]);
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
    goto(url: string) { gotos.push(url); loc = land(url); return Promise.resolve(); },
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
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 1000, ownerSignInTimeoutMs: 5000, unrecognizedGraceMs: 100 });
  const r = await driver(page, { meetingUrl: Aurl, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(gotos).toEqual([SA]);
  expect(joins).toBe(0);
});
function signedOutFake(signInAfter: number, onOwnerWait?: (n: number) => void): { page: MeetDriverPage; gotos: string[]; clicks: string[]; ownerWaits: () => number } {
  const exp = "owner@example.test";
  const gotos: string[] = [];
  const clicks: string[] = [];
  let loc = "";
  let waits = 0;
  let signedIn = false;
  let leaveVisible = false;
  const mk = (name: string, visible: () => boolean, onClick?: () => void): MeetDriverLocator => {
    const l: MeetDriverLocator = {
      waitFor() { return visible() ? Promise.resolve() : Promise.reject(new Error("hidden")); },
      count() { return Promise.resolve(visible() ? 1 : 0); },
      isVisible() { return Promise.resolve(visible()); },
      click() { clicks.push(name); if (onClick) onClick(); return Promise.resolve(); },
      or(o: MeetDriverLocator) { return l; },
    };
    return l;
  };
  const ownerShown = (): boolean => signedIn || loc === "https://accounts.google.com/";
  const ownerText = mk(exp, ownerShown);
  const owner: MeetDriverLocator = {
    waitFor() {
      waits += 1;
      if (onOwnerWait) onOwnerWait(waits);
      if (signInAfter > 0 && waits === signInAfter) loc = "https://accounts.google.com/";
      if (signInAfter > 0 && waits === signInAfter + 1) { signedIn = true; loc = A; }
      return ownerText.waitFor();
    },
    count() { return ownerText.count(); },
    isVisible() { return ownerText.isVisible(); },
    click() { return ownerText.click(); },
    or(o: MeetDriverLocator) { return owner; },
  };
  const guest = (): boolean => !signedIn && loc === A;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = land(url); return Promise.resolve(); },
    url() { return loc; },
    getByRole(role: "button", options?: { name?: string | RegExp }) {
      const raw = options?.name ?? "";
      const name = typeof raw === "string" ? raw : raw.test("Sign in") ? "Sign in" : raw.test(exp) ? "owner-button" : "";
      if (name === "Sign in" || name === "Ask to join") return mk(name, guest);
      if (name === "Join now") return mk(name, () => signedIn && loc === A && !leaveVisible, () => { leaveVisible = true; });
      if (name === "Leave call") return mk(name, () => leaveVisible);
      return mk(name, () => false);
    },
    getByText(text: string) { return text === exp ? owner : mk(text, () => false); },
  };
  return { page, gotos, clicks, ownerWaits: () => waits };
}
it("T7 signed-out meeting page waits for the owner and never joins as guest", async () => {
  const fake = signedOutFake(0);
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 600 });
  const r = await driver(fake.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(false);
  expect(fake.gotos).toEqual([SA]);
  expect(fake.clicks).toEqual([]);
  expect(fake.ownerWaits()).toBeGreaterThanOrEqual(2);
});
it("T8 owner signs in from the signed-out meeting page then joins once", async () => {
  const fake = signedOutFake(2);
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 5000 });
  const r = await driver(fake.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(true);
  expect(fake.gotos).toEqual([SA]);
  expect(fake.clicks).toEqual(["Join now"]);
});
it("T9 abort while waiting on the signed-out page closes cleanly", async () => {
  const controller = new AbortController();
  const fake = signedOutFake(0, (n) => { if (n === 2) controller.abort(); });
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 10000 });
  const t0 = Date.now();
  const r = await driver(fake.page, { meetingUrl: A, displayName: "x" }, controller.signal);
  expect(r).toBe(false);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(fake.gotos).toEqual([SA]);
  expect(fake.clicks).toEqual([]);
});
it("T10 Continue modal shown first is dismissed without waiting out the owner poll", async () => {
  const exp = "owner@example.test";
  const clicks: string[] = [];
  const gotos: string[] = [];
  const releases: Array<() => void> = [];
  let declined = false;
  let leaveVisible = false;
  const mk = (name: string, visible: () => boolean, onClick?: () => void): MeetDriverLocator => {
    const l: MeetDriverLocator = {
      waitFor() { return visible() ? Promise.resolve() : Promise.reject(new Error("hidden")); },
      count() { return Promise.resolve(visible() ? 1 : 0); },
      isVisible() { return Promise.resolve(visible()); },
      click() { clicks.push(name); if (onClick) onClick(); return Promise.resolve(); },
      or(o: MeetDriverLocator) { return l; },
    };
    return l;
  };
  const ownerText = mk(exp, () => declined);
  const owner: MeetDriverLocator = {
    waitFor() {
      if (declined) return Promise.resolve();
      return new Promise<void>((resolve) => { releases.push(resolve); });
    },
    count() { return ownerText.count(); },
    isVisible() { return ownerText.isVisible(); },
    click() { return ownerText.click(); },
    or(o: MeetDriverLocator) { return owner; },
  };
  const decline = (): void => { declined = true; for (const r of releases) r(); };
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); return Promise.resolve(); },
    url() { return A; },
    getByRole(role: "button", options?: { name?: string | RegExp }) {
      const raw = options?.name ?? "";
      const name = typeof raw === "string" ? raw : "pattern";
      if (name === "Continue without microphone and camera") return mk(name, () => !declined, decline);
      if (name === "Join now") return mk(name, () => declined && !leaveVisible, () => { leaveVisible = true; });
      if (name === "Leave call") return mk(name, () => leaveVisible);
      return mk(name, () => false);
    },
    getByText(text: string) { return text === exp ? owner : mk(text, () => false); },
  };
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: exp, timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
  const t0 = Date.now();
  const r = await driver(page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
  expect(r).toBe(true);
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(gotos).toEqual([SA]);
  expect(clicks).toEqual(["Continue without microphone and camera", "Join now"]);
}, 3000);
function makeTimedFake(pass = true): { page: MeetDriverPage; clicks: string[]; gotos: string[]; show: (k: string) => void; go: (u: string) => void; stick: (k: string) => void } {
  const gotos: string[] = [];
  let at = "";
  const clicks: string[] = [];
  const visible = new Set<string>();
  const stuck = new Set<string>();
  const waiters: Array<() => void> = [];
  const show = (k: string): void => { visible.add(k); for (const w of waiters.splice(0)) w(); };
  const mk = (k: string): MeetDriverLocator => {
    const loc: MeetDriverLocator = {
      waitFor(o?: { timeout?: number }) {
        if (visible.has(k)) return Promise.resolve();
        return new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error("timeout")), o?.timeout ?? 1000);
          waiters.push(() => { if (visible.has(k)) { clearTimeout(t); res(); } });
        });
      },
      count() { return Promise.resolve(visible.has(k) ? 1 : 0); },
      isVisible() { return Promise.resolve(visible.has(k)); },
      click() {
        clicks.push(k);
        if (k === "button:Join now" || k === "menuitem:Join here too") show("button:Leave call");
        if (k.startsWith("button:Turn off ") && !stuck.has(k)) visible.delete(k);
        if (k === "button:Turn off microphone" && !stuck.has(k)) show("button:Turn on microphone");
        if (k === "button:Other ways to join" && !stuck.has(k)) show("menuitem:Join here too");
        if (k === "button:Got it") { visible.delete("button:Got it"); visible.delete("text:Switch the call here"); }
        return Promise.resolve();
      },
      or(o: MeetDriverLocator) { return loc; },
    };
    return loc;
  };
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); at = pass ? land(url) : "https://accounts.google.com/signin"; return Promise.resolve(); },
    url() { return at; },
    getByRole(role: "button" | "link" | "menuitem", options?: { name?: string | RegExp }) {
      const raw = options?.name ?? "";
      const n = typeof raw === "string" ? raw : raw.test("Sign in") ? "Sign in" : raw.test("owner@example.test") ? "owner" : raw.test("Turn on microphone") ? "Turn on microphone" : "?";
      return mk(role + ":" + n);
    },
    getByText(text: string | RegExp) { return mk("text:" + (typeof text === "string" ? text : text.test("You can\u2019t join this video call") ? "cantjoin" : "?")); },
  };
  return { page, clicks, gotos, show, go: (u: string) => { at = u; }, stick: (k: string) => { stuck.add(k); } };
}
it("T11 Getting ready spinner then Ask to join keeps waiting signed out past the grace period", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    const ac = new AbortController();
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, ac.signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    f.show("button:Ask to join");
    await vi.advanceTimersByTimeAsync(40000);
    expect(settled).toBe(false);
    expect(f.clicks).toEqual([]);
    ac.abort();
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T12 Sign in rendered as a link counts as signed out and keeps waiting", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("link:Sign in");
    const ac = new AbortController();
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, ac.signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(40000);
    expect(settled).toBe(false);
    ac.abort();
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T13 unknown page is refused only after the grace period", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(19000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(true);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
it("T14 abort during the grace period closes cleanly", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    const ac = new AbortController();
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000, unrecognizedGraceMs: 30000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, ac.signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(settled).toBe(false);
    ac.abort();
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T15 sign-in URL is ServiceLogin continuing to the approved meeting only", () => {
  expect(SA).toBe("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij");
});
it("T16 waits on accounts past the grace period then joins with the right owner", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake(false);
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(60000);
    expect(settled).toBe(false);
    expect(f.clicks).toEqual([]);
    f.go(A);
    f.show("text:owner@example.test");
    f.show("button:Join now");
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(true);
    expect(await p).toBe(true);
    expect(f.clicks).toEqual(["button:Join now"]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T17 wrong owner on the meeting page is refused without clicking", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:other@example.test");
    f.show("button:Join now");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(22000);
    expect(settled).toBe(true);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T18 can't join this video call page is refused at once", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:cantjoin");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T19 abort on the accounts page closes cleanly", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake(false);
    const ac = new AbortController();
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    let settled = false;
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, ac.signal).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(30000);
    expect(settled).toBe(false);
    ac.abort();
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
    expect(f.gotos).toEqual([SA]);
  } finally {
    vi.useRealTimers();
  }
});
it("T20 mic and camera on at pre-join are turned off before Join", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Join now");
    f.show("button:Turn off microphone");
    f.show("button:Turn off camera");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(true);
    expect(f.clicks).toEqual(["button:Turn off microphone", "button:Turn off camera", "button:Join now"]);
  } finally {
    vi.useRealTimers();
  }
});
it("T21 mute that cannot be confirmed means no join", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Join now");
    f.show("button:Turn off microphone");
    f.stick("button:Turn off microphone");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual(["button:Turn off microphone"]);
  } finally {
    vi.useRealTimers();
  }
});
it("T24 twin-image mode turns only the microphone off, keeps the camera on and never presses Continue without", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Join now");
    f.show("button:Continue without microphone and camera");
    f.show("button:Turn off microphone");
    f.show("button:Turn off camera");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000, cameraMode: "twin-image" });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(true);
    expect(f.clicks).toEqual(["button:Turn off microphone", "button:Join now"]);
  } finally {
    vi.useRealTimers();
  }
});
it("T25 twin-image mode without a confirmed microphone-off indicator does not join", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Join now");
    f.show("button:Turn off camera");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000, cameraMode: "twin-image" });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
it("T22 Switch-here-only page joins via Other ways to join then Join here too", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Switch here");
    f.show("button:Other ways to join");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(true);
    expect(f.clicks).toEqual(["button:Other ways to join", "menuitem:Join here too"]);
    expect(f.clicks).not.toContain("button:Switch here");
  } finally {
    vi.useRealTimers();
  }
});
it("T23 Switch-here-only page without Join here too is refused and Switch here is never clicked", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Switch here");
    f.show("button:Other ways to join");
    f.stick("button:Other ways to join");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual(["button:Other ways to join"]);
    expect(f.clicks).not.toContain("button:Switch here");
  } finally {
    vi.useRealTimers();
  }
});
it("T24 already expanded join list clicks Join here too without Other ways to join", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Switch here");
    f.show("menuitem:Join here too");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(true);
    expect(f.clicks).toEqual(["menuitem:Join here too"]);
    expect(f.clicks).not.toContain("button:Switch here");
  } finally {
    vi.useRealTimers();
  }
});
it("T25 Switch the call here tip is dismissed with Got it only, then Join here too", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Switch here");
    f.show("menuitem:Join here too");
    f.show("text:Switch the call here");
    f.show("button:Got it");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 60000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(true);
    expect(f.clicks).toEqual(["button:Got it", "menuitem:Join here too"]);
    expect(f.clicks).not.toContain("button:Switch here");
  } finally {
    vi.useRealTimers();
  }
});
it("T26 neither Join here too nor Other ways to join is refused without clicking anything", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = makeTimedFake();
    f.show("text:owner@example.test");
    f.show("button:Switch here");
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000, ownerSignInTimeoutMs: 300000 });
    const p = driver(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe(false);
    expect(f.clicks).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
it("T4 owner text on meeting page joins", async () => {
  const exp = "owner@example.test";
  const Aurl = A;
  let loc = "";
  const gotos: string[] = [];
  let joins = 0;
  let leaveVisible = false;
  const page: MeetDriverPage = {
    goto(url: string) { gotos.push(url); loc = land(url); return Promise.resolve(); },
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
  expect(gotos).toEqual([SA]);
  expect(joins).toBe(1);
});
type GuestLobby = "admit" | "refuse" | "hang";
function guestFake(lobby: GuestLobby, cantJoin = false) {
  const gotos: string[] = []; const filled: string[] = []; const clicks: string[] = []; const names: string[] = []; const lobbyTimeouts: number[] = [];
  let micOn = true; let asked = false;
  const loc = (visible: () => boolean, onClick: () => void, wait?: (ms: number) => Promise<void>): MeetGuestLocator => ({
    waitFor(o) {
      if (o?.state === "hidden") return visible() ? Promise.reject(new Error("still visible")) : Promise.resolve();
      if (visible()) return Promise.resolve();
      if (wait) return wait(o?.timeout ?? 0);
      return Promise.reject(new Error("hidden"));
    },
    isVisible() { return Promise.resolve(visible()); },
    click() { onClick(); return Promise.resolve(); },
    fill(v: string) { filled.push(v); return Promise.resolve(); },
  });
  const page: MeetGuestPage = {
    goto(url: string) { gotos.push(url); return Promise.resolve(); },
    url() { return gotos[gotos.length - 1] ?? ""; },
    getByRole(role, o) {
      const n = typeof o.name === "string" ? o.name : o.name.source;
      names.push(n);
      if (role === "textbox") return loc(() => !cantJoin, () => { clicks.push("name box"); });
      if (n === "Turn off microphone") return loc(() => micOn, () => { clicks.push(n); micOn = false; });
      if (n === "Ask to join") return loc(() => !cantJoin, () => { clicks.push(n); asked = true; });
      if (n === "Leave call") return loc(() => asked && lobby === "admit", () => { clicks.push(n); }, (ms) => {
        lobbyTimeouts.push(ms);
        if (lobby !== "hang") return Promise.reject(new Error("hidden"));
        return new Promise<void>((_res, rej) => { setTimeout(() => rej(new Error("timeout")), ms); });
      });
      return loc(() => false, () => { clicks.push(n); });
    },
    getByText() { return loc(() => cantJoin || (asked && lobby === "refuse"), () => {}); },
  };
  return { page, gotos, filled, clicks, names };
}
const forbidden = (names: string[]): string[] => names.filter((n) => /join now|switch here|sign in|gemini/i.test(n));
it("guest join: names without AI twin are refused", () => {
  expect(resolveMeetGuestName()).toBe("Bridgett's AI twin");
  expect(resolveMeetGuestName("  Bridgett's ai TWIN ")).toBe("Bridgett's ai TWIN");
  expect(() => resolveMeetGuestName("Bridgett")).toThrow(/AI twin/);
  expect(() => resolveMeetGuestName("AI twin" + String.fromCharCode(10))).not.toThrow();
  expect(() => resolveMeetGuestName("AI" + String.fromCharCode(7) + " twin")).toThrow();
  expect(() => createGuestMeetDriver({ guestName: "Bridgett's assistant" })).toThrow(/AI twin/);
});
it("guest join: opens the meeting directly, types the name, mutes, and clicks only Ask to join", async () => {
  const f = guestFake("admit");
  const ok = await createGuestMeetDriver({})(f.page, { meetingUrl: A, displayName: "Second Seat AI twin (test)" }, new AbortController().signal);
  expect(ok).toBe(true);
  expect(f.gotos).toEqual([A]);
  expect(f.filled).toEqual(["Bridgett's AI twin"]);
  expect(f.clicks).toEqual(["Turn off microphone", "Ask to join"]);
  expect(forbidden(f.names)).toEqual([]);
});
it("guest join: a /meet/ path for the same code is accepted and another code is refused", async () => {
  const f = guestFake("admit");
  const page: MeetGuestPage = { ...f.page, url: () => "https://meet.google.com/meet/abc-defg-hij" };
  expect(await createGuestMeetDriver({})(page, { meetingUrl: A, displayName: "x" }, new AbortController().signal)).toBe(true);
  const g = guestFake("admit");
  const other: MeetGuestPage = { ...g.page, url: () => "https://meet.google.com/meet/xyz-defg-hij" };
  expect(await createGuestMeetDriver({})(other, { meetingUrl: A, displayName: "x" }, new AbortController().signal)).toBe(false);
  expect(g.clicks).toEqual([]);
});
it("guest join: a can't-join page is refused without asking to join", async () => {
  const f = guestFake("admit", true);
  expect(await createGuestMeetDriver({})(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal)).toBe(false);
  expect(f.clicks).toEqual([]);
  expect(f.filled).toEqual([]);
  const d = guestFake("refuse");
  expect(await createGuestMeetDriver({})(d.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal)).toBe(false);
  expect(d.clicks).toEqual(["Turn off microphone", "Ask to join"]);
  expect(forbidden(d.names)).toEqual([]);
});
it("guest join: waits about 5 minutes in the lobby and then gives up", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = guestFake("hang");
    let done: boolean | null = null;
    const p = createGuestMeetDriver({})(f.page, { meetingUrl: A, displayName: "x" }, new AbortController().signal).then((v) => { done = v; });
    await vi.advanceTimersByTimeAsync(299999);
    expect(done).toBe(null);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(false);
  } finally { vi.useRealTimers(); }
});
it("guest join: abort while waiting in the lobby cleans up the browser", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const f = guestFake("hang");
    let closeCalls = 0;
    const launch = (): Promise<{ newContext(): Promise<{ newPage(): Promise<MeetGuestPage> }>; close(): Promise<void> }> => Promise.resolve({ newContext: () => Promise.resolve({ newPage: () => Promise.resolve(f.page) }), close: () => { closeCalls += 1; return Promise.resolve(); } });
    const transport = createMeetAdmissionBrowser<MeetGuestPage>({ meetingUrl: A, displayName: "Bridgett AI twin (test)" }, { launch, admit: createGuestMeetDriver({}) });
    const ac = new AbortController();
    const p = transport.join(A, "Bridgett AI twin (test)", ac.signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.clicks).toEqual(["Turn off microphone", "Ask to join"]);
    ac.abort();
    expect(await p).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(closeCalls).toBe(1);
  } finally { vi.useRealTimers(); }
});
