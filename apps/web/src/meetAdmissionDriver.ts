import type { Page } from "@playwright/test";
export function createAuthenticatedMeetDriver(opts: { expectedOwnerEmail: string; timeoutMs?: number; allowOwnerTransfer?: boolean }) {
  const expectedEmail = opts.expectedOwnerEmail;
  if (typeof expectedEmail !== "string" || expectedEmail.trim() === "" || expectedEmail.length > 320 || /[\x00-\x1F\x7F]/.test(expectedEmail)) {
    throw new Error("invalid expectedOwnerEmail");
  }
  let t = opts.timeoutMs ?? 30000;
  if (!Number.isInteger(t)) t = 30000;
  t = Math.min(60000, Math.max(1000, t));
  const allowTransfer = opts.allowOwnerTransfer === true;
  const timeout = t;
  const scopeRe = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
  return async (page: Page, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal): Promise<boolean> => {
    const approvedUrl = scope.meetingUrl;
    if (signal.aborted) return false;
    if (!scopeRe.test(approvedUrl)) return false;
    const approvedCode = new URL(approvedUrl).pathname.slice(1);
    const approvedTarget = new URL(approvedUrl);
  const isApprovedUrl = () => {
    const u = new URL(page.url());
    return u.origin === "https://meet.google.com" && !u.username && !u.password && !u.port && (u.search === approvedTarget.search || (approvedTarget.search === "" && u.search === "?pli=1")) && u.hash === approvedTarget.hash && (u.pathname === `/${approvedCode}` || u.pathname === `/meet/${approvedCode}`);
  };
    try {
      await page.goto(approvedUrl, { waitUntil: "domcontentloaded", timeout });
      if (!isApprovedUrl()) return false;
      const cont = page.getByRole("button", { name: "Continue without microphone and camera", exact: true });
      if ((await cont.count()) === 1 && (await cont.isVisible())) {
        if (signal.aborted) return false;
        await cont.click();
      }
      const emailLoc = page.getByText(expectedEmail, { exact: true });
      await emailLoc.waitFor({ state: "visible", timeout });
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
        await cont2.click();
      }
      if ((await joinBtn.count()) !== 1 || !(await joinBtn.isVisible())) {
        if (allowTransfer !== true) return false;
        if ((await switchBtn.count()) !== 1) return false;
        if (!(await switchBtn.isVisible())) return false;
        joinBtn = switchBtn;
      }
      if (signal.aborted) return false;
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
