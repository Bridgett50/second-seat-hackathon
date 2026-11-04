import { test, expect, vi } from "vitest";
import type { Page } from "@playwright/test";
import type { MeetProofBrowser } from "./../src/meetAdmissionBrowser.js";
import { createLocalMeetCaptureFactory, MeetCaptureStartError, enableMeetCaptions, type MeetCaptionsPage } from "../src/meetWorkerCapture.js";
import { collectMeetUiDiagnostic, MEET_CAPTION_REGION_SELECTOR, MEET_CAPTION_REGION_ALT_SELECTOR } from "../src/meetCaptionReader.js";

type D<T>={promise:Promise<T>;resolve:(v:T)=>void;reject:(e:unknown)=>void};
function deferred<T>():D<T>{let r!:D<T>["resolve"],j!:D<T>["reject"];const p=new Promise<T>((a,b)=>{r=a;j=b});return{promise:p,resolve:r,reject:j}}
const URL_S="https://meet.google.com/abc-defg-hij";
const DISPLAY="Second Seat AI twin (test)";
const BIND={roomId:"r1",ownerId:"owner-123",meetingId:"m1",epoch:1} as const;
function fakePage(){
  const getByRole=vi.fn(()=>({count:async()=>0}));
  const locator=vi.fn(()=>({count:async()=>0}));
  return {url:()=>URL_S,getByRole,locator} as unknown as Page;
}
function mkBrowser(fake:Page,closeImpl?:()=>Promise<void>){
  const close=vi.fn(closeImpl??(async()=>{}));
  const newPage=vi.fn(async()=>fake);
  const newContext=vi.fn(async()=>({newPage} as unknown));
  const browser={newContext,close} as unknown as MeetProofBrowser<Page>;
  return {browser,close,newContext,newPage,fake};
}
function scope(isCurrent:()=>boolean){return{meetingUrl:URL_S,displayName:DISPLAY,binding:BIND as unknown as typeof BIND,isCurrent}}
test("1 pre-aborted and isCurrent false/throw rejects generic and no launch",async()=>{
  {
    const launch=vi.fn(async()=>mkBrowser(fakePage()).browser);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
    const ac=new AbortController();ac.abort();
    await expect(factory(scope(()=>true),ac.signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
    expect(launch).not.toHaveBeenCalled();
  }
  {
    const launch=vi.fn(async()=>mkBrowser(fakePage()).browser);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
    const ac=new AbortController();
    await expect(factory(scope(()=>false),ac.signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
    expect(launch).not.toHaveBeenCalled();
  }
  {
    const launch=vi.fn(async()=>mkBrowser(fakePage()).browser);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
    const ac=new AbortController();
    await expect(factory(scope(()=>{throw new Error("x")}),ac.signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
    expect(launch).not.toHaveBeenCalled();
  }
});
test("2 pending launch external abort holds close",async()=>{
  const fp=fakePage();
  const entered=deferred<void>();const closeBarrier=deferred<void>();
  const launchD=deferred<MeetProofBrowser<Page>>();
  const b=mkBrowser(fp,async()=>{entered.resolve();await closeBarrier.promise});
  const launch=vi.fn(()=>{return launchD.promise});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch});
  const ac=new AbortController();
  let settled=false;
  const p=factory(scope(()=>true),ac.signal).then(()=>{settled=true;throw new Error("ok")},e=>{settled=true;throw e});
  p.catch(()=>{});
  await Promise.resolve();
  ac.abort();
  launchD.resolve(b.browser);
  await entered.promise;
  expect(settled).toBe(false);
  expect(b.close).toHaveBeenCalledTimes(1);
  expect(b.newContext).not.toHaveBeenCalled();
  closeBarrier.resolve();
  await expect(p).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable");
  expect(b.close).toHaveBeenCalledTimes(1);
});
test("3 authority false while admit pending rejects and no captions",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  const admitEntered=deferred<void>();const admitD=deferred<boolean>();
  const admit=vi.fn(async(_p:Page,_s:unknown,_sig:AbortSignal)=>{admitEntered.resolve();return admitD.promise});
  const enableCaptions=vi.fn(async()=>true);
  let cur=true;
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit,enableCaptions});
  const p=factory(scope(()=>cur),new AbortController().signal);
  p.catch(()=>{});
  await admitEntered.promise;
  cur=false;
  admitD.resolve(true);
  await expect(p).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable" && (e as MeetCaptureStartError).cleanupConfirmed===true);
  expect(enableCaptions).not.toHaveBeenCalled();
  expect(b.close).toHaveBeenCalledTimes(1);
});
test("4 success sample/stop caching and no reads after stop",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  const order:string[]=[];
  let capturedSig:AbortSignal|null=null;
  let isCurrentSeen=false;
  const admit=vi.fn(async(_p:Page,_s:unknown,sig:AbortSignal)=>{order.push("admit");capturedSig=sig;return true});
  let sigEq=false;const enableCaptions=vi.fn(async(_p:Page,sig:AbortSignal,isCurrent:()=>boolean)=>{order.push("captions");isCurrentSeen=isCurrent();sigEq=sig===capturedSig;return true});
  // need helper to use real buffer before stop: createMeetCaptionBuffer uses reader
  const closeEntered=deferred<void>();const closeAck=deferred<void>();
  const b2=mkBrowser(fp,async()=>{closeEntered.resolve();await closeAck.promise});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b2.browser,admit,enableCaptions});
  const h=await factory(scope(()=>true),new AbortController().signal);
  expect(order).toEqual(["admit","captions"]);
  expect(isCurrentSeen).toBe(true);
  expect(sigEq).toBe(true);
  const r1=await h.sample();expect(r1).toEqual([]);
  expect(fp.getByRole).toHaveBeenCalled();
  const readsBefore=(fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length;
  const s1=h.stop();const s2=h.stop();
  expect(s1).toBe(s2);
  let ack=false;s1.then(()=>ack=true,s=>{ack=false});
  await closeEntered.promise;
  // sample after stop must be immediate [] with 0 additional DOM reads
  const after=await h.sample();expect(after).toEqual([]);
  expect((fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length).toBe(readsBefore);
  expect(ack).toBe(false);
  expect(b2.close).toHaveBeenCalledTimes(1);
  closeAck.resolve();await s1;
  expect(ack).toBe(true);
});
test("5 browser close failure on stop rejects cleanup unconfirmed",async()=>{
  const fp=fakePage();const b=mkBrowser(fp,async()=>{throw "internal"});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit:async()=>true,enableCaptions:async()=>true});
  const h=await factory(scope(()=>true),new AbortController().signal);
  const p1=h.stop();const p2=h.stop();
  expect(p1).toBe(p2);
  await expect(p1).rejects.toSatisfy((e:unknown)=>e instanceof Error && (e as Error).message==="Meet proof cleanup unconfirmed" && !String(e).includes("internal"));
  await expect(p2).rejects.toMatchObject({message:"Meet proof cleanup unconfirmed"});
  expect(b.close).toHaveBeenCalledTimes(1);
});
test("6 external abort while captions helper pending",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  const helperEntered=deferred<void>();const helperD=deferred<boolean>();
  const admit=vi.fn(async()=>true);
  const enableCaptions=vi.fn(async(_p:Page,_sig:AbortSignal,_ic:()=>boolean)=>{helperEntered.resolve();return helperD.promise});
  const ac=new AbortController();
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit,enableCaptions});
  const p=factory(scope(()=>true),ac.signal);p.catch(()=>{});
  await helperEntered.promise;
  // capture that helper uses not invented proof.phase but real isCurrent/signal path via abort
  const readsBefore=(fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length;
  ac.abort();
  helperD.resolve(true);
  await expect(p).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as Error).message==="Meet capture unavailable");
  expect(b.close).toHaveBeenCalledTimes(1);
  expect((fp.getByRole as unknown as {mock:{calls:unknown[]}}).mock.calls.length).toBe(readsBefore);
});
test("7 admit false + close throws => class false",async()=>{
  const fp=fakePage();const b=mkBrowser(fp,async()=>{throw "internal"});
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit:async()=>false});
  await expect(factory(scope(()=>true),new AbortController().signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as MeetCaptureStartError).cleanupConfirmed===false && (e as Error).message==="Meet proof cleanup unconfirmed" && !(e as Error).cause);
});
test("8 sticky isCurrent false then true still fails",async()=>{
  const fp=fakePage();const b=mkBrowser(fp);
  let cur=true;
  let capturedFalse=false;
  const enableCaptions=async(_p:Page,_s:AbortSignal,isCurrent:()=>boolean)=>{
    const before=isCurrent();
    if(before===false) capturedFalse=true;
    cur=false;
    const seen=isCurrent();
    if(seen===false) capturedFalse=true;
    cur=true;
    return true;
  };
  const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:"owner@example.test",launch:async()=>b.browser,admit:async()=>true,enableCaptions:enableCaptions as unknown as (p:Page,s:AbortSignal,ic:()=>boolean)=>Promise<boolean>});
  const isCurrent=()=>cur;
  await expect(factory(scope(isCurrent),new AbortController().signal)).rejects.toSatisfy((e:unknown)=>e instanceof MeetCaptureStartError && (e as MeetCaptureStartError).cleanupConfirmed===true);
  expect(capturedFalse).toBe(true);
  expect(b.close).toHaveBeenCalledTimes(1);
});

