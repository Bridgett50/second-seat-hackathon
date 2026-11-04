import { test, expect, vi } from "vitest";
import type { Page } from "@playwright/test";
import type { MeetProofBrowser } from "./../src/meetAdmissionBrowser.js";
import { createLocalMeetCaptureFactory, MeetCaptureStartError } from "../src/meetWorkerCapture.js";

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
    const fake={goto,url:()=>home?"https://meet.google.com/":URL_S,getByText:vi.fn((t:string)=>t===exp?owner:dum),getByRole:vi.fn((r:string,o:{name?:string})=>o?.name==="Continue without microphone and camera"?hw:o?.name==="Join now"?join:o?.name==="Leave call"?leave:o?.name===exp?failOwnerBtn():dum)} as unknown as Page;
    const b=mkBrowser(fake as unknown as Page);const enableCaptions=vi.fn(async()=>true);
    const factory=createLocalMeetCaptureFactory({expectedOwnerEmail:exp,launch:async()=>b.browser,enableCaptions});
    const ac=new AbortController();const p=factory(scope(()=>true),ac.signal);p.catch(()=>{});
    await entered.promise;if(mode==="abort") ac.abort();modal=true;reveal.resolve(undefined);
    let h:Awaited<ReturnType<typeof factory>>|null=null,err:unknown=null;try{h=await p;}catch(e){err=e;}
    try{
      if(mode==="owner"){expect(err).toBeNull();expect(dc).toBe(1);expect(jc).toBe(1);expect(verified).toBe(true);expect(enableCaptions).toHaveBeenCalledTimes(1);expect(goto.mock.calls.map(c=>c[0])).toEqual(["https://meet.google.com/",URL_S]);}
      else {expect(err).toBeInstanceOf(MeetCaptureStartError);expect((err as MeetCaptureStartError).cleanupConfirmed).toBe(true);expect(jc).toBe(0);expect(enableCaptions).not.toHaveBeenCalled();if(mode==="abort") expect(dc).toBe(0);else expect(goto).not.toHaveBeenCalledWith(URL_S, expect.anything());}
    }finally{if(h) await h.stop();expect(b.close).toHaveBeenCalledTimes(1);}
  }
});

