import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {createWebSearchRuntime} from '../lib/knowledge/web-search-runtime';
import {TavilySearchError,type TavilyUsage} from '../lib/knowledge/tavily-search';
import type {WebSearchRequest,WebSearchAdmission,WebSearchObservation} from '../lib/knowledge/web-search-admission';
import type {DdgsAdapter} from '../lib/knowledge/ddgs-web-runtime';

const master=Buffer.alloc(32,81).toString('base64'),key='synthetic-search-key',now=Date.parse('2026-10-28T00:00:00.000Z');
const config={enabled:true,apiKey:key,attestation:{mode:'RESEARCHER_NO_PAYG',keySha256:createHash('sha256').update(key).digest('hex'),attestedAt:new Date(now-1000).toISOString()}};
const request=()=>({consumer:'STUDENT',operationId:randomUUID(),ownerId:randomUUID(),purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:null});
const usage:TavilyUsage={currentPlan:'Researcher',keyUsage:0,keyLimit:500,planUsage:0,planLimit:1000,paygoUsage:0,paygoLimit:null};
const lead={title:'คู่มือ YRU Wi-Fi',url:'https://nse.yru.ac.th/page/31/help.html',content:'ข้อมูลอ้างอิง'};
const pools:Pool[]=[];
function fixture(overrides:Record<string,unknown>={}){
 const pool=new Pool({max:1});pools.push(pool);
 const adapter={usage:vi.fn(async()=>usage),search:vi.fn(async()=>({requestId:randomUUID(),credits:1 as const,results:[]}))};
 const ddgsAdapter={search:vi.fn<DdgsAdapter['search']>(async()=>[lead])};
 const reserve=vi.fn<(request:WebSearchRequest,provider?:'TAVILY'|'DDGS')=>Promise<WebSearchAdmission>>(async()=>({status:'RESERVED',attemptId:randomUUID()}));
 const observe=vi.fn<(attemptId:string,value:WebSearchObservation)=>Promise<boolean>>(async()=>true),preflight=vi.fn(async()=>true);
 const options={pool,encryptionKey:master,config,now:()=>now,adapter,reserve,observe,preflight,
  ddgs:{enabled:true,pythonPath:'D:\\fixture\\python.exe'},ddgsAdapter,...overrides};
 return {run:createWebSearchRuntime(options),adapter,ddgsAdapter,reserve,observe,preflight};
}
afterEach(()=>Promise.all(pools.splice(0).map(pool=>pool.end())));
const signal=()=>new AbortController().signal;
it('commits a DDGS reservation before searching when Tavily is unconfigured and records no invented provider metadata',async()=>{
 const f=fixture({config:undefined}),req=request();
 f.ddgsAdapter.search.mockImplementation(async()=>{expect(f.reserve).toHaveBeenCalledWith(expect.anything(),'DDGS');return [lead];});
 const result=await f.run(req,signal());
 expect(result).toMatchObject({status:'READY',provider:'DDGS',result:{results:[lead]}});
 expect(f.observe).toHaveBeenCalledWith(expect.any(String),{kind:'DDGS_SUCCESS'});
 expect(JSON.stringify(result)).not.toMatch(/requestId|credits|score/);
 expect(f.ddgsAdapter.search).toHaveBeenCalledWith({version:1,purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:null},expect.any(AbortSignal));
});
it('keeps a successful primary response without searching DDGS',async()=>{
 const f=fixture();expect((await f.run(request(),signal())).status).toBe('READY');
 expect(f.ddgsAdapter.search).not.toHaveBeenCalled();expect(f.reserve).toHaveBeenCalledTimes(1);
});
it('uses DDGS once when the free Tavily account quota is exhausted',async()=>{
 const f=fixture();f.adapter.usage.mockResolvedValue({...usage,keyUsage:500});
 expect(await f.run(request(),signal())).toMatchObject({status:'READY',provider:'DDGS'});
 expect(f.adapter.search).not.toHaveBeenCalled();expect(f.ddgsAdapter.search).toHaveBeenCalledTimes(1);
});
it('retains a timed-out primary admission and bounds fallback to one separate provider attempt',async()=>{
 const f=fixture();f.adapter.search.mockRejectedValue(new TavilySearchError('WEB_SEARCH_TIMEOUT'));
 expect(await f.run(request(),signal())).toMatchObject({status:'READY',provider:'DDGS'});
 expect(f.reserve).toHaveBeenCalledTimes(2);expect(f.adapter.search).toHaveBeenCalledTimes(1);expect(f.ddgsAdapter.search).toHaveBeenCalledTimes(1);
 expect(f.observe.mock.calls.map(call=>call[1])).toEqual([{kind:'ERROR',httpStatus:null},{kind:'DDGS_SUCCESS'}]);
});
it('never falls through to another provider on a duplicate or uncertain replay',async()=>{
 const f=fixture();f.reserve.mockResolvedValue({status:'DUPLICATE'});
 expect(await f.run(request(),signal())).toEqual({status:'ALREADY_ATTEMPTED'});
 expect(f.ddgsAdapter.search).not.toHaveBeenCalled();expect(f.reserve).toHaveBeenCalledTimes(1);
});
it('uncertain Tavily reservation acknowledgement or rejection cannot authorize another provider',async()=>{
 for(const rejected of [false,true]){
  const f=fixture();
  if(rejected)f.reserve.mockRejectedValue(new Error('UNCERTAIN_COMMIT'));else f.reserve.mockResolvedValue({status:'UNAVAILABLE'});
  expect(await f.run(request(),signal())).toEqual({status:'UNAVAILABLE'});
  expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.ddgsAdapter.search).not.toHaveBeenCalled();
 }
});
it('fresh source denial before reservation, after reservation or after response blocks fallback output',async()=>{
 for(const allowed of [[false],[true,false],[true,true,false]]){
  const preflight=vi.fn();for(const value of allowed)preflight.mockResolvedValueOnce(value);
  const f=fixture({config:undefined,preflight});
  expect(await f.run(request(),signal())).toEqual({status:'UNAVAILABLE'});
  expect(f.reserve).toHaveBeenCalledTimes(allowed.length===1?0:1);expect(f.ddgsAdapter.search).toHaveBeenCalledTimes(allowed.length===3?1:0);
 }
});
it('cancellation after reservation consumes the admission without search',async()=>{
 const f=fixture({config:undefined}),controller=new AbortController();
 f.reserve.mockImplementation(async()=>{controller.abort();return {status:'RESERVED',attemptId:randomUUID()};});
 expect(await f.run(request(),controller.signal)).toEqual({status:'UNAVAILABLE'});expect(f.ddgsAdapter.search).not.toHaveBeenCalled();
});
it('DDGS failure never retries or exposes native error details',async()=>{
 const f=fixture({config:undefined});f.ddgsAdapter.search.mockRejectedValue(new Error('private credential diagnostic'));
 expect(await f.run(request(),signal())).toEqual({status:'UNAVAILABLE'});expect(f.ddgsAdapter.search).toHaveBeenCalledTimes(1);
 expect(f.observe).toHaveBeenCalledWith(expect.any(String),{kind:'ERROR',httpStatus:null});
});
it('missing, disabled or relative-path DDGS configuration never starts the runner',async()=>{
 for(const ddgs of [undefined,{enabled:false,pythonPath:'D:\\python.exe'},{enabled:true,pythonPath:'relative/python.exe'}]){
  const f=fixture({config:undefined,ddgs});expect((await f.run(request(),signal())).status).toBe('NOT_CONFIGURED');
  expect(f.ddgsAdapter.search).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
 }
});
it('DDGS duplicate, shared-cap exhaustion and unavailable admission start no search',async()=>{
 for(const [status,result] of [['DUPLICATE','ALREADY_ATTEMPTED'],['EXHAUSTED','QUOTA_EXHAUSTED'],['UNAVAILABLE','UNAVAILABLE']] as const){
  const f=fixture({config:undefined});f.reserve.mockResolvedValue({status});
  expect(await f.run(request(),signal())).toEqual({status:result});expect(f.ddgsAdapter.search).not.toHaveBeenCalled();
 }
});
it('an empty DDGS response is unavailable and never an official-empty success',async()=>{
 const f=fixture({config:undefined});f.ddgsAdapter.search.mockResolvedValue([]);
 expect(await f.run(request(),signal())).toEqual({status:'UNAVAILABLE'});
 expect(f.observe).toHaveBeenCalledWith(expect.any(String),{kind:'ERROR',httpStatus:null});
});
