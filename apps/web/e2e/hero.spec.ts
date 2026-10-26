import { test, expect } from "@playwright/test";

const DEMO = "/briefs/demo";

test("citation click jumps to the segment and shows it", async ({ page }) => {
  await page.goto(DEMO);
  const link = page.locator('.entry .citations a[href^="#seg-"]').first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await link.click();
  expect(page.url()).toContain(href as string);
  await expect(page.locator(`[id="${(href as string).slice(1)}"]`)).toBeVisible();
});

test("pressure badge href targets an existing segment", async ({ page }) => {
  await page.goto(DEMO);
  const badges = page.locator("a.pressure-badge");
  expect(await badges.count()).toBeGreaterThan(0);
  for (const badge of await badges.all()) {
    const href = await badge.getAttribute("href");
    expect(href).toMatch(/^#seg-/);
    await expect(page.locator(`[id="${(href as string).slice(1)}"]`)).toHaveCount(1);
  }
});

test("copy gating: disabled until reviewed + approved, no requests fired", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(DEMO);
  const nonLocal = requests.filter(
    (u) => !u.startsWith("http://localhost:4173"),
  );
  expect(nonLocal).toEqual([]);

  const copy = page.locator("#btn-copy");
  await expect(copy).toBeDisabled();

  await page.locator(".pressure-review").first().check();
  await expect(copy).toBeDisabled();

  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await expect(copy).toBeDisabled();

  const before = requests.length;
  await page.locator("#btn-approve").click();
  await expect(copy).toBeEnabled();

  await page.locator("#btn-copy").click();
  await expect(page.locator("#draft-note")).toContainText("Copied locally");
  expect(requests.length).toBe(before);
  expect(
    requests.filter((u) => !u.startsWith("http://localhost:4173")),
  ).toEqual([]);
});

test("page works offline after load", async ({ page, context }) => {
  await page.goto(DEMO);
  await expect(page.locator("#transcript-lines li").first()).toBeVisible();
  await context.setOffline(true);
  const link = page.locator('.entry .citations a[href^="#seg-"]').first();
  const href = await link.getAttribute("href");
  await link.click();
  expect(page.url()).toContain(href as string);
  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
});

test("loads with only localhost allowed on the network", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const blocked: string[] = [];
  await context.route("**", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://localhost:4173")) {
      void route.continue();
    } else {
      blocked.push(url);
      void route.abort();
    }
  });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(`http://localhost:4173${DEMO}`);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("#transcript-lines li").first()).toBeVisible();
  expect(blocked).toEqual([]);
  expect(
    requests.filter((u) => !u.startsWith("http://localhost:4173")),
  ).toEqual([]);
  await context.close();
});

test("desktop screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DEMO);
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: "proof/desktop.png", fullPage: true });
});

test("mobile screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1280 });
  await page.goto(DEMO);
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: "proof/mobile-9x16.png", fullPage: true });
});
