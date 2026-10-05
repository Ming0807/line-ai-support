import {expect,it,vi} from 'vitest';
import {createQuotaReader,quotaState} from '../lib/ai/provider-quota';
import type {QuotaCounter,QuotaState} from '../types/provider-observations';

const BASE_URL='https://openrouter.ai/api/v1';
const KEY='fixture-openrouter-key-never-log';
const NOW=Date.parse('2026-10-04T12:00:00.000Z');
const FRESH_AT=new Date(NOW-60_000).toISOString();

function config(overrides:Partial<{adapter:string;baseUrl:string;apiKey:string}>={}) {
 return {adapter:'OPENROUTER',baseUrl:BASE_URL,apiKey:KEY,...overrides};
}

function keyPayload(data:Record<string,unknown>):unknown {return {data};}

function fetchFor(value:unknown,status=200):typeof fetch {
 return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value),{status}));
}

function counter(overrides:Partial<QuotaCounter>={}):QuotaCounter {
 return {
  scope:'PROVIDER_KEY',unit:'CREDITS',window:'MONTH',source:'OPENROUTER_KEY',
  limit:100,remaining:50,resetAt:null,retryAfterSeconds:null,
  observedAt:FRESH_AT,currency:'USD',...overrides,
 };
}

function state(value:Partial<QuotaCounter>,now=NOW):QuotaState {
 return quotaState(counter(value),now);
}

it('reads the fixed current-key endpoint and maps explicit key credits and shared daily free-model requests',async()=>{
 const fetchImpl=fetchFor(keyPayload({
  label:'sk-or-v1-secret-looking-label',creator_user_id:'private-user-id',
  limit:100,limit_remaining:42.5,limit_reset:'monthly',usage:57.5,
  free_model_daily_requests:{used:42,limit:50,remaining:8},
  rate_limit:{requests:1000,interval:'1h'},
 }));

 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(fetchImpl).toHaveBeenCalledOnce();
 const [url,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 expect(url).toBe(`${BASE_URL}/key`);
 expect(init?.method).toBe('GET');
 expect(init?.redirect).toBe('error');
 expect(init?.signal).toBeInstanceOf(AbortSignal);
 expect(init?.body).toBeUndefined();
 expect(Object.fromEntries(new Headers(init?.headers))).toEqual({authorization:`Bearer ${KEY}`});
 expect(result).toMatchObject({supported:true,httpStatus:200,errorCode:null,observedAt:expect.any(String)});
 expect(result.counters).toHaveLength(2);
 expect(result.counters[0]).toMatchObject({
  scope:'PROVIDER_KEY',unit:'CREDITS',window:'MONTH',source:'OPENROUTER_KEY',
  limit:100,remaining:42.5,resetAt:null,retryAfterSeconds:null,currency:'USD',
 });
 expect(result.counters[1]).toMatchObject({
  scope:'ACCOUNT',unit:'REQUESTS',window:'DAY',source:'OPENROUTER_KEY',
  limit:50,remaining:8,resetAt:null,retryAfterSeconds:null,currency:null,
 });
 expect(JSON.stringify(result)).not.toContain(KEY);
 expect(JSON.stringify(result)).not.toContain('secret-looking-label');
 expect(JSON.stringify(result)).not.toContain('private-user-id');
 expect(result.counters.some((item)=>item.limit===1000)).toBe(false);
});

it('maps unreset key credit caps to TOTAL and leaves resetAt unknown',async()=>{
 const fetchImpl=fetchFor(keyPayload({limit:10,limit_remaining:0,limit_reset:null}));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result.counters).toHaveLength(1);
 expect(result.counters[0]).toMatchObject({scope:'PROVIDER_KEY',unit:'CREDITS',window:'TOTAL',
  limit:10,remaining:0,resetAt:null,currency:'USD'});
 expect(quotaState(result.counters[0]!,Date.parse(result.observedAt))).toBe('EXHAUSTED');
});

it('maps documented daily key credit reset periods but does not invent a reset timestamp',async()=>{
 const fetchImpl=fetchFor(keyPayload({limit:10,limit_remaining:9,limit_reset:'daily'}));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result.counters[0]).toMatchObject({window:'DAY',resetAt:null});
});

it('keeps undocumented weekly windows UNKNOWN instead of coercing them to a month or total',async()=>{
 const fetchImpl=fetchFor(keyPayload({limit:20,limit_remaining:15,limit_reset:'weekly'}));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result.counters[0]).toMatchObject({window:'UNKNOWN',limit:20,remaining:15,resetAt:null});
 expect(quotaState(result.counters[0]!,Date.parse(result.observedAt))).toBe('UNKNOWN');
});

