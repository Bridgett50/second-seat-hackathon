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
        if (u === "https://meet.google.com/") { await route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body><span>owner@example.test</span></body></html>` }); return; }
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
        if (u === "https://meet.google.com/") { await route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body><span>wrong@example.test</span></body></html>` }); return; }
        await route.abort();
      });
      const r2 = await driver(page, scope, new AbortController().signal);
      expect(r2).toBe(false); expect(traces).toEqual(["https://meet.google.com/"]); expect(page.url()).toBe("https://meet.google.com/");
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
        if (u === "https://meet.google.com/") { await route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body><span>owner@example.test</span></body></html>` }); return; }
        await route.abort();
      });
      const r3 = await driver(page, scope, new AbortController().signal);
      const joins3 = await page.locator("body").getAttribute("data-joins");
      expect(r3).toBe(false); expect(joins3).toBe("0"); expect(traces).toEqual(["https://meet.google.com/", A]); expect(page.url()).toBe(B);
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
  let gotoCount = 0;
  let joinClicks = 0;
  const fakePage = {
    goto: async (u: string) => { gotoCount += 1; url = u; },
    url: () => gotoCount === 1 ? "https://meet.google.com/" : url,
    getByText: () => ({
      waitFor: async () => { if (gotoCount >= 2) url = B; },
      isVisible: async () => true,
    }),
    getByRole: (_role: string, opts: { name: string; exact: boolean }) => {
      if (opts.name === "Continue without microphone and camera") return { count: () => 0 } as unknown as ReturnType<Page["getByRole"]>;
      if (opts.name === "Join now") return { count: () => 1, isVisible: async () => true, click: async () => { joinClicks++; }, waitFor: async () => {} } as unknown as ReturnType<Page["getByRole"]>;
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
  const makePage = () => {
    let gotoCount = 0;
    return ({
      goto: async () => { gotoCount += 1; },
      url: () => gotoCount <= 1 ? "https://meet.google.com/" : A,
    getByText: () => ({ waitFor: async () => {}, isVisible: () => true }),
    getByRole: (_r: unknown, o?: { name?: string }) => {
      if (o?.name === 'Switch here') return { count: () => 1, isVisible: () => true, click: async () => { clicks++; } } as unknown as ReturnType<Page['getByRole']>;
      if (o?.name === 'Continue without microphone and camera') return { count: () => 0 } as unknown as ReturnType<Page['getByRole']>;
      if (o?.name === 'Join now') return { count: () => 0, waitFor: async () => { throw new Error('not visible'); }, or: (other: unknown) => ({ waitFor: async () => {} }) } as unknown as ReturnType<Page['getByRole']>;
      if (o?.name === 'Leave call') return { waitFor: async () => {}, isVisible: () => true } as unknown as ReturnType<Page['getByRole']>;
      return { count: () => 0 } as unknown as ReturnType<Page['getByRole']>;
    },
  }) as unknown as Page;
  };
  const scope = { meetingUrl: A, displayName: 'Owner' };
  const signal = new AbortController().signal;
  const def = createAuthenticatedMeetDriver({ expectedOwnerEmail: 'owner@example.test' });
  expect(await def(makePage(), scope, signal)).toBe(false);
  expect(clicks).toBe(0);
  const allowed = createAuthenticatedMeetDriver({ expectedOwnerEmail: 'owner@example.test', allowOwnerTransfer: true });
  expect(await allowed(makePage(), scope, signal)).toBe(true);
  expect(clicks).toBe(1);
});
it('blocks on Join ready before counting or clicking', async () => {
  let ready = false;
  let clicks = 0;
  let sawWait!: () => void;
  const sawWaitPromise = new Promise<void>((r) => (sawWait = r));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let gotoCount = 0;
  const page = {
    goto: async () => { gotoCount += 1; },
    url: () => gotoCount <= 1 ? "https://meet.google.com/" : A,
    getByText: (text: string, _opts?: { exact?: boolean }) => ({
      waitFor: async () => {},
      isVisible: async () => true,
    }),
    getByRole: (_role: string, opts: { name: string }) => {
      const sel = opts.name;
      if (sel.includes('Join')) return { waitFor: async () => { sawWait(); await gate; ready = true; }, count: async () => (ready ? 1 : 0), isVisible: async () => ready, click: async () => { clicks++; } };
      if (sel.includes('Continue') || sel.includes('Switch')) return { count: async () => 0, isVisible: async () => false };
      if (sel.includes('Leave')) return { waitFor: async () => {}, isVisible: async () => true };
      return { waitFor: async () => {}, count: async () => 0, isVisible: async () => true };
    },
  } as unknown as Page;
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: 'owner@example.test' });
  const scope = { meetingUrl: A, displayName: 'Bridgett AI twin (test)' };
  const signal = new AbortController().signal;
  try {
    const result = driver(page, scope, signal);
    expect(await Promise.race([result.then(() => 'finished'), sawWaitPromise.then(() => 'waiting')])).toBe('waiting');
    expect(clicks).toBe(0);
    release();
    expect(await result).toBe(true);
    expect(clicks).toBe(1);
  } finally { release(); }
});
it('allows only google meet pli=1 without authuser/hash/cross-meeting', async () => {
  const A = 'https://meet.google.com/abc-defg-hij';
  const B = 'https://meet.google.com/xyz-uvwx-zzz';
  const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: 'owner@example.test' });
  const scope = { meetingUrl: A, displayName: 'Bridgett AI twin (test)' };
  const signal = new AbortController().signal;
  const cases: [string, boolean][] = [
    [A + '?pli=1', true],
    [A.replace('com/', 'com/meet/') + '?pli=1', true],
    [A + '?pli=2', false],
    [A + '?pli=1&authuser=other', false],
    [A + '?pli=1#x', false],
    [B + '?pli=1', false],
  ];
  for (const [currentCase, expected] of cases) {
    let clicks = 0;
    let gotoCount = 0;
    const fake = {
      goto: async () => { gotoCount += 1; },
      url: () => gotoCount <= 1 ? "https://meet.google.com/" : currentCase,
      getByText: (_t: string) => ({ waitFor: async () => {}, isVisible: async () => true }),
      getByRole: (role: string, opts?: { name?: string; exact?: boolean }) => {
        const name = opts?.name ?? '';
        if (name === 'Continue without mic and camera' || name === 'Continue without microphone and camera') return { count: async () => 0, isVisible: async () => false, waitFor: async () => {}, click: async () => {} };
        if (name === 'Join now' || name === 'Join') return { count: async () => 1, isVisible: async () => true, waitFor: async () => {}, click: async () => { clicks++; } };
        if (name === 'Leave call' || name === 'Leave') return { waitFor: async () => {}, isVisible: async () => true, count: async () => 0, click: async () => {} };
        return { count: async () => 0, isVisible: async () => false, waitFor: async () => {}, click: async () => {} };
      },
    };
    const result = await driver(fake as unknown as Page, scope, signal);
    expect(result).toBe(expected);
    expect(clicks).toBe(expected ? 1 : 0);
  }
});