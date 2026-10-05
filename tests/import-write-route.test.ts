import {beforeEach,expect,it,vi} from 'vitest';
import {POST} from '../app/api/knowledge/import/route';
import {ImportStagingError} from '../lib/imports/import-staging';
import {OfficialUrlImportError} from '../lib/imports/url-importer';
const mocks=vi.hoisted(()=>({staff:vi.fn(),authorize:vi.fn(),upload:vi.fn(),url:vi.fn()}));
vi.mock('../lib/tickets/api',()=>({apiStaffId:mocks.staff}));
vi.mock('../lib/imports/import-staging',async original=>({...await original<typeof import('../lib/imports/import-staging')>(),
 authorizeImportAdmin:mocks.authorize,createImportJob:mocks.upload,createOfficialUrlImportJob:mocks.url}));
const endpoint='http://localhost:3000/api/knowledge/import',actor='11111111-1111-4111-8111-111111111111',result={job:{id:'22222222-2222-4222-8222-222222222222',status:'READY',revision:0},duplicate:false};
beforeEach(()=>{vi.clearAllMocks();mocks.staff.mockResolvedValue(actor);mocks.authorize.mockResolvedValue(undefined);mocks.upload.mockResolvedValue(result);mocks.url.mockResolvedValue(result);});
function uploadRequest(edit?:(form:FormData)=>void):Request{
 const form=new FormData();form.set('file',new File([new TextEncoder().encode('กิจกรรม,วัน\nลงทะเบียน,1 สิงหาคม')],'calendar.csv',{type:'text/csv'}));
 form.set('sourceUrl','https://yru.ac.th/calendar');edit?.(form);return new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000'},body:form});
}
function urlRequest(body:unknown={url:'https://yru.ac.th/calendar.csv'}):Request{return new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});}
it('requires same-origin and verified authentication before processing an import',async()=>{
 const foreign=new Request(endpoint,{method:'POST',headers:{origin:'https://external.invalid',host:'localhost:3000','content-type':'application/json'},body:'{}'});
 expect((await POST(foreign)).status).toBe(403);expect(mocks.staff).not.toHaveBeenCalled();
 mocks.staff.mockResolvedValue(null);expect((await POST(urlRequest())).status).toBe(401);expect(mocks.authorize).not.toHaveBeenCalled();expect(mocks.url).not.toHaveBeenCalled();
});
it('checks active admin before reading a body or invoking acquisition',async()=>{
 const request=urlRequest(),read=vi.spyOn(request,'arrayBuffer');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));
 const response=await POST(request);expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'FORBIDDEN'});expect(read).not.toHaveBeenCalled();expect(mocks.url).not.toHaveBeenCalled();
});
it('stages an exact upload with provenance without analyzing or publishing it',async()=>{
 const response=await POST(uploadRequest());expect(response.status).toBe(201);expect(await response.json()).toEqual(result);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(mocks.authorize).toHaveBeenCalledWith(actor);expect(mocks.upload).toHaveBeenCalledWith(actor,expect.objectContaining({filename:'calendar.csv',format:'CSV',sourceUrl:'https://yru.ac.th/calendar',acquiredFrom:'UPLOAD',fetchedAt:null}));
 const bytes=mocks.upload.mock.calls[0][1].bytes;expect(new TextDecoder().decode(bytes)).toBe('กิจกรรม,วัน\nลงทะเบียน,1 สิงหาคม');expect(mocks.url).not.toHaveBeenCalled();
});
it('sends strict URL input through the authorized acquisition service and returns a duplicate without another publication',async()=>{
 mocks.url.mockResolvedValue({...result,duplicate:true});const request=urlRequest();const response=await POST(request);expect(response.status).toBe(200);expect((await response.json()).duplicate).toBe(true);
 expect(mocks.url).toHaveBeenCalledWith(actor,'https://yru.ac.th/calendar.csv',{}, {signal:request.signal});expect(mocks.upload).not.toHaveBeenCalled();
});
it('rejects unsupported, missing, multiple-file or extra multipart fields',async()=>{
 for(const edit of [(form:FormData)=>form.delete('file'),(form:FormData)=>form.append('file',new File(['x'],'second.csv')),
  (form:FormData)=>form.set('file',new File(['x'],'executable.exe')),(form:FormData)=>form.set('approved','true')]){
  const response=await POST(uploadRequest(edit));expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'INVALID_REQUEST'});
 }
 expect(mocks.upload).not.toHaveBeenCalled();
});
it('rejects unknown URL properties, malformed JSON and unsupported content types',async()=>{
 for(const request of [urlRequest({url:'https://yru.ac.th/x',approved:true}),urlRequest({}),
  new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:'{bad'}),
  new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'text/plain'},body:'x'})])expect((await POST(request)).status).toBe(400);
 expect(mocks.url).not.toHaveBeenCalled();
});
it('bounds declared and streamed bodies and cancels oversized reads',async()=>{
 const declared=new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json','content-length':'9000'},body:'{}'});
 expect((await POST(declared)).status).toBe(413);
 const cancelled=vi.fn(),body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(9000));},cancel:cancelled});
 const streamed=new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body,duplex:'half'} as RequestInit);
 expect((await POST(streamed)).status).toBe(413);expect(cancelled).toHaveBeenCalled();expect(mocks.url).not.toHaveBeenCalled();
});
it('bounds body receive time and cancels an unfinished upload',async()=>{
 vi.useFakeTimers();const cancelled=vi.fn();try{
  const body=new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>{}),cancel:cancelled});
  const request=new Request(endpoint,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body,duplex:'half'} as RequestInit);
  const pending=POST(request);await vi.advanceTimersByTimeAsync(10_000);const response=await pending;expect(response.status).toBe(408);expect(cancelled).toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it.each([['IMPORT_URL_INVALID',400],['IMPORT_URL_UNAVAILABLE',503],['IMPORT_URL_TIMEOUT',408],['IMPORT_URL_TOO_LARGE',413]] as const)('maps %s without exposing upstream details',async(code,status)=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);try{mocks.url.mockRejectedValue(new OfficialUrlImportError(code));const response=await POST(urlRequest());expect(response.status).toBe(status);expect((await response.json()).error).toMatch(/^[A-Z_]+$/);expect(response.headers.get('cache-control')).toContain('no-store');}finally{log.mockRestore();}
});
