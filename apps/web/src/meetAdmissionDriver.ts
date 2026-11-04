export type MeetDriverLocator = {
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
  or(locator: MeetDriverLocator): MeetDriverLocator;
};
export type MeetDriverPage = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  url(): string;
  getByRole(role: "button" | "link" | "menuitem", options?: { name?: string | RegExp; exact?: boolean }): MeetDriverLocator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): MeetDriverLocator;
};
export function ownerAccountNamePattern(email: string): RegExp {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(<:,])${escaped}($|[\\s)>,])`, "i");
}
export function createAuthenticatedMeetDriver(opts: { expectedOwnerEmail: string; timeoutMs?: number; allowOwnerTransfer?: boolean; ownerSignInTimeoutMs?: number; unrecognizedGraceMs?: number | undefined; cameraMode?: "off" | "twin-image" | undefined }) {
  const expectedEmail = opts.expectedOwnerEmail;
  if (typeof expectedEmail !== "string" || expectedEmail.trim() === "" || expectedEmail.length > 320 || /[\x00-\x1F\x7F]/.test(expectedEmail)) {
    throw new Error("invalid expectedOwnerEmail");
  }
  let t = opts.timeoutMs ?? 30000;
  if (!Number.isInteger(t)) t = 30000;
  t = Math.min(60000, Math.max(1000, t));
  const allowTransfer = opts.allowOwnerTransfer === true;
  // twin-image: keep the camera on (fake twin video), never press "Continue without...", and only turn the microphone off.
  const twin = opts.cameraMode === "twin-image";
  const timeout = t;
  let ownerSignInTimeoutMs = opts.ownerSignInTimeoutMs ?? timeout;
  if (!Number.isFinite(ownerSignInTimeoutMs) || !Number.isInteger(ownerSignInTimeoutMs) || ownerSignInTimeoutMs <= 0) throw new Error("invalid ownerSignInTimeoutMs");
  ownerSignInTimeoutMs = Math.min(300000, ownerSignInTimeoutMs);
  const graceMs = opts.unrecognizedGraceMs ?? 20000;
  if (!Number.isInteger(graceMs) || graceMs <= 0 || graceMs > 300000) throw new Error("invalid unrecognizedGraceMs");
  const scopeRe = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
  return async (page: MeetDriverPage, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal): Promise<boolean> => {
    const approvedUrl = scope.meetingUrl;
    if (signal.aborted) return false;
    if (!scopeRe.test(approvedUrl)) return false;
    const approvedCode = new URL(approvedUrl).pathname.slice(1);
    const approvedTarget = new URL(approvedUrl);
  const isApprovedUrl = () => {
    const u = new URL(page.url());
    return u.origin === "https://meet.google.com" && !u.username && !u.password && !u.port && (u.search === approvedTarget.search || (approvedTarget.search === "" && u.search === "?pli=1")) && u.hash === approvedTarget.hash && (u.pathname === `/${approvedCode}` || u.pathname === `/meet/${approvedCode}`);
  };
    const waitOrAbort = (p: Promise<void>): Promise<boolean> => {
      if (signal.aborted) {
        p.catch(() => {});
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          p.catch(() => {});
          resolve(false);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        p.then(() => {
          signal.removeEventListener("abort", onAbort);
          resolve(true);
        }, () => {
          signal.removeEventListener("abort", onAbort);
          resolve(false);
        });
      });
    };
    // Pre-join failures log one step tag (never an email or caption text); pre-join clicks give up after 5 s.
    let step = "goto";
    const clickMs = 5000;
    const fail = (tag: string): false => { console.warn("[meet-step] failed: " + tag); return false; };
    try {
      const signInUrl = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(approvedUrl)}`;
      await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout });
      const emailLoc = page.getByText(expectedEmail, { exact: true });
      const ownerText = emailLoc;
      const ownerBtn = page.getByRole("button", { name: ownerAccountNamePattern(expectedEmail) });
      const cont = page.getByRole("button", { name: "Continue without microphone and camera", exact: true });
      const signInBtn = page.getByRole("button", { name: /^\s*sign in\b/i });
      const signInLink = page.getByRole("link", { name: /^\s*sign in\b/i });
      const askBtn = page.getByRole("button", { name: "Ask to join", exact: true });
      const cantJoin = page.getByText(/you can['\u2019]t join this video call/i);
      const shown = async (l: MeetDriverLocator): Promise<boolean> => {
        try { return (await l.count()) > 0 && (await l.isVisible()); } catch { return false; }
      };
      const deadline = Date.now() + ownerSignInTimeoutMs;
      let lastSeen = Date.now();
      const firstVisible = (a: MeetDriverLocator, b: MeetDriverLocator, left: number): Promise<void> => {
        const p1 = Promise.resolve().then(() => a.waitFor({ state: "visible", timeout: left }));
        const p2 = Promise.resolve().then(() => b.waitFor({ state: "visible", timeout: left }));
        return Promise.any([p1, p2]).then(() => undefined);
      };
      const firstOf = (ls: MeetDriverLocator[], left: number): Promise<number> => Promise.any(ls.map((l, i) => Promise.resolve().then(() => l.waitFor({ state: "visible", timeout: left })).then(() => i))).catch(() => -1);
      const pause = (ms: number): Promise<boolean> => {
        if (signal.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          const t = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve(true);
          }, ms);
          const onAbort = (): void => {
            clearTimeout(t);
            signal.removeEventListener("abort", onAbort);
            resolve(false);
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      };
      while (true) {
        if (signal.aborted) return false;
        const left = deadline - Date.now();
        if (left <= 0) return false;
        if (!isApprovedUrl()) lastSeen = Date.now();
        let won = -1;
        await waitOrAbort(firstOf([ownerText, ownerBtn, cont, signInBtn, askBtn, signInLink, cantJoin], Math.min(left, 2000)).then((i) => { won = i; }));
        if (signal.aborted) return false;
        if (await shown(cantJoin)) return false;
        if (won === 0 || won === 1) {
          let vt = false;
          try { vt = await ownerText.isVisible(); } catch { vt = false; }
          let vb = false;
          try { vb = await ownerBtn.isVisible(); } catch { vb = false; }
          if (isApprovedUrl() && (vt || vb)) break;
        } else if (isApprovedUrl()) {
          if (!twin && (await shown(cont))) {
            if (signal.aborted) return false;
            step = "cont.click";
            await cont.click({ timeout: clickMs });
            continue;
          }
          if ((await shown(signInBtn)) || (await shown(signInLink)) || (await shown(askBtn)) || (twin && (await shown(cont)))) lastSeen = Date.now();
          else if (Date.now() - lastSeen >= graceMs) return false;
        }
        const remain = deadline - Date.now();
        if (remain <= 0) return false;
        if (signal.aborted) return false;
        const ms = Math.min(250, Math.max(1, remain));
        const ok = await pause(ms);
        if (!ok) return false;
      }
      if (!isApprovedUrl()) return false;
      try { await Promise.any([Promise.resolve().then(() => emailLoc.or(cont).waitFor({ state: "visible", timeout })), Promise.resolve().then(() => ownerBtn.waitFor({ state: "visible", timeout }))]); } catch {}
      if (signal.aborted) return false;
      if (!twin && (await cont.count()) === 1 && (await cont.isVisible())) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return fail("urlRecheck");
        step = "cont.click";
        await cont.click({ timeout: clickMs });
      }
      if (!(await waitOrAbort(firstVisible(ownerText, ownerBtn, timeout)))) return fail("ownerCheck");
      let mt = false; try { mt = await ownerText.isVisible(); } catch { mt = false; }
      let mb = false; try { mb = await ownerBtn.isVisible(); } catch { mb = false; }
      if (!mt && !mb) return fail("ownerCheck");
      if (signal.aborted) return false;
      let joinBtn = page.getByRole("button", { name: "Join now", exact: true });
      const switchBtn = page.getByRole("button", { name: "Switch here", exact: true });
      const otherWays = page.getByRole("button", { name: "Other ways to join", exact: true });
      step = "joinOptions.wait";
      if (allowTransfer) {
        await joinBtn.or(switchBtn).waitFor({ state: "visible", timeout });
      } else {
        // An already expanded join list (Join here too) or a collapsed one (Other ways to join) also counts as ready.
        const joinHereMenu = page.getByRole("menuitem", { name: "Join here too", exact: true });
        const joinHereButton = page.getByRole("button", { name: "Join here too", exact: true });
        if ((await firstOf([joinBtn, switchBtn, joinHereMenu, joinHereButton, otherWays], timeout)) < 0) return fail("joinOptions.wait");
      }
      if (signal.aborted) return false;
      const cont2 = page.getByRole("button", { name: "Continue without microphone and camera", exact: true });
      if (!twin && (await cont2.count()) === 1 && (await cont2.isVisible())) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return fail("urlRecheck");
        step = "cont2.click";
        await cont2.click({ timeout: clickMs });
      }
      if ((await joinBtn.count()) !== 1 || !(await joinBtn.isVisible())) {
        if (allowTransfer === true && (await shown(switchBtn))) {
          joinBtn = switchBtn;
        } else {
          const joinHere = page.getByRole("menuitem", { name: "Join here too", exact: true }).or(page.getByRole("button", { name: "Join here too", exact: true }));
          // Meet can show a "Switch the call here" tip over the join list; dismiss only that tip's own "Got it" button.
          const switchTip = page.getByText("Switch the call here", { exact: false });
          const gotIt = page.getByRole("button", { name: "Got it", exact: true });
          if ((await shown(switchTip)) && (await gotIt.count()) === 1 && (await gotIt.isVisible())) {
            if (signal.aborted || !isApprovedUrl()) return false;
            step = "gotIt.click";
            await gotIt.click({ timeout: clickMs });
          }
          if (signal.aborted) return false;
          // Meet can remember the expanded join list ("Show fewer options"); then Join here too is already visible.
          if (!(await shown(joinHere))) {
            if (!(await shown(otherWays))) return fail("joinList");
            if (signal.aborted || !isApprovedUrl()) return false;
            step = "otherWays.click";
            await otherWays.click({ timeout: clickMs });
            if (!(await waitOrAbort(joinHere.waitFor({ state: "visible", timeout })))) return fail("joinHere.wait");
          }
          if (!(await shown(joinHere))) return fail("joinHere.visible");
          if (signal.aborted || !isApprovedUrl()) return false;
          joinBtn = joinHere;
        }
      }
      const micOff = page.getByRole("button", { name: "Turn off microphone" });
      const camOff = page.getByRole("button", { name: "Turn off camera" });
      const micMuted = page.getByRole("button", { name: /^turn on microphone|microphone.*(blocked|problem|permission needed|not (found|allowed))/i });
      if (await shown(micOff)) {
        if (signal.aborted || !isApprovedUrl()) return false;
        step = "micOff.click";
        await micOff.click({ timeout: clickMs });
      }
      if (!twin && (await shown(camOff))) {
        if (signal.aborted || !isApprovedUrl()) return false;
        step = "camOff.click";
        await camOff.click({ timeout: clickMs });
      }
      if (!(await pause(500))) return false;
      if ((await shown(micOff)) || (!twin && (await shown(camOff)))) return fail("micOff.confirm");
      if (twin && !(await shown(micMuted))) return fail("micOff.confirm");
      if (signal.aborted) return false;
      let ft = false; try { ft = await ownerText.isVisible(); } catch { ft = false; }
      let fb = false; try { fb = await ownerBtn.isVisible(); } catch { fb = false; }
      if (signal.aborted) return false;
      if (!ft && !fb) return fail("ownerCheck");
      if (!isApprovedUrl()) return fail("urlRecheck");
      step = "joinHere.click";
      await joinBtn.click({ timeout: clickMs });
      const leaveBtn = page.getByRole("button", { name: "Leave call", exact: true });
      step = "leave.wait";
      await leaveBtn.waitFor({ state: "visible", timeout });
      if (signal.aborted) return false;
      if (!isApprovedUrl()) return false;
      return await leaveBtn.isVisible();
    } catch (e) {
      // Only the step tag and the error name are logged; the error message could contain an email.
      return fail(step + " (" + (e instanceof Error ? e.name : "unknown") + ")");
    }
  };
}
// Guest join: the twin joins as a visible guest named as an AI twin, and the owner admits it from the lobby.
export const DEFAULT_MEET_GUEST_NAME = "Bridgett's AI twin";
export function resolveMeetGuestName(name?: string): string {
  const n = name === undefined || name.trim() === "" ? DEFAULT_MEET_GUEST_NAME : name.trim();
  if (n.length > 60) throw new Error("Meet guest name is too long");
  for (let i = 0; i < n.length; i++) { const c = n.charCodeAt(i); if (c < 32 || c === 127) throw new Error("Meet guest name has a control character"); }
  if (!n.toLowerCase().includes("ai twin")) throw new Error("Meet guest name must say AI twin");
  return n;
}
export type MeetGuestLocator = {
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
};
export type MeetGuestPage = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  url(): string;
  getByRole(role: "button" | "textbox", options: { name: string | RegExp; exact?: boolean }): MeetGuestLocator;
  getByText(text: RegExp): MeetGuestLocator;
};
// Opens the approved meeting link directly (no Google sign-in), types the guest name, keeps the microphone and camera off,
// clicks only "Ask to join", then waits in the lobby until the owner admits it. It never clicks Join now, Switch here, Sign in or Gemini.
export function createGuestMeetDriver(opts: { guestName?: string; timeoutMs?: number; lobbyTimeoutMs?: number }) {
  const guestName = resolveMeetGuestName(opts.guestName);
  const timeout = opts.timeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 60000) throw new Error("invalid timeoutMs");
  const lobbyMs = opts.lobbyTimeoutMs ?? 300000;
  if (!Number.isInteger(lobbyMs) || lobbyMs <= 0 || lobbyMs > 600000) throw new Error("invalid lobbyTimeoutMs");
  return async (page: MeetGuestPage, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return false;
    let target: URL;
    try { target = new URL(scope.meetingUrl); } catch { return false; }
    const code = target.pathname.slice(1);
    if (target.href !== scope.meetingUrl || target.origin !== "https://meet.google.com" || target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== "" || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return false;
    const onMeet = (): boolean => {
      try { const u = new URL(page.url()); return u.origin === "https://meet.google.com" && u.username === "" && u.password === "" && (u.pathname === "/" + code || u.pathname === "/meet/" + code); } catch { return false; }
    };
    const shown = async (l: MeetGuestLocator): Promise<boolean> => {
      try { return await l.isVisible(); } catch { return false; }
    };
    // Index of the first locator that becomes visible, or -1 on timeout or abort.
    const firstOf = (ls: MeetGuestLocator[], ms: number): Promise<number> => {
      if (signal.aborted) return Promise.resolve(-1);
      return new Promise<number>((done) => {
        const onAbort = (): void => { done(-1); };
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.any(ls.map((l, i) => Promise.resolve().then(() => l.waitFor({ state: "visible", timeout: ms })).then(() => i))).then(
          (i) => { signal.removeEventListener("abort", onAbort); done(i); },
          () => { signal.removeEventListener("abort", onAbort); done(-1); }
        );
      });
    };
    const refused = page.getByText(/can.t join this video call|denied your request|removed from the (call|meeting)|no one responded/i);
    try {
      await page.goto(scope.meetingUrl, { waitUntil: "domcontentloaded", timeout });
      if (signal.aborted || !onMeet()) return false;
      const nameBox = page.getByRole("textbox", { name: /your name/i });
      if ((await firstOf([nameBox, refused], timeout)) !== 0) return false;
      if (signal.aborted || (await shown(refused)) || !onMeet()) return false;
      await nameBox.fill(guestName);
      const micOff = page.getByRole("button", { name: "Turn off microphone", exact: true });
      const camOff = page.getByRole("button", { name: "Turn off camera", exact: true });
      for (const l of [micOff, camOff]) {
        if (!(await shown(l))) continue;
        if (signal.aborted || !onMeet()) return false;
        await l.click();
        await l.waitFor({ state: "hidden", timeout });
      }
      if ((await shown(micOff)) || (await shown(camOff))) return false;
      const askBtn = page.getByRole("button", { name: "Ask to join", exact: true });
      if ((await firstOf([askBtn, refused], timeout)) !== 0) return false;
      if (signal.aborted || (await shown(refused)) || !onMeet()) return false;
      await askBtn.click();
      const leaveBtn = page.getByRole("button", { name: "Leave call", exact: true });
      if ((await firstOf([leaveBtn, refused], lobbyMs)) !== 0) return false;
      if (signal.aborted || (await shown(refused)) || !onMeet()) return false;
      return await shown(leaveBtn);
    } catch {
      return false;
    }
  };
}
