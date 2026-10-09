import {afterEach,expect,it,vi} from 'vitest';
import {createTavilySearchAdapter} from '../lib/knowledge/tavily-search';
import type {CompatibleHttpResponse,PinnedHttpsRequest} from '../lib/ai/compatible-network';
import {AIProviderError} from '../lib/ai/types';

const key='synthetic-web-key';
const official={version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2569};
const general={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null};
const requestId='123e4567-e89b-42d3-a456-426614174111';
const candidate={title:'ปฏิทินวิชาการ',url:'https://acdservice.yru.ac.th/page/41',content:'รายการประกาศ',score:0.8};
const searchJson=(results:unknown[]=[{...candidate}])=>({request_id:requestId,usage:{credits:1},results,query:'ignored echo',answer:'ignored answer'});
const usageJson=()=>({key:{usage:2,limit:1000,search_usage:2},account:{current_plan:'Researcher',plan_usage:4,plan_limit:1000,paygo_usage:0,paygo_limit:0}});
const response=(json:unknown,status=200):CompatibleHttpResponse=>({status,contentType:'application/json',retryAfter:null,json});
function fixture(json:unknown=searchJson(),status=200){
 const resolve=vi.fn<(hostname:string,signal:AbortSignal)=>Promise<{address:string;family:4}[]>>(async()=>[{address:'8.8.8.8',family:4}]);
 const send=vi.fn<PinnedHttpsRequest>(async()=>response(json,status));
 const adapter=createTavilySearchAdapter({resolvePublicAddresses:resolve,requestImpl:send});
 return {adapter,resolve,send};
}
const signal=()=>new AbortController().signal;
afterEach(()=>vi.useRealTimers());

it('emits the fixed minimized basic request to the pinned search endpoint',async()=>{
 const f=fixture();await f.adapter.search(official,key,signal());
 expect(f.resolve).toHaveBeenCalledTimes(1);expect(f.resolve.mock.calls[0][0]).toBe('api.tavily.com');
 const sent=f.send.mock.calls[0][0];
 expect(sent.url.href).toBe('https://api.tavily.com/search');expect(sent.method).toBe('POST');
 expect(sent.pinnedAddress).toEqual({address:'8.8.8.8',family:4});expect(sent.maxResponseBytes).toBe(256*1024);
 expect(sent.headers.Authorization).toBe(`Bearer ${key}`);expect(sent.headers['Content-Type']).toBe('application/json');
 expect(Number(sent.headers['Content-Length'])).toBe(sent.body?.byteLength);
 expect(JSON.parse(new TextDecoder().decode(sent.body!))).toEqual({
  query:'มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ ปีการศึกษา 2569',topic:'general',search_depth:'basic',max_results:3,
  include_domains:['acdservice.yru.ac.th','eduservice.yru.ac.th'],include_domains_mode:'restrict',include_answer:false,
  include_raw_content:false,include_images:false,include_image_descriptions:false,include_favicon:false,auto_parameters:false,include_usage:true,
 });
});

it('GET usage projects only bounded account observations and remains detached and frozen',async()=>{
 const json=usageJson(),f=fixture(json),result=await f.adapter.usage(key,signal());
 expect(result).toEqual({keyUsage:2,keyLimit:1000,currentPlan:'Researcher',planUsage:4,planLimit:1000,paygoUsage:0,paygoLimit:0});
 const sent=f.send.mock.calls[0][0];expect(sent.url.href).toBe('https://api.tavily.com/usage');
 expect(sent.method).toBe('GET');expect(sent.body).toBeNull();expect(sent.maxResponseBytes).toBe(32*1024);
 expect(Object.isFrozen(result)).toBe(true);json.key.usage=100;expect(result.keyUsage).toBe(2);
});

it('returns detached immutable candidates without provider echo or generated answers',async()=>{
 const json=searchJson(),f=fixture(json),result=await f.adapter.search(official,key,signal());
 expect(result).toEqual({requestId,credits:1,results:[candidate]});
 expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.results)).toBe(true);expect(Object.isFrozen(result.results[0])).toBe(true);
 (json.results[0] as typeof candidate).content='changed';expect(result.results[0].content).toBe('รายการประกาศ');
});