it('does not synthesize counters from missing fields or the deprecated rate_limit object',async()=>{
 const fetchImpl=fetchFor(keyPayload({rate_limit:{requests:1000,interval:'1h'}}));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result).toMatchObject({supported:true,httpStatus:200,errorCode:null,counters:[]});
});

it('keeps incomplete quota evidence as a null counter instead of guessing a remainder',async()=>{
 const fetchImpl=fetchFor(keyPayload({limit:100,limit_reset:'monthly'}));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result.counters[0]).toMatchObject({unit:'CREDITS',limit:100,remaining:null,window:'MONTH'});
 expect(quotaState(result.counters[0]!,Date.parse(result.observedAt))).toBe('UNKNOWN');
});

it.each(['OPENAI','ZEN','FUTURE_PROVIDER'])('returns unsupported for %s without making a request',async(adapter)=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const result=await createQuotaReader({fetchImpl})(config({adapter}),new AbortController().signal);

 expect(result).toMatchObject({supported:false,httpStatus:null,errorCode:null,counters:[]});
 expect(result.observedAt).toEqual(expect.any(String));
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a noncanonical OpenRouter base URL before HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const result=await createQuotaReader({fetchImpl})(config({baseUrl:'https://openrouter.ai.evil.example/api/v1'}),new AbortController().signal);

 expect(result).toMatchObject({supported:true,httpStatus:null,errorCode:'INVALID_REQUEST',counters:[]});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects an empty, whitespace-padded or oversized key before HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const read=createQuotaReader({fetchImpl});

 for(const apiKey of ['',` ${KEY}`,`x`.repeat(513)]){
  await expect(read(config({apiKey}),new AbortController().signal))
   .resolves.toMatchObject({supported:true,httpStatus:null,errorCode:'INVALID_REQUEST',counters:[]});
 }
 expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
 [400,'INVALID_REQUEST'],[401,'AUTH_ERROR'],[402,'INVALID_REQUEST'],[403,'AUTH_ERROR'],
 [404,'MODEL_UNAVAILABLE'],[408,'TIMEOUT'],[429,'RATE_LIMITED'],[500,'SERVER_ERROR'],[503,'SERVER_ERROR'],
] as Array<[number,string]>)('returns fixed HTTP %i status as %s without reading provider error body',async(status,errorCode)=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode(`private provider body with ${KEY}`));},
  cancel(){cancelled=true;},
 }),{status});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);

 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result).toMatchObject({supported:true,httpStatus:status,errorCode,counters:[]});
 expect(cancelled).toBe(true);
 expect(JSON.stringify(result)).not.toContain(KEY);
});

it('normalizes network errors without inventing HTTP status or exposing transport detail',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError(`private host ${KEY}`));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result).toMatchObject({supported:true,httpStatus:null,errorCode:'PROVIDER_UNAVAILABLE',counters:[]});
 expect(JSON.stringify(result)).not.toContain(KEY);
});

it('classifies caller cancellation before HTTP without inventing a status',async()=>{
 const controller=new AbortController();
 controller.abort(new DOMException('private cancellation reason','AbortError'));
 const fetchImpl=vi.fn<typeof fetch>();
 const result=await createQuotaReader({fetchImpl})(config(),controller.signal);

 expect(result).toMatchObject({supported:true,httpStatus:null,errorCode:'CANCELLED',counters:[]});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a redirect through fetch redirect:error and returns a sanitized transport error',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('redirect to private location'));
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result).toMatchObject({httpStatus:null,errorCode:'PROVIDER_UNAVAILABLE'});
 expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
});

it('enforces the 10-second deadline when fetch ignores the supplied signal',async()=>{
 vi.useFakeTimers();
 try{
  let requestSignal:AbortSignal|undefined;
  const fetchImpl=vi.fn<typeof fetch>().mockImplementation((_input,init)=>{
   requestSignal=init?.signal as AbortSignal;
   return new Promise<Response>(()=>{});
  });
  const pending=createQuotaReader({fetchImpl})(config(),new AbortController().signal);

  await vi.advanceTimersByTimeAsync(10_001);
  const result=await pending;

  expect(result).toMatchObject({httpStatus:null,errorCode:'TIMEOUT',counters:[]});
  expect(requestSignal?.aborted).toBe(true);
 }finally{vi.useRealTimers();}
});

