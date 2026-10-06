import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),approve:vi.fn(),get:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/import-publication',async original=>({...await original<typeof import('@/lib/imports/import-publication')>(),approveImport:mocks.approve,getImportPublication:mocks.get}));
import {POST} from '@/app/api/knowledge/approve/route';
import {GET} from '@/app/api/knowledge/imports/[id]/publication/route';
import {ImportStagingError} from '@/lib/imports/import-staging';
import {PublicationPolicyError,type PublicationPolicyCode} from '@/lib/imports/publication-contract';
import {ImportChunkPlanError} from '@/lib/imports/chunk-preparation';
const id='33333333-3333-4333-8333-333333333333',context={params:Promise.resolve({id})};
const input={id,expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:2,confirmPublication:true};
const request=(body:unknown=input)=>new Request('http://localhost:3000/api/knowledge/approve',{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.approve.mockResolvedValue({receipt:{jobId:id},replayed:false});mocks.get.mockResolvedValue({receipt:null});});
it('requires same origin and authenticated active administrator before receiving confirmation body',async()=>{
 const foreign=request();foreign.headers.set('origin','https://foreign.example');expect((await POST(foreign)).status).toBe(403);expect(mocks.actor).not.toHaveBeenCalled();
 const anonymous=request(),reader=vi.spyOn(anonymous.body!,'getReader');mocks.actor.mockResolvedValue(null);expect((await POST(anonymous)).status).toBe(401);expect(reader).not.toHaveBeenCalled();
 mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));const denied=request(),deniedReader=vi.spyOn(denied.body!,'getReader');expect((await POST(denied)).status).toBe(403);expect(deniedReader).not.toHaveBeenCalled();expect(mocks.approve).not.toHaveBeenCalled();
});
it('forwards only strict confirmation and cancellation and returns private completed/replayed receipt',async()=>{
 for(const replayed of [false,true]){mocks.approve.mockResolvedValue({receipt:{jobId:id},replayed});const received=request(),response=await POST(received);
 expect(await response.json()).toEqual({publication:{receipt:{jobId:id},replayed}});expect(mocks.approve).toHaveBeenLastCalledWith('admin',input,{signal:received.signal});
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');expect(response.headers.get('x-content-type-options')).toBe('nosniff');}
});
it('rejects unauthorized source, metadata, vectors, model, SQL, test seams and missing confirmation',async()=>{
 for(const key of ['metadata','text','vectors','model','sql','failureAt','preparationTimeoutMs','beforeCommit','sourceLocations','actor'])expect((await POST(request({...input,[key]:'untrusted'}))).status).toBe(400);
 for(const body of [{...input,confirmPublication:false},{...input,expectedReviewRevision:0},{...input,id:'bad'}])expect((await POST(request(body))).status).toBe(400);
 expect(mocks.approve).not.toHaveBeenCalled();
});
it('bounds media, received bytes and JSON before publication',async()=>{
 const media=request();media.headers.set('content-type','text/plain');expect((await POST(media)).status).toBe(400);
 const large=request();large.headers.set('content-length','2049');expect((await POST(large)).status).toBe(413);
 const streamed=request('x'.repeat(2100));expect((await POST(streamed)).status).toBe(413);
 const malformed=request();expect((await POST(new Request(malformed.url,{method:'POST',headers:malformed.headers,body:'{'}))).status).toBe(400);expect(mocks.approve).not.toHaveBeenCalled();
});
it.each<[PublicationPolicyCode,number]>([['PUBLICATION_REVIEW_INCOMPLETE',422],['PUBLICATION_PLAN_MISMATCH',409],['PUBLICATION_WARNINGS_UNRESOLVED',422],['PUBLICATION_QUALITY_REANALYSIS_REQUIRED',422],['PUBLICATION_PUBLIC_SENSITIVE_DATA',422],['PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE',409]])('returns fixed policy %s as %i without exposing source',async(code,status)=>{
 mocks.approve.mockRejectedValue(new PublicationPolicyError(code));const response=await POST(request());expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});expect(response.headers.get('cache-control')).toContain('no-store');
});
it('normalizes conflicts, preparation timeout/unavailability and arbitrary sensitive errors',async()=>{
 for(const [error,status] of [[new ImportStagingError('CONFLICT'),409],[new ImportStagingError('NOT_FOUND'),404],[new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408),408],[new ImportChunkPlanError('CHUNK_PLAN_UNAVAILABLE',503),503]] as const){mocks.approve.mockRejectedValue(error);expect((await POST(request())).status).toBe(status);}
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.approve.mockRejectedValue(new Error('secret access token and original source'));
 const response=await POST(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();
});
it('reads only private completion receipt with active-admin preflight before path/query parsing',async()=>{
 const read=new Request(`http://localhost:3000/api/knowledge/imports/${id}/publication`),response=await GET(read,context);expect(await response.json()).toEqual({publication:{receipt:null}});expect(mocks.get).toHaveBeenCalledWith('admin',id,{signal:read.signal});expect(mocks.approve).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store');
 mocks.actor.mockResolvedValue(null);expect((await GET(read,context)).status).toBe(401);
 mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));expect((await GET(new Request(read.url+'?sql=untrusted'),{params:Promise.resolve({id:'bad'})})).status).toBe(403);
});
it('receipt lookup rejects malformed IDs/selectors and returns safe unavailable errors',async()=>{
 const url=`http://localhost:3000/api/knowledge/imports/${id}/publication`;expect((await GET(new Request(url),{params:Promise.resolve({id:'bad'})})).status).toBe(404);
 expect((await GET(new Request(url+'?model=untrusted'),context)).status).toBe(400);expect(mocks.get).not.toHaveBeenCalled();
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.get.mockRejectedValue(new Error('private original secret'));expect((await GET(new Request(url),context)).status).toBe(503);expect(log).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();
});
