import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),get:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async importOriginal=>({...await importOriginal<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/version-resolver',async importOriginal=>({...await importOriginal<typeof import('@/lib/imports/version-resolver')>(),getImportVersionResolution:mocks.get}));
import {ImportStagingError} from '@/lib/imports/import-staging';
import {GET} from '@/app/api/knowledge/imports/[id]/versions/route';
const id='f0697487-e73a-4f66-9d53-bb34e1c10880',context={params:Promise.resolve({id})};
const query='expectedJobRevision=2&expectedExtractionRevision=2&expectedReviewRevision=1';
const request=(suffix=query)=>new Request(`http://localhost:3000/api/knowledge/imports/${id}/versions?${suffix}`);
const result={jobId:id,jobRevision:2,extractionRevision:2,reviewRevision:1,family:null,missingMetadata:[],availableActions:['NEW_FAMILY'],candidates:[],limitExceeded:false,currentStreamOccupied:false};
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.get.mockResolvedValue(result);});
describe('private version lookup only uses the saved reviewed snapshot',()=>{
 it('requires a session before private lookup',async()=>{mocks.actor.mockResolvedValue(null);expect((await GET(request(),context)).status).toBe(401);expect(mocks.authorize).not.toHaveBeenCalled();expect(mocks.get).not.toHaveBeenCalled();});
 it('performs active-role preflight before parsing query/path and returns safe denial',async()=>{mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));expect((await GET(request('sql=select'),{params:Promise.resolve({id:'invalid'})})).status).toBe(403);expect(mocks.get).not.toHaveBeenCalled();});
 it('returns private no-store DTO and forwards exact numeric counters and abort signal',async()=>{const input=request(),response=await GET(input,context);expect(response.status).toBe(200);expect(await response.json()).toEqual({resolution:result});expect(mocks.get).toHaveBeenCalledWith('admin',id,{expectedJobRevision:2,expectedExtractionRevision:2,expectedReviewRevision:1},{signal:input.signal});expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');});
 it('rejects missing/duplicate/unknown/zero/negative/exponent/overflow counters and caller metadata',async()=>{
  for(const suffix of ['',query+'&sql=select',query+'&familyCode=PRIVATE',query+'&expectedReviewRevision=1',query.replace('Revision=1','Revision=0'),query.replace('Revision=1','Revision=-1'),query.replace('Revision=1','Revision=1e2'),query.replace('Revision=1','Revision=1000000000')])expect((await GET(request(suffix),context)).status).toBe(400);
  expect(mocks.get).not.toHaveBeenCalled();
 });
 it('returns invalid path404 and snapshot conflict409',async()=>{expect((await GET(request(),{params:Promise.resolve({id:'bad'})})).status).toBe(404);mocks.get.mockRejectedValue(new ImportStagingError('CONFLICT'));expect((await GET(request(),context)).status).toBe(409);});
 it('uses fixed sanitized failure without raw metadata/credential logging',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.get.mockRejectedValue(new Error('private credentials and document metadata'));const response=await GET(request(),context);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledExactlyOnceWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();});
});