it('accepts complete empty search and does not treat malformed success as a miss',async()=>{
 expect((await fixture(searchJson([])).adapter.search(official,key,signal())).results).toEqual([]);
 for(const json of [null,{}, {...searchJson([]),usage:{credits:2}},{...searchJson([]),request_id:'not-uuid'},
  searchJson([candidate,candidate,candidate,candidate]),searchJson([{...candidate,score:NaN}]),searchJson([{...candidate,content:'x'.repeat(4001)}])]){
  await expect(fixture(json).adapter.search(official,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});
 }
});

it('rejects unsafe/raw inputs and keys before DNS or HTTP',async()=>{
 for(const input of [{...official,query:'private case text'},{...official,url:'https://attacker.example/'},{...official,topic:'PRIVATE'},
  {...official,purpose:'GENERAL_PUBLIC'}]){
  const f=fixture();await expect(f.adapter.search(input,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_INVALID'});
  expect(f.resolve).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
 }
 for(const badKey of ['',key+'\n',key+' value','x'.repeat(513)]){
  const f=fixture();await expect(f.adapter.usage(badKey,signal())).rejects.toMatchObject({code:'WEB_SEARCH_INVALID'});
  expect(f.resolve).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
 }
});

it('rejects cancelled calls before starting any network operation',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await expect(f.adapter.search(official,key,controller.signal)).rejects.toMatchObject({code:'WEB_SEARCH_CANCELLED'});
 await expect(f.adapter.usage(key,controller.signal)).rejects.toMatchObject({code:'WEB_SEARCH_CANCELLED'});
 expect(f.resolve).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});

it('rejects private, empty, oversized or mixed DNS answer sets without sending',async()=>{
 for(const addresses of [[],[{address:'127.0.0.1',family:4}], [{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],
  Array.from({length:65},()=>({address:'8.8.8.8',family:4}))]){
  const send=vi.fn<PinnedHttpsRequest>(),adapter=createTavilySearchAdapter({resolvePublicAddresses:async()=>addresses as {address:string;family:4}[],requestImpl:send});
  await expect(adapter.search(official,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});expect(send).not.toHaveBeenCalled();
 }
});

it('accepts only official allowed host or its subdomains and does not fetch result URLs',async()=>{
 const f=fixture(searchJson([{...candidate,url:'https://calendar.acdservice.yru.ac.th/page/41'}]));
 await f.adapter.search(official,key,signal());expect(f.send).toHaveBeenCalledTimes(1);expect(f.resolve).toHaveBeenCalledTimes(1);
 for(const url of ['https://acdservice.yru.ac.th.attacker.example/page/41','https://other.yru.ac.th/page/41','https://unrelated.example/']){
  await expect(fixture(searchJson([{...candidate,url}])).adapter.search(official,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});
 }
});

it('general candidates remain bounded HTTPS leads with no university domain restriction',async()=>{
 const f=fixture(searchJson([{...candidate,url:'https://support.example.org/help'}]));
 const result=await f.adapter.search(general,key,signal());expect(result.results[0].url).toBe('https://support.example.org/help');
 const body=JSON.parse(new TextDecoder().decode(f.send.mock.calls[0][0].body!));
 expect(body.query).toBe('Wi-Fi connection troubleshooting');expect(body.include_domains).toEqual([]);
});

it('rejects unsafe and noncanonical candidate URLs for both purposes',async()=>{
 for(const url of ['http://support.example.org/','https://127.0.0.1/','https://[::1]/','https://user:pass@support.example.org/',
  'https://support.example.org:8443/','https://support.example.org/#part','https://support.example.org/a\\b','https://support.example.org/a\nb',
  'https://support.example.org/%0a','https://support.example.org/%5c','https://support.example.org./','https://SUPPORT.example.org/']){
  await expect(fixture(searchJson([{...candidate,url}])).adapter.search(general,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});
 }
});

it('maps HTTP failures safely and never retries or follows redirects',async()=>{
 for(const [status,code] of [[301,'WEB_SEARCH_UNAVAILABLE'],[401,'WEB_SEARCH_UNAVAILABLE'],[429,'WEB_SEARCH_RATE_LIMITED'],
  [432,'WEB_SEARCH_FREE_LIMIT'],[433,'WEB_SEARCH_FREE_LIMIT'],[500,'WEB_SEARCH_UNAVAILABLE'],[204,'WEB_SEARCH_UNAVAILABLE']] as const){
  const f=fixture({detail:`private ${key}`},status);await expect(f.adapter.search(official,key,signal())).rejects.toMatchObject({code,httpStatus:status,message:code});
  expect(f.send).toHaveBeenCalledTimes(1);
 }
});

it('validates usage integers and never invents plan or free eligibility',async()=>{
 for(const json of [null,{}, {...usageJson(),key:{usage:-1,limit:1000}},
  {...usageJson(),account:{...usageJson().account,paygo_limit:undefined}},
  {...usageJson(),account:{...usageJson().account,plan_usage:Number.MAX_SAFE_INTEGER+1}}]){
  await expect(fixture(json).adapter.usage(key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});
 }
 const json=usageJson();json.account.current_plan='Bootstrap';expect((await fixture(json).adapter.usage(key,signal())).currentPlan).toBe('Bootstrap');
});

it('bounds injected JSON and avoids executing provider object accessors',async()=>{
 let calls=0;const json=searchJson();Object.defineProperty(json,'extra',{enumerable:true,get(){calls++;return key;}});
 await expect(fixture(json).adapter.search(official,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});expect(calls).toBe(0);
 await expect(fixture({...searchJson(),extra:'x'.repeat(256*1024)}).adapter.search(official,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_UNAVAILABLE'});
});

it('enforces the whole usage deadline even when DNS ignores cancellation',async()=>{
 vi.useFakeTimers();const send=vi.fn<PinnedHttpsRequest>(),adapter=createTavilySearchAdapter({resolvePublicAddresses:()=>new Promise(()=>{}),requestImpl:send});
 const checked=expect(adapter.usage(key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_TIMEOUT'});
 await vi.advanceTimersByTimeAsync(4000);await checked;expect(send).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});

it('enforces the search deadline and consumes an ignoring transport late rejection',async()=>{
 vi.useFakeTimers();let fail!:(error:unknown)=>void;
 const f=fixture();f.send.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 const checked=expect(f.adapter.search(official,key,signal())).rejects.toMatchObject({code:'WEB_SEARCH_TIMEOUT'});
 await vi.advanceTimersByTimeAsync(8000);await checked;fail(new Error(`private ${key}`));await Promise.resolve();expect(vi.getTimerCount()).toBe(0);
});

it('parent cancellation releases timers and prevents a late resolver from sending',async()=>{
 vi.useFakeTimers();let finish!:(addresses:{address:string;family:4}[])=>void;const send=vi.fn<PinnedHttpsRequest>();
 const adapter=createTavilySearchAdapter({resolvePublicAddresses:()=>new Promise(resolve=>{finish=resolve;}),requestImpl:send});
 const controller=new AbortController(),checked=expect(adapter.search(official,key,controller.signal)).rejects.toMatchObject({code:'WEB_SEARCH_CANCELLED'});
 await Promise.resolve();controller.abort();await checked;finish([{address:'8.8.8.8',family:4}]);await Promise.resolve();
 expect(send).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});

it('projects native or unexpected failures into fixed errors without raw credentials',async()=>{
 for(const error of [new Error(`private ${key}`),new AIProviderError('INVALID_OUTPUT',200)]){
  const f=fixture();f.send.mockRejectedValue(error);
  await expect(f.adapter.search(official,key,signal())).rejects.toMatchObject({message:'WEB_SEARCH_UNAVAILABLE',code:'WEB_SEARCH_UNAVAILABLE'});
 }
});
