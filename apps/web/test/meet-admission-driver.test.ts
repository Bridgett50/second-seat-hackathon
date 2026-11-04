import { it, expect } from "vitest";
import { chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { createAuthenticatedMeetDriver } from "../src/meetAdmissionDriver.js";
const A = "https://meet.google.com/abc-defg-hij";
const B = "https://meet.google.com/xxx-yyyy-zzz";
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
function html(email: string): string {
  return `<!doctype html><html><body data-joins="0"><span>${email}</span><button>Join now</button><script>const b=document.querySelector("button");b&&b.addEventListener("click",()=>{document.body.dataset.joins="1";const n=document.createElement("button");n.textContent="Leave call";document.body.appendChild(n)});<\/script></body></html>`;
}
it("synthetic admission with redirect regression", async () => {
  const browser = await chromium.launch({ headless: true, timeout: 10000, ...(chromePath !== undefined ? { executablePath: chromePath } : {}) });
  try {
    const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: "owner@example.test", timeoutMs: 1000 });
    const scope = { meetingUrl: A, displayName: "Bridgett AI twin" };
    const correct = html("owner@example.test");
    const wrong = html("wrong@example.test");
    let page: Page;
    let ctx;
    ctx = await browser.newContext();
    page = await ctx.newPage();
    {
      const traces: string[] = [];
      await page.route("**/*", async (route) => {
        const u = route.request().url();
        traces.push(u);
        if (u === A) { await route.fulfill({ status: 200, contentType: "text/html", body: correct }); return; }
        await route.abort();
      });
      const r1 = await driver(page, scope, new AbortController().signal);
      const joins1 = await page.locator("body").getAttribute("data-joins");
      const leave1 = await page.getByRole("button", { name: "Leave call", exact: true }).isVisible();
      expect(r1).toBe(true); expect(joins1).toBe("1"); expect(leave1).toBe(true); expect(traces).toContain(A);
      await ctx.close();
    }
    ctx = await browser.newContext();
    page = await ctx.newPage();
    {
      const traces: string[] = [];
      await page.route("**/*", async (route) => {
        const u = route.request().url();
        traces.push(u);
        if (u === A) { await route.fulfill({ status: 200, contentType: "text/html", body: wrong }); return; }
        await route.abort();
      });
      const r2 = await driver(page, scope, new AbortController().signal);
      const joins2 = await page.locator("body").getAttribute("data-joins");
      expect(r2).toBe(false); expect(joins2).toBe("0"); expect(traces).toContain(A);
      await ctx.close();
    }
    ctx = await browser.newContext();
    page = await ctx.newPage();
    {
      const traces: string[] = [];
      const correctWithRedirect = `<!doctype html><html><body data-joins="0"><span>owner@example.test</span><button>Join now</button><script>history.replaceState(null,'','/xxx-yyyy-zzz');const b=document.querySelector("button");b&&b.addEventListener("click",()=>{document.body.dataset.joins="1";const n=document.createElement("button");n.textContent="Leave call";document.body.appendChild(n)});<\/script></body></html>`;
      await page.route("**/*", async (route) => {
        const u = route.request().url();
        traces.push(u);
        if (u === A) { await route.fulfill({ status: 200, contentType: "text/html", body: correctWithRedirect }); return; }
        await route.abort();
      });
      const r3 = await driver(page, scope, new AbortController().signal);
      const joins3 = await page.locator("body").getAttribute("data-joins");
      expect(r3).toBe(false); expect(joins3).toBe("0"); expect(traces).toEqual([A]); expect(page.url()).toBe(B);
      await ctx.close();
    }
    ctx = await browser.newContext();
    page = await ctx.newPage();
    {
      const traces: string[] = [];
      await page.route("**/*", async (route) => { traces.push(route.request().url()); await route.abort(); });
      const c = new AbortController(); c.abort();
      const r4 = await driver(page, scope, c.signal);
      expect(r4).toBe(false); expect(traces.length).toBe(0);
      await ctx.close();
    }
  } finally { await browser.close(); }
}, 25000);

it("regression: email wait that navigates to different meeting must not join", async () => {
  let url = "";
  let joinClicks = 0;
  const fakePage = {
    goto: async () => { url = A; },
    url: () => url,
    getByText: () => ({
      waitFor: async () => { url = B; },
      isVisible: async () => true,
    }),
    getByRole: (_role: string, opts: { name: string; exact: boolean }) => {
      if (opts.name === "Continue without microphone and camera") return { count: () => 0 } as unknown as ReturnType<Page["getByRole"]>;
      if (opts.name === "Join now") return { count: () => 1, isVisible: async () => true, click: async () => { joinClicks++; } } as unknown as ReturnType<Page["getByRole"]>;
      if (opts.name === "Leave call") return { waitFor: async () => {}, isVisible: async () => true } as unknown as ReturnType<Page["getByRole"]>;
      return { count: () => 0 } as unknown as ReturnType<Page["getByRole"]>;
    },
  };
  const driver = createAuthenticatedMeetDriver({expectedOwnerEmail: "owner@example.test"});
  const result = await driver(fakePage as unknown as Page, {meetingUrl: A, displayName: 'Bridgett AI twin (test)'}, new AbortController().signal);
  expect(result).toBe(false);
  expect(joinClicks).toBe(0);
});
it('regression: explicit owner transfer permission required to click Switch here', async () => {
  let clicks = 0;
  const makePage = () => ({
    goto: async () => {},
    url: () => A,
    getByText: () => ({ waitFor: async () => {}, isVisible: () => true }),
    getByRole: (_r: unknown, o?: { name?: string }) => {
      if (o?.name === 'Switch here') return { count: () => 1, isVisible: () => true, click: async () => { clicks++; } } as unknown as ReturnType<Page['getByRole']>;
      if (o?.name === 'Continue without microphone and camera') return { count: () => 0 } as unknown as ReturnType<Page['getByRole']>;
      if (o?.name === 'Join now') return { count: () => 0 } as unknown as ReturnType<Page['getByRole']>;
      if (o?.name === 'Leave call') return { waitFor: async () => {}, isVisible: () => true } as unknown as ReturnType<Page['getByRole']>;
      return { count: () => 0 } as unknown as ReturnType<Page['getByRole']>;
    },
  }) as unknown as Page;
  const scope = { meetingUrl: A, displayName: 'Owner' };
  const signal = new AbortController().signal;
  const def = createAuthenticatedMeetDriver({ expectedOwnerEmail: 'owner@example.test' });
  expect(await def(makePage(), scope, signal)).toBe(false);
  expect(clicks).toBe(0);
  const allowed = createAuthenticatedMeetDriver({ expectedOwnerEmail: 'owner@example.test', allowOwnerTransfer: true });
  expect(await allowed(makePage(), scope, signal)).toBe(true);
  expect(clicks).toBe(1);
});