import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {createWebSearchRuntime} from '../lib/knowledge/web-search-runtime';
import {TavilySearchError,type TavilySearchAdapter,type TavilyUsage} from '../lib/knowledge/tavily-search';
import type {WebSearchAdmission} from '../lib/knowledge/web-search-admission';

const key='synthetic-web-key',master=Buffer.alloc(32,11).toString('base64');
const now=Date.parse('2026-10-09T08:00:00.000Z');
const config=()=>({enabled:true,apiKey:key,attestation:{mode:'RESEARCHER_NO_PAYG' as const,
 keySha256:createHash('sha256').update(key).digest('hex'),attestedAt:new Date(now-1000).toISOString()}});
const input=()=>({consumer:'STUDENT',operationId:randomUUID(),ownerId:randomUUID(),purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2569});
const usage=():TavilyUsage=>({currentPlan:'Researcher',keyUsage:2,keyLimit:1000,planUsage:3,planLimit:1000,paygoUsage:0,paygoLimit:0});
const success=()=>({requestId:randomUUID(),credits:1 as const,results:[]});
const pools:Pool[]=[];
function fixture(overrides:Record<string,unknown>={}){
 const pool=new Pool({max:1});pools.push(pool);
 const adapter={usage:vi.fn<TavilySearchAdapter['usage']>(async()=>usage()),search:vi.fn<TavilySearchAdapter['search']>(async()=>success())};
 const reserve=vi.fn<()=>Promise<WebSearchAdmission>>(async()=>({status:'RESERVED',attemptId:randomUUID()}));
 const observe=vi.fn(async()=>true);
 const run=createWebSearchRuntime({pool,encryptionKey:master,config:config(),adapter,reserve,observe,now:()=>now,...overrides});
 return {run,adapter,reserve,observe};
}
afterEach(async()=>{await Promise.all(pools.splice(0).map(p=>p.end()));});

