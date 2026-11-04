import { chromium, type Page } from "@playwright/test";
import { createAuthenticatedMeetDriver } from "./meetAdmissionDriver.js";
import { createMeetAdmissionBrowser, type MeetProofBrowser } from "./meetAdmissionBrowser.js";
import { createMeetAdmissionProof, type MeetAdmissionTransport } from "./meetAdmissionProof.js";
import { createMeetCaptionBuffer } from "./meetCaptionBuffer.js";
import type { MeetWorkerBinding } from "./meetWorkerPairing.js";
type FactoryOpts = { expectedOwnerEmail: string; chromePath?: string; allowOwnerTransfer?: boolean; launch?: () => Promise<MeetProofBrowser<Page>>; admit?: ReturnType<typeof createAuthenticatedMeetDriver>; enableCaptions?: (page: Page, signal: AbortSignal, isCurrent: () => boolean) => Promise<boolean>; };
type Scope = { meetingUrl: string; displayName: string; binding: MeetWorkerBinding; isCurrent: () => boolean; };
type CaptureHandle = Readonly<{ sample: ReturnType<typeof createMeetCaptionBuffer>["sample"]; stop: () => Promise<void>; }>;
export class MeetCaptureStartError extends Error { readonly cleanupConfirmed: boolean; constructor(cleanupConfirmed: boolean) { super(cleanupConfirmed ? "Meet capture unavailable" : "Meet proof cleanup unconfirmed"); this.cleanupConfirmed = cleanupConfirmed; this.name = "MeetCaptureStartError"; } }
export function createLocalMeetCaptureFactory(opts: FactoryOpts): (scope: Scope, externalSignal: AbortSignal) => Promise<CaptureHandle> {
  const capturedEmail = opts.expectedOwnerEmail;
  const capturedChromePath = opts.chromePath;
  const capturedAllowTransfer = opts.allowOwnerTransfer === true;
  const capturedLaunch = opts.launch;
  const capturedAdmit = opts.admit;
  const capturedEnableCaptions = opts.enableCaptions;
  const defaultEnableCaptions = async (page: Page, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean> => {
    const guard = (): boolean => !signal.aborted && isCurrent();
    if (!guard()) return false;
    try {
      const region = page.getByRole("region", { name: "Captions", exact: true });
      let count = await region.count();
      if (!guard()) return false;
      if (count === 1) { const vis = await region.isVisible(); if (!guard()) return false; if (vis) return true; }
      if (!guard()) return false;
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
  const enableFn: (page: Page, signal: AbortSignal, isCurrent: () => boolean) => Promise<boolean> = capturedEnableCaptions ?? defaultEnableCaptions;
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
    const launchFn: () => Promise<MeetProofBrowser<Page>> = capturedLaunch ?? (() => {
      if (capturedChromePath !== undefined) return chromium.launch({ headless: false, executablePath: capturedChromePath } as never) as Promise<MeetProofBrowser<Page>>;
      return chromium.launch({ headless: false, channel: "chrome" } as never) as Promise<MeetProofBrowser<Page>>;
    });
    const wrappedAdmit = async (page: Page, s: Readonly<{ meetingUrl: string; displayName: string }>, sig: AbortSignal): Promise<boolean> => {
      capturedPage = page; proofSignal = sig;
      const admitGuard = (): boolean => !externalSignal.aborted && !sig.aborted && !localStopped && scopeCurrent() && proofRef?.phase() === "joining";
      if (!admitGuard()) return false;
      let fn: (p: Page, sc: Readonly<{ meetingUrl: string; displayName: string }>, sg: AbortSignal) => Promise<boolean>;
      if (capturedAdmit) fn = capturedAdmit as unknown as typeof fn;
      else {
        const driver = createAuthenticatedMeetDriver({ expectedOwnerEmail: capturedEmail, timeoutMs: 60000, allowOwnerTransfer: capturedAllowTransfer });
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
