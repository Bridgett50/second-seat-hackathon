/**
 * FR9: offline paste-to-copy of demo/synthetic-transcript.txt.
 * No provider. Counts analyzer callbacks.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const TRANSCRIPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "demo", "synthetic-transcript.txt"),
  "utf8",
);
const PHONE = "555-013-8844";
const EMAIL = "ellis.ward@northglass-retail.example";
const DRAFT = "Please send a corrected written quote. I have not accepted the deadline.";

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await page.goto("/session?demo=1");
  return (await (await resp).json()).sessionId as string;
}

async function outbound(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/test/outbound");
  expect(res.ok()).toBe(true);
  return ((await res.json()).analyzerCalls ?? []) as string[];
}

function foreignHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return null;
  return host;
}

test("FR9 offline synthetic transcript reaches copy without a provider call", async ({ page, context }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    requested.push(request.url());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const bag = window as unknown as { __writes: string[] };
    bag.__writes = [];
    const wrap = () => {
      const clip = navigator.clipboard;
      if (!clip || (clip.writeText as unknown as { __fr9?: boolean }).__fr9) return;
      const orig = clip.writeText.bind(clip);
      const wrapped = (text: string) => {
        bag.__writes.push(text);
        return orig(text);
      };
      (wrapped as unknown as { __fr9: boolean }).__fr9 = true;
      clip.writeText = wrapped;
    };
    wrap();
  });
  const id = await open(page);
  await expect(page.locator("#offline-label")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/demo/);
  const before = await outbound(page);

  await page.locator("#transcript-input").fill(TRANSCRIPT);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  const preview = page.locator("#redacted-text");
  const masked = await preview.inputValue();
  expect(masked).not.toContain(PHONE);
  expect(masked).not.toContain("Ellis Ward");
  expect(masked).not.toContain("Amira Solano");
  expect(masked).toContain(EMAIL);

  await page.locator("#btn-approve").click();
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toHaveText(
    "Review required — check the redacted preview, then approve.",
    { timeout: 15000 },
  );
  const leaked = (await outbound(page)).slice(before.length);
  expect(leaked.some((call) => call.includes(EMAIL) || call.includes(PHONE))).toBe(false);
  expect(await page.locator("#draft-text").inputValue()).toBe("");
  await expect(page.locator("#btn-copy")).toBeDisabled();
  const blockedRes = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  expect(blockedRes.ok()).toBe(true);
  const blocked = await blockedRes.json();
  expect(blocked.state).toBe("review_required");
  expect(blocked.result).toBeNull();
  expect(blocked.verification?.blocked).toBe(true);

  const corrected = masked.split(EMAIL).join("[REDACTED_email]");
  await preview.fill(corrected);
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Completed", { timeout: 15000 });
  const sent = (await outbound(page)).slice(before.length);
  expect(sent).toEqual([corrected]);
  expect(sent[0]).not.toContain(PHONE);
  expect(sent[0]).not.toContain(EMAIL);
  expect(sent[0]).not.toContain("Ellis Ward");

  const stateRes = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  const snap = await stateRes.json();
  expect(snap.result.entries).toHaveLength(2);
  expect(snap.pressure.items).toHaveLength(0);
  expect(snap.verification.status).toBe("needs_owner_review");
  expect(snap.verification.checks.find((c: { id: string }) => c.id === "claims").result).toBe("not_run");
  expect(snap.verification.message).toContain("Claim support not checked.");
  await expect(page.locator("#verification-title")).toHaveText("Needs owner review");

  const links = page.locator("#results .citations a");
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    const href = await links.nth(i).getAttribute("href");
    expect(href).toBeTruthy();
    await expect(page.locator(href!)).toHaveCount(1);
    await links.nth(i).click();
  }

  await page.locator("#draft-text").fill(DRAFT);
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-copy").click();
  const writes = await page.evaluate(() => (window as unknown as { __writes?: string[] }).__writes ?? []);
  const readback = await page.evaluate(() => navigator.clipboard.readText());
  expect(writes).toEqual([DRAFT]);
  expect(readback).toBe(DRAFT);
  const sameRes = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  expect(sameRes.ok()).toBe(true);
  const same = await sameRes.json();
  expect(same.state).toBe("completed");
  expect(same.draft?.text).toBe(DRAFT);
  expect(same.draft?.approved).toBe(true);
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.map(foreignHost).filter((host) => host !== null)).toEqual([]);

  await page.locator("#draft-text").fill(`${DRAFT} extra`);
  await expect(page.locator("#btn-copy")).toBeDisabled();
});
