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

const HERO_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 720, height: 1280 },
];

for (const vp of HERO_VIEWPORTS) {
  test(`hero above the fold at ${vp.width}x${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await page.goto(`${DEMO}?static=1`);
    await expect(page.locator(".replay-label")).toContainText(
      "Replay of recorded brief",
    );
    for (const sel of ["#conflict", "a.pressure-badge", "#draft-status"]) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box).not.toBeNull();
      expect((box as { y: number; height: number }).y + (box as { y: number; height: number }).height).toBeLessThanOrEqual(
        vp.height,
      );
    }
    const fitsWidth = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    expect(fitsWidth).toBe(true);
    const chip = page.locator('[data-stage="glimmer-redact"]');
    await expect(chip).toHaveAttribute("data-status", "live");
    await expect(chip).toContainText(/recall \d+\/\d+/);
  });
}

test("desktop screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${DEMO}?static=1`);
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: "proof/desktop.png", fullPage: false });
});

test("mobile screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1280 });
  await page.goto(`${DEMO}?static=1`);
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: "proof/mobile-9x16.png", fullPage: false });
});

test("one badge per pressure id, held count matches checkboxes", async ({
  page,
}) => {
  await page.goto(`${DEMO}?static=1`);
  const badgeTexts = await page.locator("a.pressure-badge").allTextContents();
  expect(badgeTexts.length).toBeGreaterThan(0);
  expect(new Set(badgeTexts).size).toBe(badgeTexts.length);
  const boxCount = await page.locator(".pressure-review").count();
  expect(boxCount).toBe(badgeTexts.length);
  const status = await page.locator("#draft-status").textContent();
  const expected =
    boxCount === 1
      ? `Held: review the 1 pressure item first`
      : `Held: review the ${boxCount} pressure items first`;
  expect(status).toBe(expected);
});

test("scores and badges are consistent", async ({ page }) => {
  await page.goto(`${DEMO}?static=1`);
  await expect(page.locator("#scores-seeded")).toContainText("9/9");
  const chip = page.locator('[data-stage="glimmer-redact"]');
  await expect(chip).toContainText("(n=10)");
  await expect(chip).not.toContainText("0/39");
  const badgeTexts = await page.locator("a.pressure-badge").allTextContents();
  expect(badgeTexts.length).toBeGreaterThan(0);
  expect(new Set(badgeTexts).size).toBe(badgeTexts.length);
  const status = await page.locator("#draft-status").textContent();
  const m = status?.match(/review the (\d+) pressure/);
  expect(m).not.toBeNull();
  expect(Number((m as RegExpMatchArray)[1])).toBe(badgeTexts.length);
});

test("Scores card visible above the fold at 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${DEMO}?static=1`);
  const scores = page.locator("#scores");
  await expect(scores).toBeVisible();
  const box = await scores.boundingBox();
  expect(box).not.toBeNull();
  expect((box as { y: number; height: number }).y).toBeGreaterThanOrEqual(0);
  expect(
    (box as { y: number; height: number }).y +
      (box as { y: number; height: number }).height,
  ).toBeLessThanOrEqual(800);
  await expect(page.locator("#scores-glimmer")).toContainText(
    /Glimmer recall \d+\/\d+/,
  );
});