it('fresh actor/source preflight denial or failure prevents even usage HTTP',async()=>{
 for(const preflight of [async()=>false,async()=>{throw new Error('PRIVATE_ACTOR_DETAIL');}]){
  const f=fixture({preflight});expect((await f.run(input(),new AbortController().signal)).status).toBe('UNAVAILABLE');
  expect(f.adapter.usage).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();expect(f.adapter.search).not.toHaveBeenCalled();
 }
});
it('source changes during usage stop before reservation',async()=>{
 const preflight=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),f=fixture({preflight});
 expect((await f.run(input(),new AbortController().signal)).status).toBe('UNAVAILABLE');
 expect(f.adapter.usage).toHaveBeenCalledTimes(1);expect(f.reserve).not.toHaveBeenCalled();expect(f.adapter.search).not.toHaveBeenCalled();
});
it('source changes after committed admission consume the attempt without search or refund',async()=>{
 const preflight=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false),f=fixture({preflight});
 expect((await f.run(input(),new AbortController().signal)).status).toBe('UNAVAILABLE');
 expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.adapter.search).not.toHaveBeenCalled();expect(f.observe).not.toHaveBeenCalled();
});
it('source changes during search discard results after recording the real provider observation',async()=>{
 const preflight=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false),f=fixture({preflight});
 expect((await f.run(input(),new AbortController().signal)).status).toBe('UNAVAILABLE');
 expect(f.adapter.search).toHaveBeenCalledTimes(1);expect(f.observe).toHaveBeenCalledWith(expect.any(String),{kind:'SUCCESS',httpStatus:200,providerRequestId:expect.any(String),credits:1});
});
it('a private preflight ignoring cancellation is bounded to five seconds and cannot reach usage later',async()=>{
 vi.useFakeTimers();let release:(value:boolean)=>void=()=>{};let inner:AbortSignal|undefined;
 try{
  const preflight=vi.fn(async(_request,signal)=>{inner=signal;return new Promise<boolean>(resolve=>{release=resolve;});}),f=fixture({preflight});
  const pending=f.run(input(),new AbortController().signal);await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toEqual({status:'UNAVAILABLE'});expect(inner?.aborted).toBe(true);
  release(true);await Promise.resolve();expect(f.adapter.usage).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it('outer cancellation fences an ignored private preflight without waiting for its result',async()=>{
 const controller=new AbortController();let release:(value:boolean)=>void=()=>{};
 const preflight=vi.fn(async()=>new Promise<boolean>(resolve=>{release=resolve;})),f=fixture({preflight});
 const pending=f.run(input(),controller.signal);await Promise.resolve();controller.abort();
 expect(await pending).toEqual({status:'UNAVAILABLE'});release(true);await Promise.resolve();
 expect(f.adapter.usage).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
});
it('valid configured caller preflights before each HTTP boundary and after result without exposing ownership',async()=>{
 const order:string[]=[],request=input();
 const preflight=vi.fn(async(value,signal)=>{expect(value).toEqual(request);expect(signal).toBeInstanceOf(AbortSignal);order.push('preflight');return true;});
 const f=fixture({preflight});f.adapter.usage.mockImplementation(async()=>{order.push('usage');return usage();});
 f.reserve.mockImplementation(async()=>{order.push('reserve');return {status:'RESERVED',attemptId:randomUUID()};});
 f.adapter.search.mockImplementation(async()=>{order.push('search');return success();});
 const result=await f.run(request,new AbortController().signal);expect(result.status).toBe('READY');
 expect(order).toEqual(['preflight','usage','preflight','reserve','preflight','search','preflight']);
 expect(JSON.stringify(result)).not.toContain(request.ownerId);expect(JSON.stringify(result)).not.toContain(request.operationId);
});

it('defaults disabled and refuses absent or malformed configuration before usage or reservation',async()=>{
 for(const c of [undefined,{}, {...config(),enabled:false},{...config(),apiKey:''},{...config(),apiKey:'bad key'},
  {...config(),attestation:null}]){
  const f=fixture({config:c});expect((await f.run(input(),new AbortController().signal)).status).toBe('NOT_CONFIGURED');
  expect(f.adapter.usage).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();expect(f.adapter.search).not.toHaveBeenCalled();
 }
});
it('requires fresh exact owner attestation bound to this key before usage',async()=>{
 for(const attestation of [{...config().attestation,mode:'PAID'}, {...config().attestation,keySha256:'0'.repeat(64)},
  {...config().attestation,attestedAt:new Date(now+1).toISOString()},
  {...config().attestation,attestedAt:new Date(now-86400001).toISOString()},
  {...config().attestation,attestedAt:'2026-10-09'}]){
  const f=fixture({config:{...config(),attestation}});
  expect((await f.run(input(),new AbortController().signal)).status).toBe('FREE_ONLY_UNVERIFIABLE');
  expect(f.adapter.usage).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
 }
});
it('rejects invalid own request and already-cancelled calls without usage',async()=>{
 const controller=new AbortController();controller.abort();const f=fixture();
 for(const request of [{...input(),question:'private'}, {...input(),operationId:'bad'}, {...input(),topic:'UNKNOWN'},
  {...input(),purpose:'GENERAL_PUBLIC'}, {...input(),academicYear:2399},Object.create(input())]){
  expect((await f.run(request,new AbortController().signal)).status).toBe('UNAVAILABLE');
 }
 expect((await f.run(input(),controller.signal)).status).toBe('UNAVAILABLE');
 expect(f.adapter.usage).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
});
it('unknown or paid usage and invalid counters never reserve or search',async()=>{
 for(const patch of [{currentPlan:'Bootstrap'},{currentPlan:'researcher'},{paygoUsage:1},{paygoLimit:100},
  {keyLimit:1001},{planLimit:1001},{keyLimit:0},{planLimit:0},{keyUsage:-1},{planUsage:NaN}]){
  const f=fixture();f.adapter.usage.mockResolvedValue({...usage(),...patch});
  expect((await f.run(input(),new AbortController().signal)).status).toBe('FREE_ONLY_UNVERIFIABLE');
  expect(f.reserve).not.toHaveBeenCalled();expect(f.adapter.search).not.toHaveBeenCalled();
 }
});
it('exhausted key or account stops without reservation',async()=>{
 for(const patch of [{keyUsage:1000},{planUsage:1000},{planUsage:1001}]){
  const f=fixture();f.adapter.usage.mockResolvedValue({...usage(),...patch});
  expect((await f.run(input(),new AbortController().signal)).status).toBe('QUOTA_EXHAUSTED');expect(f.reserve).not.toHaveBeenCalled();
 }
});
it('usage failure is unavailable and never becomes a search miss or retry',async()=>{
 const f=fixture();f.adapter.usage.mockRejectedValue(new Error(`untrusted ${key}`));
 expect(await f.run(input(),new AbortController().signal)).toEqual({status:'UNAVAILABLE'});
 expect(f.adapter.usage).toHaveBeenCalledTimes(1);expect(f.reserve).not.toHaveBeenCalled();
});
it('commits reservation before search and sends only the closed public fields',async()=>{
 const f=fixture(),request=input(),order:string[]=[];
 f.reserve.mockImplementation(async()=>{order.push('COMMITTED');return {status:'RESERVED',attemptId:randomUUID()};});
 f.adapter.search.mockImplementation(async query=>{expect(order).toEqual(['COMMITTED']);expect(query).toEqual({version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2569});order.push('POST');return success();});
 const result=await f.run(request,new AbortController().signal);
 expect(result.status).toBe('READY');expect(order).toEqual(['COMMITTED','POST']);expect(f.observe).toHaveBeenCalledTimes(1);
 for(const secret of [key,master,request.ownerId,request.operationId])expect(JSON.stringify(result)).not.toContain(secret);
});
it('duplicate, exhausted, or unavailable admission never POSTs',async()=>{
 for(const [status,expected] of [['DUPLICATE','ALREADY_ATTEMPTED'],['EXHAUSTED','QUOTA_EXHAUSTED'],['UNAVAILABLE','UNAVAILABLE']] as const){
  const f=fixture();f.reserve.mockResolvedValue({status});
  expect((await f.run(input(),new AbortController().signal)).status).toBe(expected);expect(f.adapter.search).not.toHaveBeenCalled();expect(f.observe).not.toHaveBeenCalled();
 }
});
it('cancellation while usage is in flight does not reserve',async()=>{
 const c=new AbortController(),f=fixture();f.adapter.usage.mockImplementation(async()=>{c.abort();return usage();});
 expect((await f.run(input(),c.signal)).status).toBe('UNAVAILABLE');expect(f.reserve).not.toHaveBeenCalled();
});
it('cancellation after commit leaves one consumed attempt without sending or refunding',async()=>{
 const c=new AbortController(),f=fixture();f.reserve.mockImplementation(async()=>{c.abort();return {status:'RESERVED',attemptId:randomUUID()};});
 expect((await f.run(input(),c.signal)).status).toBe('UNAVAILABLE');expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.adapter.search).not.toHaveBeenCalled();
});
it('attestation expiry after commit also consumes the attempt without a POST',async()=>{
 let clock=now;const f=fixture({now:()=>clock});f.reserve.mockImplementation(async()=>{clock+=86400001;return {status:'RESERVED',attemptId:randomUUID()};});
 expect((await f.run(input(),new AbortController().signal)).status).toBe('FREE_ONLY_UNVERIFIABLE');expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.adapter.search).not.toHaveBeenCalled();
});
it('failed or unknown search is consumed once with no retry and a safe observation',async()=>{
 for(const error of [new Error(`raw ${key}`),new TavilySearchError('WEB_SEARCH_TIMEOUT'),new TavilySearchError('WEB_SEARCH_RATE_LIMITED',429)]){
  const f=fixture();f.adapter.search.mockRejectedValue(error);
  expect(await f.run(input(),new AbortController().signal)).toEqual({status:'UNAVAILABLE'});
  expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.adapter.search).toHaveBeenCalledTimes(1);expect(f.observe).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.observe.mock.calls)).not.toContain(key);
 }
});
it('observation failure cannot discard valid success, refund or repeat a search',async()=>{
 const f=fixture();f.observe.mockRejectedValue(new Error('private database error'));
 expect((await f.run(input(),new AbortController().signal)).status).toBe('READY');
 expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.adapter.search).toHaveBeenCalledTimes(1);expect(f.observe).toHaveBeenCalledTimes(1);
});