test("9 readiness modal forces decline before identity", async()=>{
  const exp="owner@example.test";
  for(const mode of ["owner","wrong","abort"] as const){
    const entered=deferred<void>(),reveal=deferred<void>();
    let modal=false,declined=false,verified=false,jc=0,dc=0,done=false,home=false;
    const goto=vi.fn(async(u:string,_o?:unknown)=>{home=u==="https://meet.google.com/";});
    const failOwnerBtn = ():L => ({ count: async () => 0, isVisible: async () => false, waitFor: async () => { throw new Error("hidden"); }, click: async () => {}, or(o:L){ return failOwnerBtn(); } });
    const pend=(a:()=>Promise<void>)=> done? a(): (done=true,entered.resolve(undefined),reveal.promise.then(a));
    type L={count:()=>Promise<number>,isVisible:()=>Promise<boolean>,waitFor:()=>Promise<void>,click:()=>Promise<void>,or:(o:L)=>L};
    const mk=(k:string):L=>({count:async()=>k==="hw"? (home?0:modal&&!declined?1:0):k==="join"? (declined&&verified&&mode==="owner"?1:0):k==="leave"? (jc?1:0):0,isVisible:async()=>k==="hw"? (!home&&modal&&!declined):k==="owner"? (home?mode!=="wrong":declined&&verified&&mode==="owner"):k==="join"? (declined&&verified&&mode==="owner"):k==="leave"? !!jc:false,waitFor:async()=>pend(async()=>{if(k==="owner"){if(home){if(mode==="wrong") throw new Error("hidden");}else{if(mode==="wrong"||!declined) throw new Error("hidden");verified=true;}}else if(k==="hw"){if(home||!modal||declined) throw new Error("hidden");}else if(k==="join"){if(!declined||!verified||mode!=="owner") throw new Error("hidden");}else if(k==="leave"){if(!jc) throw new Error("hidden");}}),click:async()=>{if(k==="hw"){declined=true;modal=false;dc++;}else if(k==="join"){if(!verified) throw new Error("forbidden");jc++;}},or(o:L){const u=mk(k+"|or");u.waitFor=async()=>pend(async()=>{if(!modal) throw new Error("hidden")});return u;}});
    const owner=mk("owner"),hw=mk("hw"),join=mk("join"),leave=mk("leave"),dum=mk("dum");
    const fake={goto,url:()=>home?"https://meet.google.com/":URL_S,getByText:vi.fn((t:string)=>t===exp?owner:dum),getByRole:vi.fn((r:string,o:{name?:string|RegExp})=>o?.name==="Continue without microphone and camera"?hw:o?.name==="Join now"?join:o?.name==="Leave call"?leave:(o?.name instanceof RegExp&&o.name.test(exp))?failOwnerBtn():dum)} as unknown as Page;
    const b=mkBrowser(fake as unknown as Page);const enableCaptions=vi.fn(async()=>true);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:exp,launch:async()=>b.browser,enableCaptions,ownerUnrecognizedGraceMs:100});
    const ac=new AbortController();const p=factory(scope(()=>true),ac.signal);p.catch(()=>{});
    await entered.promise;if(mode==="abort") ac.abort();modal=true;reveal.resolve(undefined);
    let h:Awaited<ReturnType<typeof factory>>|null=null,err:unknown=null;try{h=await p;}catch(e){err=e;}
    try{
      if(mode==="owner"){expect(err).toBeNull();expect(dc).toBe(1);expect(jc).toBe(1);expect(verified).toBe(true);expect(enableCaptions).toHaveBeenCalledTimes(1);expect(goto.mock.calls.map(c=>c[0])).toEqual([`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(URL_S)}`]);}
      else {expect(err).toBeInstanceOf(MeetCaptureStartError);expect((err as MeetCaptureStartError).cleanupConfirmed).toBe(true);expect(jc).toBe(0);expect(enableCaptions).not.toHaveBeenCalled();if(mode==="abort") expect(dc).toBe(0);else expect(goto.mock.calls.map(c=>c[0])).toEqual([`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(URL_S)}`]);}
    }finally{if(h) await h.stop();expect(b.close).toHaveBeenCalledTimes(1);}
  }
});

