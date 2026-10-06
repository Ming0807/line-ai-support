import {beforeEach,describe,expect,it,vi} from 'vitest';
import {unfinishedReviewDraft} from './fixtures/import-review';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),get:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async importOriginal=>({...await importOriginal<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/import-review',()=>({getImportReview:mocks.get,saveImportReview:mocks.save}));
import {ImportStagingError} from '@/lib/imports/import-staging';
import {GET,PUT} from '@/app/api/knowledge/imports/[id]/review/route';
const id='7792f0c7-afb9-4a22-b72f-ab724d14ff22',context={params:Promise.resolve({id})};
const input=()=>({expectedJobRevision:2,expectedExtractionRevision:1,expectedReviewRevision:0,draft:unfinishedReviewDraft()});
const request=(body:unknown)=>new Request(`http://localhost:3000/api/knowledge/imports/${id}/review`,{method:'PUT',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.get.mockResolvedValue({reviewRevision:0,saved:null});mocks.save.mockResolvedValue({reviewRevision:1,stale:false});});
describe('private independent review HTTP boundary',()=>{
 it('rejects foreign origin before authentication and unauthenticated writes before receive',async()=>{
  const foreign=request(input());foreign.headers.set('origin','https://foreign.example');expect((await PUT(foreign,context)).status).toBe(403);expect(mocks.actor).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue(null);const denied=request(input()),reader=vi.spyOn(denied.body!,'getReader');expect((await PUT(denied,context)).status).toBe(401);expect(reader).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
 });
 it('checks active SUPER_ADMIN before body access for both methods',async()=>{
  mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));const denied=request(input()),reader=vi.spyOn(denied.body!,'getReader');
  expect((await PUT(denied,context)).status).toBe(403);expect(reader).not.toHaveBeenCalled();expect((await GET(new Request('http://localhost:3000/'),context)).status).toBe(403);expect(mocks.get).not.toHaveBeenCalled();
 });
 it('returns private no-store state and forwards exact counters/draft/cancellation to backend',async()=>{
  const write=request(input()),response=await PUT(write,context);expect(response.status).toBe(200);expect(await response.json()).toEqual({review:{reviewRevision:1,stale:false}});
  expect(mocks.save).toHaveBeenCalledWith('admin',id,input(),{signal:write.signal});expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
  const read=new Request(`http://localhost:3000/api/knowledge/imports/${id}/review`),got=await GET(read,context);expect(await got.json()).toEqual({review:{reviewRevision:0,saved:null}});expect(mocks.get).toHaveBeenCalledWith('admin',id,{signal:read.signal});expect(got.headers.get('cache-control')).toContain('no-store');
 });
 it('rejects wrong media, malformed JSON, overflow and untrusted approval/metadata/counters',async()=>{
  for(const bad of [{...input(),approved:true},{...input(),expectedJobRevision:-1},{...input(),draft:{...unfinishedReviewDraft(),metadata:{...unfinishedReviewDraft().metadata,table:'students'}}}])expect((await PUT(request(bad),context)).status).toBe(400);
  const wrong=request(input());wrong.headers.set('content-type','text/plain');expect((await PUT(wrong,context)).status).toBe(400);
  const malformed=new Request('http://localhost:3000/',{method:'PUT',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:'{'});expect((await PUT(malformed,context)).status).toBe(400);
  const large=request(input());large.headers.set('content-length',String(2*1024*1024+1));expect((await PUT(large,context)).status).toBe(413);expect(mocks.save).not.toHaveBeenCalled();
 });
 it('returns stale409/not-found404/fixed503 and never logs raw credentials/content',async()=>{
  for(const [code,status] of [['CONFLICT',409],['NOT_FOUND',404]] as const){mocks.save.mockRejectedValue(new ImportStagingError(code));expect((await PUT(request(input()),context)).status).toBe(status);}
  const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.save.mockRejectedValue(new Error('secret token and private draft'));
  const response=await PUT(request(input()),context);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledExactlyOnceWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();
 });
 it('requires authentication on GET and rejects invalid path IDs after active-role preflight',async()=>{
  mocks.actor.mockResolvedValue(null);expect((await GET(new Request('http://localhost:3000/'),context)).status).toBe(401);expect(mocks.get).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue('admin');expect((await PUT(request(input()),{params:Promise.resolve({id:'bad'})})).status).toBe(404);expect(mocks.save).not.toHaveBeenCalled();
 });
});
