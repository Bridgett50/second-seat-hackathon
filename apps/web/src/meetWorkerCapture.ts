import { chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep, win32 } from "node:path";
import { createAuthenticatedMeetDriver, createGuestMeetDriver, resolveMeetGuestName } from "./meetAdmissionDriver.js";
import { createMeetAdmissionBrowser, type MeetProofBrowser } from "./meetAdmissionBrowser.js";
import { createMeetAdmissionProof, type MeetAdmissionTransport } from "./meetAdmissionProof.js";
import { createMeetCaptionBuffer } from "./meetCaptionBuffer.js";
import { logMeetUiDiagnosticOnce, MEET_CAPTION_REGION_SELECTOR, MEET_CAPTION_REGION_ALT_SELECTOR } from "./meetCaptionReader.js";
import type { MeetWorkerBinding } from "./meetWorkerPairing.js";
type FactoryOpts = { expectedOwnerEmail: string; chromePath?: string; allowOwnerTransfer?: boolean; ownerUnrecognizedGraceMs?: number; launch?: () => Promise<MeetProofBrowser<Page>>; admit?: (page: Page, scope: Readonly<{ meetingUrl: string; displayName: string }>, signal: AbortSignal) => Promise<boolean>; enableCaptions?: (page: Page, signal: AbortSignal, isCurrent: () => boolean) => Promise<boolean>; browserMode?: MeetBrowserMode; profileDir?: string; debugPort?: number; cameraMode?: MeetCameraMode; twinMedia?: TwinMedia; spawnChrome?: (command: string, args: string[]) => AttachedChild; connectCdp?: (endpoint: string) => Promise<AttachedBrowser<Page>>; joinMode?: MeetJoinMode; guestName?: string; };
type Scope = { meetingUrl: string; displayName: string; binding: MeetWorkerBinding; isCurrent: () => boolean; };
type CaptureHandle = Readonly<{ sample: ReturnType<typeof createMeetCaptionBuffer>["sample"]; stop: () => Promise<void>; }>;
export class MeetCaptureStartError extends Error { readonly cleanupConfirmed: boolean; constructor(cleanupConfirmed: boolean) { super(cleanupConfirmed ? "Meet capture unavailable" : "Meet proof cleanup unconfirmed"); this.cleanupConfirmed = cleanupConfirmed; this.name = "MeetCaptureStartError"; } }
type CapLoc = { count(): Promise<number>; isVisible(): Promise<boolean>; click(): Promise<void>; waitFor(options: { state: "visible"; timeout: number }): Promise<void>; getAttribute(name: string): Promise<string | null>; or(other: CapLoc): CapLoc; nth(index: number): CapLoc };
export type MeetCaptionsPage = { getByRole(role: "button" | "checkbox" | "switch" | "region", options: { name: string | RegExp; exact?: boolean }): CapLoc; getByText(text: string, options: { exact: boolean }): CapLoc; locator(selector: string): CapLoc };
export async function enableMeetCaptions(page: MeetCaptionsPage, signal: AbortSignal, isCurrent: () => boolean, onFail: () => Promise<void> = async () => {}): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const guard = (): boolean => !signal.aborted && isCurrent();
    if (!guard()) return false;
    try {
      const region = page.getByRole("region", { name: "Captions", exact: true });
      let count = await region.count();
      if (!guard()) return false;
      if (count === 1) { const vis = await region.isVisible(); if (!guard()) return false; if (vis) return true; }
      if (!guard()) return false;
      const live = /live captions/i;
      const chip = page.getByRole("button", { name: live }).or(page.getByRole("checkbox", { name: live })).or(page.getByRole("switch", { name: live }));
      const chipCount = await chip.count(); if (!guard()) return false;
      // Use the first visible "Live captions" chip; Translate and Gemini controls are never used.
      let target: CapLoc | null = null; let targetLabel = "";
      for (let i = 0; i < Math.min(chipCount, 8); i++) {
        const c = chip.nth(i);
        const vis = await c.isVisible(); if (!guard()) return false; if (!vis) continue;
        const label = (await c.getAttribute("aria-label")) ?? ""; if (!guard()) return false;
        if (/translat|gemini/i.test(label)) continue;
        target = c; targetLabel = label; break;
      }
      if (target) {
        const pressed = await target.getAttribute("aria-pressed"); if (!guard()) return false;
        const checked = await target.getAttribute("aria-checked"); if (!guard()) return false;
        const alreadyOn = pressed === "true" || checked === "true" || /turn off live captions/i.test(targetLabel);
        if (!alreadyOn) { await target.click(); if (!guard()) return false; }
        const anyRegion = page.locator(MEET_CAPTION_REGION_SELECTOR).or(page.locator(MEET_CAPTION_REGION_ALT_SELECTOR));
        await anyRegion.nth(0).waitFor({ state: "visible", timeout: 30000 }); if (!guard()) return false;
        count = await anyRegion.count(); if (!guard()) return false; return count >= 1;
      }
      const toggle = page.getByRole("button", { name: "Captions and translation", exact: true }).or(page.getByRole("checkbox", { name: "Captions and translation", exact: true }));
      count = await toggle.count(); if (!guard()) return false; if (count !== 1) return false;
      if (!await toggle.isVisible()) return false; if (!guard()) return false;
      await toggle.click(); if (!guard()) return false;
      const turnOn = page.getByText("Turn on captions", { exact: true });
      await turnOn.waitFor({ state: "visible", timeout: 10000 }); if (!guard()) return false;
      count = await turnOn.count(); if (!guard()) return false; if (count !== 1) return false;
      if (!await turnOn.isVisible()) return false; if (!guard()) return false;
      await turnOn.click(); if (!guard()) return false;
      await region.waitFor({ state: "visible", timeout: 10000 }); if (!guard()) return false;
      count = await region.count(); if (!guard()) return false; if (count !== 1) return false;
      const v2 = await region.isVisible(); if (!guard()) return false; return v2;
    } catch { return false; }
  };
  const ok = await run();
  if (!ok && !signal.aborted) { try { await onFail(); } catch {} }
  return ok;
}
export type MeetBrowserMode = "launch" | "attached-profile";
export type MeetCameraMode = "off" | "twin-image";
export type MeetJoinMode = "owner" | "guest";
export type TwinMedia = Readonly<{ videoPath: string; audioPath: string }>;
export const MEET_PERMISSION_ORIGIN = "https://meet.google.com";
const hasControlChar = (s: string): boolean => Array.from(s).some((ch) => { const c = ch.charCodeAt(0); return c < 32 || c === 127; });
const mediaPathOk = (p: string, ext: string): boolean => typeof p === "string" && isAbsolute(p) && p.toLowerCase().endsWith(ext) && !hasControlChar(p);
// Chrome flags for the Meet worker. Default mode is unchanged. twin-image feeds a fake camera from a y4m file and a silent wav
// for the fake microphone device; the microphone is still never granted, and prompts stay denied.
export function meetChromeArgs(cameraMode: MeetCameraMode = "off", twin?: TwinMedia): string[] {
  const args = ["--deny-permission-prompts"];
  if (cameraMode !== "twin-image") return args;
  if (!twin || !mediaPathOk(twin.videoPath, ".y4m") || !mediaPathOk(twin.audioPath, ".wav")) throw new Error("twin-image needs an absolute .y4m video path and an absolute .wav audio path");
  return [...args, "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${twin.videoPath}`, `--use-file-for-fake-audio-capture=${twin.audioPath}`];
}
// Only the camera is ever granted, only in twin-image mode, only for Meet. The microphone is never granted.
export function meetPermissionGrants(cameraMode: MeetCameraMode = "off"): string[] { return cameraMode === "twin-image" ? ["camera"] : []; }
export function defaultMeetChromePath(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (platform === "win32") return win32.join(env["PROGRAMFILES"] ?? "C:/Program Files", "Google", "Chrome", "Application", "chrome.exe");
  return "/usr/bin/google-chrome";
}
// The attached profile is a dedicated directory. It must be absolute and must never be (inside, or a parent of) a main Chrome profile.
export function resolveMeetProfileDir(dir: string | undefined, home: string = homedir()): string {
  const d = dir ?? join(home, ".second-seat", "meet-worker-profile");
  if (typeof d !== "string" || !isAbsolute(d) || hasControlChar(d)) throw new Error("Meet worker profile dir must be an absolute path");
  const r = resolve(d);
  const low = r.toLowerCase();
  if (low === resolve(home).toLowerCase() || low === resolve("/").toLowerCase()) throw new Error("Meet worker profile dir must be a dedicated directory");
  const mains = [join(home, "Library", "Application Support", "Google", "Chrome"), join(home, "Library", "Application Support", "Chromium"), join(home, ".config", "google-chrome"), join(home, ".config", "chromium"), join(home, "AppData", "Local", "Google", "Chrome", "User Data")];
  for (const m of mains) {
    const ml = resolve(m).toLowerCase();
    if (low === ml || low.startsWith(ml + sep) || ml.startsWith(low + sep)) throw new Error("Meet worker profile dir must not be the main Chrome profile");
  }
  return r;
}
export type AttachedChild = { readonly exitCode: number | null; readonly stderr: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null; once(event: "exit" | "error", listener: () => void): unknown; kill(signal: "SIGTERM" | "SIGKILL"): boolean };
export type AttachedContext<P> = { pages(): P[]; newPage(): Promise<P>; clearPermissions(): Promise<void>; grantPermissions(permissions: string[], options: { origin: string }): Promise<void> };
export type AttachedBrowser<P> = { contexts(): AttachedContext<P>[]; close(): Promise<void> };
const DEVTOOLS_PREFIX = "DevTools listening on ws://127.0.0.1:";
// Port from the DevTools line on 127.0.0.1 only (1-5 digits followed by "/"), else undefined.
const devtoolsPort = (buf: string): number | undefined => {
  const i = buf.indexOf(DEVTOOLS_PREFIX);
  if (i < 0) return undefined;
  const rest = buf.slice(i + DEVTOOLS_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash > 5) return undefined;
  const digits = rest.slice(0, slash);
  if (!Array.from(digits).every((c) => c >= "0" && c <= "9")) return undefined;
  return Number(digits);
};
// attached-profile: start normal Chrome (no --enable-automation) as a child with a dedicated profile and a loopback-only
// DevTools port, then attach over CDP. Stop closes the tabs, detaches and ends the child.
export async function launchAttachedMeetChrome<P extends { close(): Promise<unknown> }>(o: { chromePath: string; profileDir: string; port: number; args: readonly string[]; grants: readonly string[]; spawn: (command: string, args: string[]) => AttachedChild; connect: (endpoint: string) => Promise<AttachedBrowser<P>>; readyTimeoutMs?: number }): Promise<MeetProofBrowser<P>> {
  if (!Number.isSafeInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error("invalid DevTools port");
  if (o.grants.some((g) => g !== "camera")) throw new Error("only the camera may be granted");
  const args = [`--user-data-dir=${o.profileDir}`, `--remote-debugging-port=${String(o.port)}`, "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", ...o.args, "about:blank"];
  const child = o.spawn(o.chromePath, args);
  let exited = child.exitCode !== null;
  child.once("exit", () => { exited = true; });
  let killing: Promise<void> | null = null;
  const endChild = (): Promise<void> => {
    if (killing) return killing;
    killing = new Promise<void>((res) => {
      if (exited) { res(); return; }
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} res(); }, 5000);
      child.once("exit", () => { clearTimeout(t); res(); });
      try { child.kill("SIGTERM"); } catch {}
    });
    return killing;
  };
  let port: number;
  try {
    port = await new Promise<number>((res, rej) => {
      let buf = "";
      let settled = false;
      const done = (f: () => void): void => { if (settled) return; settled = true; clearTimeout(t); f(); };
      const t = setTimeout(() => done(() => rej(new Error("Chrome DevTools endpoint timeout"))), o.readyTimeoutMs ?? 30000);
      child.once("exit", () => done(() => rej(new Error("Chrome exited before DevTools was ready"))));
      child.once("error", () => done(() => rej(new Error("Chrome failed to start"))));
      if (!child.stderr) { done(() => rej(new Error("Chrome DevTools endpoint unavailable"))); return; }
      child.stderr.on("data", (chunk: unknown) => {
        buf = (buf + String(chunk)).slice(-8192);
        const n = devtoolsPort(buf);
        if (n === undefined) return;
        if (Number.isSafeInteger(n) && n > 0 && n <= 65535) done(() => res(n)); else done(() => rej(new Error("invalid DevTools port")));
      });
    });
  } catch (e) { await endChild(); throw e; }
  let browser: AttachedBrowser<P>;
  try { browser = await o.connect(`http://127.0.0.1:${String(port)}`); } catch { await endChild(); throw new Error("Chrome DevTools attach failed"); }
  let closing: Promise<void> | null = null;
  const ctx = browser.contexts()[0];
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (ctx) for (const pg of [...ctx.pages()]) { try { await pg.close(); } catch {} }
      try { await browser.close(); } catch {}
      await endChild();
    })();
    return closing;
  };
  if (!ctx) { await close(); throw new Error("Chrome DevTools context missing"); }
  try {
    await ctx.clearPermissions();
    if (o.grants.length > 0) await ctx.grantPermissions([...o.grants], { origin: MEET_PERMISSION_ORIGIN });
  } catch { await close(); throw new Error("Meet permission setup failed"); }
  return { newContext: () => Promise.resolve({ newPage: () => ctx.newPage() }), close };
}
// Reads the optional worker browser settings from the environment. Unknown values fail closed.
type MeetEnvOpts = { browserMode?: MeetBrowserMode; profileDir?: string; cameraMode?: MeetCameraMode; twinMedia?: TwinMedia; joinMode?: MeetJoinMode; guestName?: string };
export function meetCaptureOptsFromEnv(env: Readonly<Record<string, string | undefined>>): MeetEnvOpts {
  const out: MeetEnvOpts = {};
  const mode = env["SECOND_SEAT_MEET_BROWSER"];
  if (mode === "attached-profile") out.browserMode = "attached-profile";
  else if (mode !== undefined && mode !== "" && mode !== "launch") throw new Error("invalid SECOND_SEAT_MEET_BROWSER");
  const dir = env["SECOND_SEAT_MEET_PROFILE_DIR"];
  if (dir !== undefined && dir !== "") out.profileDir = resolveMeetProfileDir(dir);
  const video = env["SECOND_SEAT_TWIN_VIDEO"]; const audio = env["SECOND_SEAT_TWIN_AUDIO"];
  const hasV = video !== undefined && video !== ""; const hasA = audio !== undefined && audio !== "";
  if (hasV !== hasA) throw new Error("twin-image needs both SECOND_SEAT_TWIN_VIDEO and SECOND_SEAT_TWIN_AUDIO");
  if (hasV && hasA) { const twinMedia = { videoPath: video, audioPath: audio }; meetChromeArgs("twin-image", twinMedia); out.cameraMode = "twin-image"; out.twinMedia = twinMedia; }
  const join = env["SECOND_SEAT_MEET_JOIN"];
  if (join === "guest") out.joinMode = "guest";
  else if (join !== undefined && join !== "" && join !== "owner") throw new Error("invalid SECOND_SEAT_MEET_JOIN");
  const guestName = env["SECOND_SEAT_MEET_GUEST_NAME"];
  if (guestName !== undefined && guestName !== "") out.guestName = resolveMeetGuestName(guestName);
  if (out.joinMode === "guest" && (out.browserMode === "attached-profile" || out.cameraMode === "twin-image")) throw new Error("guest join uses a fresh browser; unset SECOND_SEAT_MEET_BROWSER and SECOND_SEAT_TWIN_*");
  return out;
}
export function createLocalMeetCaptureFactory(opts: FactoryOpts): (scope: Scope, externalSignal: AbortSignal) => Promise<CaptureHandle> {
  const capturedEmail = opts.expectedOwnerEmail;
  const capturedChromePath = opts.chromePath;
  const capturedAllowTransfer = opts.allowOwnerTransfer === true;
  const capturedLaunch = opts.launch;
  const capturedAdmit = opts.admit;
  const capturedGrace = opts.ownerUnrecognizedGraceMs;
  const capturedEnableCaptions = opts.enableCaptions;
  const defaultEnableCaptions = (page: Page, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean> => enableMeetCaptions(page, signal, isCurrent, () => logMeetUiDiagnosticOnce(page));
  const enableFn: (page: Page, signal: AbortSignal, isCurrent: () => boolean) => Promise<boolean> = capturedEnableCaptions ?? defaultEnableCaptions;
  const capturedCameraMode: MeetCameraMode = opts.cameraMode ?? "off";
  const capturedArgs = meetChromeArgs(capturedCameraMode, opts.twinMedia);
  const capturedGrants = meetPermissionGrants(capturedCameraMode);
  const capturedBrowserMode: MeetBrowserMode = opts.browserMode ?? "launch";
  const capturedProfileDir = capturedBrowserMode === "attached-profile" ? resolveMeetProfileDir(opts.profileDir) : "";
  const capturedPort = opts.debugPort ?? 0;
  const capturedSpawn = opts.spawnChrome ?? ((command: string, args: string[]): AttachedChild => spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] }));
  const capturedConnect = opts.connectCdp ?? ((endpoint: string): Promise<AttachedBrowser<Page>> => chromium.connectOverCDP(endpoint));
  const attachedChromePath = capturedChromePath ?? (process.env["PLAYWRIGHT_CHROME_PATH"] || defaultMeetChromePath());
  // Guest join: fresh isolated browser (no profile, no sign-in) with microphone and camera prompts denied and nothing granted.
  const guestMode = opts.joinMode === "guest";
  if (guestMode && (capturedBrowserMode === "attached-profile" || capturedCameraMode === "twin-image")) throw new Error("guest join uses a fresh browser with camera and microphone blocked");
  const capturedGuestName = guestMode ? resolveMeetGuestName(opts.guestName) : "";
  return async (scope: Scope, externalSignal: AbortSignal): Promise<CaptureHandle> => {
    const capturedScopeMeetingUrl = scope.meetingUrl;
    const capturedScopeDisplayName = scope.displayName;
    const capturedBinding = Object.freeze({ ...scope.binding }) as MeetWorkerBinding;
    const meetingId = capturedBinding.meetingId;
    const capturedIsCurrent = scope.isCurrent;
    let localStopped = false;
    const scopeCurrent = (): boolean => { if (localStopped) return false; try { const v = capturedIsCurrent(); if (v !== true) { localStopped = true; return false; } return true; } catch { localStopped = true; return false; } };
    if (externalSignal.aborted || !scopeCurrent()) throw new MeetCaptureStartError(true);
    let proofRef: ReturnType<typeof createMeetAdmissionProof> | null = null;
    let captionBuffer: ReturnType<typeof createMeetCaptionBuffer> | null = null;
    let cachedStopPromise: Promise<void> | null = null;
    let proofSignal: AbortSignal | null = null;
    let capturedPage: Page | null = null;
    const localStop = (): Promise<void> => {
      if (cachedStopPromise) return cachedStopPromise;
      localStopped = true;
      try { captionBuffer?.stop(); } catch {}
      externalSignal.removeEventListener("abort", onExternalAbort);
      const base: Promise<void> = proofRef ? proofRef.stop() : Promise.resolve();
      cachedStopPromise = base.then(() => undefined, () => { throw new Error("Meet proof cleanup unconfirmed"); });
      cachedStopPromise.catch(() => {});
      return cachedStopPromise;
    };
    const onExternalAbort = (): void => { localStop().catch(() => {}); };
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    if (externalSignal.aborted || !scopeCurrent()) { await localStop(); throw new MeetCaptureStartError(true); }
    const launchTwin = async (): Promise<MeetProofBrowser<Page>> => {
      const b = await chromium.launch({ headless: false, args: capturedArgs, ...(capturedChromePath !== undefined ? { executablePath: capturedChromePath } : { channel: "chrome" }) });
      return { newContext: async () => { const ctx = await b.newContext(); try { await ctx.grantPermissions([...capturedGrants], { origin: MEET_PERMISSION_ORIGIN }); } catch (e) { await ctx.close().catch(() => {}); throw e; } return ctx; }, close: () => b.close() };
    };
    const launchFn: () => Promise<MeetProofBrowser<Page>> = capturedLaunch ?? (!guestMode && capturedBrowserMode === "attached-profile" ? () => launchAttachedMeetChrome<Page>({ chromePath: attachedChromePath, profileDir: capturedProfileDir, port: capturedPort, args: capturedArgs, grants: capturedGrants, spawn: capturedSpawn, connect: capturedConnect }) : !guestMode && capturedCameraMode === "twin-image" ? launchTwin : () => {
      if (capturedChromePath !== undefined) return chromium.launch({ headless: false, executablePath: capturedChromePath, args: ["--deny-permission-prompts"] } as never) as Promise<MeetProofBrowser<Page>>;
      return chromium.launch({ headless: false, channel: "chrome", args: ["--deny-permission-prompts"] } as never) as Promise<MeetProofBrowser<Page>>;
    });
    const wrappedAdmit = async (page: Page, s: Readonly<{ meetingUrl: string; displayName: string }>, sig: AbortSignal): Promise<boolean> => {
      capturedPage = page; proofSignal = sig;
      const admitGuard = (): boolean => !externalSignal.aborted && !sig.aborted && !localStopped && scopeCurrent() && proofRef?.phase() === "joining";
      if (!admitGuard()) return false;
      let fn: (p: Page, sc: Readonly<{ meetingUrl: string; displayName: string }>, sg: AbortSignal) => Promise<boolean>;
      if (capturedAdmit) fn = capturedAdmit;
      else if (guestMode) {
        const guest = createGuestMeetDriver({ guestName: capturedGuestName });
        fn = async (p, sc, sg): Promise<boolean> => {
          if (!admitGuard()) return false;
          return guest(p, sc, sg);
        };
      } else {
        const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: capturedEmail, timeoutMs: 60000, allowOwnerTransfer: capturedAllowTransfer, ownerSignInTimeoutMs: 300000, unrecognizedGraceMs: capturedGrace, cameraMode: capturedCameraMode });
        fn = async (p, sc, sg): Promise<boolean> => {
          if (!admitGuard()) return false;
          return driver(p, sc, sg);
        };
      }
      if (!admitGuard()) return false;
      const res = await fn(page, s, sig); if (!admitGuard()) return false; return res;
    };
    try {
      let transport: MeetAdmissionTransport;
      try { transport = createMeetAdmissionBrowser<Page>({ meetingUrl: capturedScopeMeetingUrl, displayName: capturedScopeDisplayName }, { launch: launchFn, admit: wrappedAdmit }); } catch { throw new MeetCaptureStartError(true); }
      const proof = createMeetAdmissionProof({ ownerId: capturedBinding.ownerId, meetingUrl: capturedScopeMeetingUrl, displayName: capturedScopeDisplayName }, transport);
      proofRef = proof;
      const isInvalid = (): boolean => localStopped || externalSignal.aborted || !scopeCurrent() || proof.phase() !== "admitted";
      const admittedGuard = (): boolean => !localStopped && !externalSignal.aborted && scopeCurrent() && proof.phase() === "admitted";
      const joiningGuard = (): boolean => !localStopped && !externalSignal.aborted && scopeCurrent();
      // join phase: joining permitted
      if (!joiningGuard()) throw new MeetCaptureStartError(true);
      const joined = await proof.join(); if (!joiningGuard()) throw new MeetCaptureStartError(true);
      if (!joined) throw new MeetCaptureStartError(true);
      if (proof.phase() !== "admitted") throw new MeetCaptureStartError(true);
      if (!capturedPage) throw new MeetCaptureStartError(true);
      if (!admittedGuard()) throw new MeetCaptureStartError(true);
      const sigForCap = proofSignal ?? externalSignal;
      const capOk = await enableFn(capturedPage, sigForCap, () => admittedGuard()); if (!admittedGuard()) throw new MeetCaptureStartError(true);
      if (!capOk) throw new MeetCaptureStartError(true);
      if (!admittedGuard()) throw new MeetCaptureStartError(true);
      captionBuffer = createMeetCaptionBuffer({ page: capturedPage, meetingUrl: capturedScopeMeetingUrl, meetingId, signal: sigForCap, isCurrent: () => admittedGuard() });
    } catch (e) {
      try { await localStop(); } catch { throw new MeetCaptureStartError(false); }
      if (e instanceof MeetCaptureStartError) throw e;
      throw new MeetCaptureStartError(true);
    }
    const sample = async (): Promise<readonly Readonly<{ event: Readonly<{ version: 1; meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }>; verified: false }>[]> => {
      const admittedGuard2 = (): boolean => !localStopped && !externalSignal.aborted && scopeCurrent() && proofRef!.phase() === "admitted";
      if (!admittedGuard2()) { localStop().catch(()=>{}); return Object.freeze([]); }
      try {
        const res = await captionBuffer!.sample();
        if (!admittedGuard2()) { localStop().catch(()=>{}); return Object.freeze([]); }
        return res;
      } catch {
        localStop().catch(()=>{});
        return Object.freeze([]);
      }
    };
    return Object.freeze({ sample, stop: localStop });
  };
}
export const createMeetWorkerCaptureFactory = createLocalMeetCaptureFactory;