it('enforces the 10-second deadline and cancels a body read that never finishes',async()=>{
 vi.useFakeTimers();
 try{
  let cancelled=false;
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
   start(){},cancel(){cancelled=true;},
  }),{status:200}));
  const pending=createQuotaReader({fetchImpl})(config(),new AbortController().signal);

  await vi.advanceTimersByTimeAsync(10_001);
  const result=await pending;

  expect(result).toMatchObject({httpStatus:200,errorCode:'TIMEOUT',counters:[]});
  expect(cancelled).toBe(true);
 }finally{vi.useRealTimers();}
});

it('cancels a declared oversized response without parsing it',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;},
 }),{status:200,headers:{'content-length':String(64*1024+1)}});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result).toMatchObject({httpStatus:200,errorCode:'INVALID_OUTPUT',counters:[]});
 expect(cancelled).toBe(true);
});

it('cancels a streamed response that exceeds 64 KiB',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(64*1024+1));},cancel(){cancelled=true;},
 }),{status:200});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);
 const result=await createQuotaReader({fetchImpl})(config(),new AbortController().signal);

 expect(result).toMatchObject({httpStatus:200,errorCode:'INVALID_OUTPUT',counters:[]});
 expect(cancelled).toBe(true);
});

it('returns safe INVALID_OUTPUT for malformed JSON or malformed quota fields',async()=>{
 const malformedJson=vi.fn<typeof fetch>().mockResolvedValue(new Response('{private response',{
  status:200,headers:{'content-type':'application/json'},
 }));
 const invalidCounter=fetchFor(keyPayload({limit:100,limit_remaining:101,limit_reset:'monthly'}));

 await expect(createQuotaReader({fetchImpl:malformedJson})(config(),new AbortController().signal))
  .resolves.toMatchObject({httpStatus:200,errorCode:'INVALID_OUTPUT',counters:[]});
 await expect(createQuotaReader({fetchImpl:invalidCounter})(config(),new AbortController().signal))
  .resolves.toMatchObject({httpStatus:200,errorCode:'INVALID_OUTPUT',counters:[]});
});

it('maps quota state with an app-chosen 10 percent warning and separates exhaustion',()=>{
 expect(state({limit:100,remaining:10})).toBe('NEAR_LIMIT');
 expect(state({limit:100,remaining:11})).toBe('AVAILABLE');
 expect(state({limit:100,remaining:0})).toBe('EXHAUSTED');
 expect(state({limit:0,remaining:0})).toBe('EXHAUSTED');
});

it.each([
 ['unknown or unlimited counts',{limit:null,remaining:null}],
 ['a missing limit',{limit:null,remaining:2}],
 ['negative values',{limit:10,remaining:-1}],
 ['remaining above limit',{limit:10,remaining:11}],
 ['non-finite values',{limit:10,remaining:Number.NaN}],
 ['a non-credit currency on credits',{unit:'CREDITS',currency:null}],
 ['currency on request counts',{unit:'REQUESTS',currency:'USD'}],
 ['unknown windows',{window:'UNKNOWN'}],
 ['an unsupported source',{source:'OTHER'}],
 ['a key credit counter with account scope',{unit:'CREDITS',scope:'ACCOUNT'}],
 ['a shared daily request counter with key scope',{unit:'REQUESTS',scope:'PROVIDER_KEY',window:'DAY'}],
] as Array<[string,Partial<QuotaCounter>]>)('returns UNKNOWN for %s',(_label,overrides)=>{
 expect(state(overrides)).toBe('UNKNOWN');
});

it.each([
 ['older than the app freshness window',{observedAt:new Date(NOW-5*60_000-1).toISOString()}],
 ['exactly at the app freshness window',{observedAt:new Date(NOW-5*60_000).toISOString()}],
 ['future-dated',{observedAt:new Date(NOW+1).toISOString()}],
 ['malformed timestamp',{observedAt:'not-a-timestamp'}],
 ['past reset boundary',{resetAt:new Date(NOW-1).toISOString()}],
 ['malformed reset timestamp',{resetAt:'next week'}],
] as Array<[string,Partial<QuotaCounter>]>)('returns UNKNOWN for %s counters',(_label,overrides)=>{
 expect(state(overrides)).toBe('UNKNOWN');
});

it('returns UNKNOWN when the evaluation clock is invalid',()=>{
 expect(state({},Number.NaN)).toBe('UNKNOWN');
});
