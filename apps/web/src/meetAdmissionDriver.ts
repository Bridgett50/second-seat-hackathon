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
  getByRole(role: "button", options?: { name?: string | RegExp; exact?: boolean }): MeetDriverLocator;
  getByText(text: string, options?: { exact?: boolean }): MeetDriverLocator;
};
export function ownerAccountNamePattern(email: string): RegExp {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(<:,])${escaped}($|[\\s)>,])`, "i");
}
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
      await page.goto(approvedUrl, { waitUntil: "domcontentloaded", timeout });
      const emailLoc = page.getByText(expectedEmail, { exact: true });
      const ownerText = emailLoc;
      const ownerBtn = page.getByRole("button", { name: ownerAccountNamePattern(expectedEmail) });
      const cont = page.getByRole("button", { name: "Continue without microphone and camera", exact: true });
      const signInBtn = page.getByRole("button", { name: /^\s*sign in\b/i });
      const askBtn = page.getByRole("button", { name: "Ask to join", exact: true });
      const shown = async (l: MeetDriverLocator): Promise<boolean> => {
        try { return (await l.count()) > 0 && (await l.isVisible()); } catch { return false; }
      };
      const deadline = Date.now() + ownerSignInTimeoutMs;
      const firstVisible = (a: MeetDriverLocator, b: MeetDriverLocator, left: number): Promise<void> => {
        const p1 = Promise.resolve().then(() => a.waitFor({ state: "visible", timeout: left }));
        const p2 = Promise.resolve().then(() => b.waitFor({ state: "visible", timeout: left }));
        return Promise.any([p1, p2]).then(() => undefined);
      };
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
        const seen = await waitOrAbort(firstVisible(ownerText, ownerBtn, Math.min(left, 10000)));
        if (signal.aborted) return false;
        if (seen) {
          let vt = false;
          try { vt = await ownerText.isVisible(); } catch { vt = false; }
          let vb = false;
          try { vb = await ownerBtn.isVisible(); } catch { vb = false; }
          if (isApprovedUrl() && (vt || vb)) break;
        } else if (isApprovedUrl()) {
          if (await shown(cont)) {
            if (signal.aborted) return false;
            await cont.click();
            continue;
          }
          if (!(await shown(signInBtn)) && !(await shown(askBtn))) return false;
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
      if ((await cont.count()) === 1 && (await cont.isVisible())) {
        if (signal.aborted) return false;
        if (!isApprovedUrl()) return false;
        await cont.click();
      }
      if (!(await waitOrAbort(firstVisible(ownerText, ownerBtn, timeout)))) return false;
      let mt = false; try { mt = await ownerText.isVisible(); } catch { mt = false; }
      let mb = false; try { mb = await ownerBtn.isVisible(); } catch { mb = false; }
      if (!mt && !mb) return false;
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
      let ft = false; try { ft = await ownerText.isVisible(); } catch { ft = false; }
      let fb = false; try { fb = await ownerBtn.isVisible(); } catch { fb = false; }
      if ((!ft && !fb) || signal.aborted) return false;
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
