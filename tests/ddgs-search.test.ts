import {expect,it,vi} from 'vitest';
import {createDdgsSearchAdapter,DdgsSearchError,type DdgsRunner} from '../lib/knowledge/ddgs-search';

const official={version:1,purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:null};
const general={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null};
const row={title:'การเชื่อมต่อ YRU-WiFi',href:'https://nse.yru.ac.th/page/31',body:'ข้อมูลการเชื่อมต่อ'};
const signal=()=>new AbortController().signal;
function fixture(value:unknown=[row]){
 const runner=vi.fn<DdgsRunner>(async()=>value);
 return {runner,adapter:createDdgsSearchAdapter({pythonPath:'D:\\ddgs\\python.exe',runner})};
}

it('uses only the fixed public question and returns detached bounded leads',async()=>{
 const f=fixture(),result=await f.adapter.search(official,signal());
 expect(result).toEqual([{title:row.title,url:row.href,content:row.body}]);
 expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result[0])).toBe(true);
 const sent=f.runner.mock.calls[0][0];expect(sent.query).toBe('มหาวิทยาลัยราชภัฏยะลา YRU-WiFi คู่มือ');
 expect(JSON.stringify(sent)).not.toMatch(/api.?key|token|secret|authorization/i);
});
it('rejects private or arbitrary question and URLs before subprocess',async()=>{
 for(const request of [{...official,question:'ชื่อส่วนตัว'},{...official,url:'https://example.com/'},{...official,topic:'UNKNOWN'}]){
  const f=fixture();await expect(f.adapter.search(request,signal())).rejects.toMatchObject({code:'DDGS_INVALID'});expect(f.runner).not.toHaveBeenCalled();
 }
});
it('retains only allowed university-domain leads and does not treat filtering as a proven miss',async()=>{
 const f=fixture([row,{...row,href:'https://other.yru.ac.th/path'}]);
 expect((await f.adapter.search(official,signal())).map(r=>r.url)).toEqual([row.href]);
 await expect(fixture([{...row,href:'https://other.yru.ac.th/path'}]).adapter.search(official,signal())).rejects.toMatchObject({code:'DDGS_UNAVAILABLE'});
});
it('rejects invalid and unsafe URLs without fetching them',async()=>{
 for(const href of ['http://nse.yru.ac.th/','https://nse.yru.ac.th.evil.example/','https://u:p@nse.yru.ac.th/',
  'https://127.0.0.1/','https://nse.yru.ac.th:444/','https://nse.yru.ac.th/#a','https://nse.yru.ac.th/a%0A']){
  await expect(fixture([{...row,href}]).adapter.search(official,signal())).rejects.toMatchObject({code:'DDGS_UNAVAILABLE'});
 }
});
it('supports general HTTPS references while rejecting private and malformed output',async()=>{
 expect((await fixture([{...row,href:'https://example.org/help'}]).adapter.search(general,signal()))[0].url).toBe('https://example.org/help');
 for(const rows of [null,{},[],[{}],Array.from({length:9},()=>row),[{...row,title:'x'.repeat(501)}]]){
  await expect(fixture(rows).adapter.search(general,signal())).rejects.toMatchObject({code:'DDGS_UNAVAILABLE'});
 }
});
it('propagates cancellation and never starts if already cancelled',async()=>{
 const f=fixture(),c=new AbortController();c.abort();
 await expect(f.adapter.search(official,c.signal)).rejects.toMatchObject({code:'DDGS_CANCELLED'});expect(f.runner).not.toHaveBeenCalled();
});
it('bounds a runner that ignores its signal and uses fixed errors',async()=>{
 const runner=vi.fn<DdgsRunner>(()=>new Promise(()=>{}));
 const adapter=createDdgsSearchAdapter({pythonPath:'D:\\ddgs\\python.exe',runner,timeoutMs:25});
 await expect(adapter.search(official,signal())).rejects.toMatchObject({code:'DDGS_TIMEOUT'});
});
it('does not expose native error details or credentials',async()=>{
 const runner=vi.fn<DdgsRunner>(async()=>{throw new Error('private secret payload');});
 const adapter=createDdgsSearchAdapter({pythonPath:'D:\\ddgs\\python.exe',runner});
 const error=await adapter.search(official,signal()).catch(e=>e);
 expect(error).toBeInstanceOf(DdgsSearchError);expect(error.message).toBe('DDGS_UNAVAILABLE');
});
