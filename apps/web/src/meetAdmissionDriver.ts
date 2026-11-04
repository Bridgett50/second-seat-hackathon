export type MeetDriverLocator = {
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  or(locator: MeetDriverLocator): MeetDriverLocator;
};
export type MeetDriverPage = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  url(): string;
  getByRole(role: "button", options?: { name?: string; exact?: boolean }): MeetDriverLocator;
  getByText(text: string, options?: { exact?: boolean }): MeetDriverLocator;
};
export function createAuthenticatedMeetDriver(opts: { expectedOwnerEmail: string; timeoutMs?: number; allowOwnerTransfer?: boolean; ownerSignInTimeoutMs?: number }) {
  const expectedEmail = opts.expectedOwnerEmail;
  if (typeof expectedEmail !== "string" || expectedEmail.trim() === "" || expectedEmail.length > 320 || /[\x00-\x1F\x7F]/.test(expectedEmail)) {
    throw new Error("invalid expectedOwnerEmail");
  }
  let t = opts.timeoutMs ?? 30000;
  if (!Number.isInteger(t)) t = 30000;
  t = Math.min(60000, Math.max(1000, t));
  const allowTransfer = opts.allowOwnerTransfer === true;
  const timeout = t;
  let ownerSignInTimeoutMs = opts.ownerSignInTimeoutMs ?? timeout;
  if (!Number.isFinite(ownerSignInTimeoutMs) || !Number.isInteger(ownerSignInTimeoutMs) || ownerSignInTimeoutMs <= 0) throw new Error("invalid ownerSignInTimeoutMs");
  ownerSignInTimeoutMs = Math.min(300000, ownerSignInTimeoutMs);
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
    try {
      await page.goto("https://meet.google.com/", { waitUntil: "domcontentloaded", timeout });
      const emailLoc = page.getByText(expectedEmail, { exact: true });
      const signedIn = await waitOrAbort(emailLoc.waitFor({ state: "visible", timeout: ownerSignInTimeoutMs }));
      if (!signedIn) return false;
      if (signal.aborted) return false;
      if (!(await emailLoc.isVisible())) return false;
      const homeUrl = new URL(page.url());
      if (homeUrl.origin !== "https://meet.google.com" || homeUrl.username || homeUrl.password || homeUrl.port) return false;
      await page.goto(approvedUrl, { waitUntil: "domcontentloaded", timeout });
      if (!isApprovedUrl()) return false;
      const cont = page.getByRole("button", { name: "Continue without microphone and camera", exact: true });
      try { await emailLoc.or(cont).waitFor({ state: "visible", timeout }); } catch {}
      if (signal.aborted) return false;
      if ((await cont.count()) === 1 && (await cont.isVisible())) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return false;
        await cont.click();
      }
      if (!(await waitOrAbort(emailLoc.waitFor({ state: "visible", timeout })))) return false;
      if (!(await emailLoc.isVisible())) return false;
      if (signal.aborted) return false;
      let joinBtn = page.getByRole("button", { name: "Join now", exact: true });
      const switchBtn = page.getByRole("button", { name: "Switch here", exact: true });
      if (allowTransfer) {
        await joinBtn.or(switchBtn).waitFor({ state: "visible", timeout });
      } else {
        await joinBtn.waitFor({ state: "visible", timeout });
      }
      if (signal.aborted) return false;
      const cont2 = page.getByRole("button", { name: "Continue without microphone and camera", exact: true });
      if ((await cont2.count()) === 1 && (await cont2.isVisible())) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return false;
        await cont2.click();
      }
      if ((await joinBtn.count()) !== 1 || !(await joinBtn.isVisible())) {
        if (allowTransfer !== true) return false;
        if ((await switchBtn.count()) !== 1) return false;
        if (!(await switchBtn.isVisible())) return false;
        joinBtn = switchBtn;
      }
      if (signal.aborted) return false;
      if (!(await emailLoc.isVisible()) || signal.aborted) return false;
      if (!isApprovedUrl()) return false;
      await joinBtn.click();
      const leaveBtn = page.getByRole("button", { name: "Leave call", exact: true });
      await leaveBtn.waitFor({ state: "visible", timeout });
      if (signal.aborted) return false;
      if (!isApprovedUrl()) return false;
      return await leaveBtn.isVisible();
    } catch {
      return false;
    }
  };
}