type FL = { count(): Promise<number>; isVisible(): Promise<boolean>; click(): Promise<void>; waitFor(o: { state: "visible"; timeout: number }): Promise<void>; getAttribute(n: string): Promise<string | null>; or(o: FL): FL };
function capPage(init: { chip?: { role: string; attr: string; on: boolean }; oldUi?: boolean; regionOn?: boolean; noRegion?: boolean }): { page: MeetCaptionsPage; clicks: string[]; asked: string[] } {
  const clicks: string[] = [];
  const asked: string[] = [];
  let regionOn = init.regionOn === true;
  let menuOpen = false;
  const chip = init.chip;
  const orL = (a: FL, b: FL): FL => {
    const l: FL = {
      count: async () => (await a.count()) + (await b.count()),
      isVisible: async () => (await a.isVisible()) || (await b.isVisible()),
      click: async () => { if (await a.isVisible()) await a.click(); else await b.click(); },
      waitFor: async () => { if (!(await a.isVisible()) && !(await b.isVisible())) throw new Error("timeout"); },
      getAttribute: async (n: string) => ((await a.count()) > 0 ? a.getAttribute(n) : b.getAttribute(n)),
      or: (o: FL) => orL(l, o),
    };
    return l;
  };
  const loc = (key: string, vis: () => boolean, attrs: () => Record<string, string> = () => ({}), onClick: () => void = () => {}): FL => {
    const l: FL = {
      count: async () => (vis() ? 1 : 0),
      isVisible: async () => vis(),
      click: async () => { clicks.push(key); onClick(); },
      waitFor: async () => { if (!vis()) throw new Error("timeout"); },
      getAttribute: async (n: string) => attrs()[n] ?? null,
      or: (o: FL) => orL(l, o),
    };
    return l;
  };
  const page: MeetCaptionsPage = {
    getByRole(role: "button" | "checkbox" | "switch" | "region", options: { name: string | RegExp; exact?: boolean }) {
      const name = options.name;
      asked.push(role + ":" + String(name));
      if (role === "region" && name === "Captions") return loc("region:Captions", () => init.oldUi === true && regionOn);
      if (name instanceof RegExp) {
        if (chip && role === chip.role && name.test("Live captions")) return loc("chip:Live captions", () => true, () => ({ [chip.attr]: chip.on ? "true" : "false" }), () => { chip.on = true; regionOn = true; });
        return loc(role + ":?", () => false);
      }
      if (name === "Captions and translation") return loc(role + ":" + name, () => init.oldUi === true && role === "button", () => ({}), () => { menuOpen = true; });
      if (name === "Let Gemini take notes" || name === "Translate speech") return loc(role + ":" + name, () => true);
      return loc(role + ":" + name, () => false);
    },
    getByText(text: string) {
      return loc("text:" + text, () => text === "Turn on captions" && menuOpen, () => ({}), () => { regionOn = true; });
    },
    locator(selector: string) {
      if (selector === MEET_CAPTION_REGION_SELECTOR) return loc("css:old-region", () => init.oldUi === true && regionOn);
      if (selector === MEET_CAPTION_REGION_ALT_SELECTOR) return loc("css:alt-region", () => init.oldUi !== true && regionOn && init.noRegion !== true);
      return loc("css:" + selector, () => false);
    },
  };
  return { page, clicks, asked };
}
test("captions: Live captions chip that is off is clicked exactly once", async () => {
  const f = capPage({ chip: { role: "button", attr: "aria-pressed", on: false } });
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, onFail)).toBe(true);
  expect(f.clicks).toEqual(["chip:Live captions"]);
  expect(onFail).not.toHaveBeenCalled();
});
test("captions: Live captions chip that is already on is not clicked", async () => {
  const f = capPage({ chip: { role: "switch", attr: "aria-checked", on: true }, regionOn: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual([]);
});
test("captions: old Captions and translation path still works when there is no chip", async () => {
  const f = capPage({ oldUi: true });
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true)).toBe(true);
  expect(f.clicks).toEqual(["button:Captions and translation", "text:Turn on captions"]);
});
test("captions: Gemini and Translate are never clicked or looked up; failure runs the diagnostic once", async () => {
  const f = capPage({ chip: { role: "checkbox", attr: "aria-checked", on: true }, noRegion: true });
  const onFail = vi.fn(async () => {});
  expect(await enableMeetCaptions(f.page, new AbortController().signal, () => true, onFail)).toBe(false);
  expect(f.clicks).toEqual([]);
  expect(f.asked.some((a) => /gemini|translate/i.test(a))).toBe(false);
  expect(onFail).toHaveBeenCalledTimes(1);
});
test("captions: diagnostic lists only role and name, redacts emails, and skips caption text", async () => {
  const el = (label: string | null, text: string) => ({ getAttribute: async () => label, innerText: async () => text });
  const page = {
    locator(selector: string) {
      if (selector.includes('"button"')) return { all: async () => [el("Google Account: Owner (owner@example.test)", "Owner owner@example.test"), el(null, "Live captions\nmore")] };
      if (selector.includes('"switch"')) return { all: async () => [el("Translate speech", "")] };
      if (selector.includes('"region"')) return { all: async () => [el("Captions", "Alice: secret caption words"), el(null, "Bob: another secret caption")] };
      return { all: async () => [] };
    },
  };
  const out = await collectMeetUiDiagnostic(page);
  expect(out).toContain("button: Live captions");
  expect(out).toContain("button: Google Account: Owner ([email])");
  expect(out).toContain("switch: Translate speech");
  expect(out).toContain("region: Captions");
  expect(out).toContain("region: (unnamed)");
  expect(out).not.toContain("@");
  expect(out).not.toContain("secret caption");
});
