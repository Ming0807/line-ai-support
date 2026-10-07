import {beforeEach,it,expect,vi} from 'vitest';
import {structuredMappingFixture} from './fixtures/structured-mapping';
import {unfinishedReviewDraft} from './fixtures/import-review';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),get:vi.fn(),source:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/import-structured-plan',async original=>({...await original<typeof import('@/lib/imports/import-structured-plan')>(),getImportStructuredPlan:mocks.get,getImportStructuredSource:mocks.source}));
vi.mock('@/lib/imports/import-review',()=>({getImportReview:vi.fn(),saveImportReview:mocks.save}));
import {ImportStagingError} from '@/lib/imports/import-staging';
import {StructuredMappingError} from '@/lib/imports/structured-mapping-contract';
import {GET,POST} from '@/app/api/knowledge/imports/[id]/structured/route';
import {PUT} from '@/app/api/knowledge/imports/[id]/review/route';
const id='123e4567-e89b-42d3-a456-426614174000',context={params:Promise.resolve({id})},url=`http://localhost:3000/api/knowledge/imports/${id}/structured`;
const input=()=>({expectedJobRevision:3,expectedExtractionRevision:7,expectedReviewRevision:0,mapping:structuredMappingFixture('university_systems','HTML').mapping});
const request=(body:unknown)=>new Request(url,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.get.mockResolvedValue({publicationAvailable:false});mocks.source.mockResolvedValue({jobId:id,reviewRevision:0});});
it('rejects foreign origin before auth and no-session before body for GET/POST',async()=>{
 const foreign=request(input());foreign.headers.set('origin','https://foreign.example');expect((await POST(foreign,context)).status).toBe(403);expect(mocks.actor).not.toHaveBeenCalled();
 mocks.actor.mockResolvedValue(null);const denied=request(input()),reader=vi.spyOn(denied.body!,'getReader');expect((await POST(denied,context)).status).toBe(401);expect(reader).not.toHaveBeenCalled();expect((await GET(new Request(url),context)).status).toBe(401);expect(mocks.get).not.toHaveBeenCalled();expect(mocks.source).not.toHaveBeenCalled();
});
it('authorizes active admin before malformed selectors or body reads',async()=>{
 mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));const write=request({bad:true}),reader=vi.spyOn(write.body!,'getReader');
 expect((await POST(write,{params:Promise.resolve({id:'bad'})})).status).toBe(403);expect(reader).not.toHaveBeenCalled();expect((await GET(new Request(url+'?unknown=1'),context)).status).toBe(403);expect(mocks.source).not.toHaveBeenCalled();
});
it('returns private source and prepared preview and forwards cancellation/canonical request',async()=>{
 const read=new Request(url),response=await GET(read,context);expect(await response.json()).toEqual({source:{jobId:id,reviewRevision:0}});expect(mocks.source).toHaveBeenCalledWith('admin',id,{signal:read.signal});
 const write=request(input()),got=await POST(write,context);expect(got.status).toBe(200);expect(await got.json()).toEqual({snapshot:{publicationAvailable:false}});expect(mocks.get).toHaveBeenCalledWith('admin',id,expect.objectContaining({expectedReviewRevision:0}),{signal:write.signal});
 for(const res of [response,got]){expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(res.headers.get('vary')).toBe('Cookie');expect(res.headers.get('x-content-type-options')).toBe('nosniff');}
});
it('rejects malformed selectors/media/json/counters/untrusted rows',async()=>{
 expect((await GET(new Request(url+'?expectedReviewRevision=0'),context)).status).toBe(400);
 expect((await GET(new Request(url),{params:Promise.resolve({id:'bad'})})).status).toBe(404);
 for(const bad of [{...input(),rows:[]},{...input(),expectedReviewRevision:-1},{...input(),expectedReviewRevision:999_999_999},{...input(),mapping:{...input().mapping,dataset:'student_grades'}},{...input(),expectedExtractionRevision:0}])expect((await POST(request(bad),context)).status).toBe(400);
 const media=request(input());media.headers.set('content-type','text/plain');expect((await POST(media,context)).status).toBe(400);
 const malformed=request(input());const invalid=new Request(url,{method:'POST',headers:malformed.headers,body:'{'});expect((await POST(invalid,context)).status).toBe(400);expect(mocks.get).not.toHaveBeenCalled();
});
it('preserves body and nested mapping limit413 through POST and review PUT',async()=>{
 const big=request(input());big.headers.set('content-length',String(2*1024*1024+1));expect((await POST(big,context)).status).toBe(413);
 const mapping={...input().mapping,padding:'x'.repeat(256*1024)};
 const response=await POST(request({...input(),mapping}),context);expect(response.status).toBe(413);expect(await response.json()).toEqual({error:'STRUCTURED_MAPPING_LIMIT_EXCEEDED'});
 const base=unfinishedReviewDraft(),draft={...base,schemaVersion:3,chunkPlan:null,metadata:{...base.metadata,storageMode:'STRUCTURED',datasetType:'university_systems'},structuredMapping:{mapping,acknowledgment:null}};
 const review=new Request(url.replace('/structured','/review'),{method:'PUT',headers:request(input()).headers,body:JSON.stringify({expectedJobRevision:3,expectedExtractionRevision:7,expectedReviewRevision:0,draft})});
 const denied=await PUT(review,context);expect(denied.status).toBe(413);expect(await denied.json()).toEqual({error:'STRUCTURED_MAPPING_LIMIT_EXCEEDED'});expect(mocks.save).not.toHaveBeenCalled();expect(mocks.get).not.toHaveBeenCalled();
});
it('maps safe backend errors and strips fabricated private error locations',async()=>{
 for(const [code,status] of [['STRUCTURED_MAPPING_BINDING_MISMATCH',409],['STRUCTURED_MAPPING_UNSAFE_EXTRACTION',422],['STRUCTURED_SOURCE_INVALID',422],['STRUCTURED_MAPPING_LIMIT_EXCEEDED',413]] as const){mocks.get.mockRejectedValue(new StructuredMappingError(code));expect((await POST(request(input()),context)).status).toBe(status);}
 mocks.get.mockRejectedValue(new StructuredMappingError('STRUCTURED_MAPPING_ROW_INVALID',{tableIndex:0,rowIndex:1,field:'code'}));const valid=await POST(request(input()),context);expect(await valid.json()).toEqual({error:'STRUCTURED_MAPPING_ROW_INVALID',location:{tableIndex:0,rowIndex:1,field:'code'}});
 mocks.get.mockRejectedValue(new StructuredMappingError('STRUCTURED_MAPPING_ROW_INVALID',{tableIndex:0,rowIndex:1,field:'PRIVATE CELL VALUE'}));expect(await (await POST(request(input()),context)).json()).toEqual({error:'STRUCTURED_MAPPING_ROW_INVALID'});
});
it('logs fixed internal errors without credentials/private source',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);try{mocks.get.mockRejectedValue(new Error('private source token'));const got=await POST(request(input()),context);expect(got.status).toBe(503);expect(await got.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledExactlyOnceWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});}finally{log.mockRestore();}
});
