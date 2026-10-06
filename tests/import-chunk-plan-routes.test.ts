import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),get:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/import-chunk-plan',()=>({getImportChunkPlan:mocks.get}));
import {GET} from '@/app/api/knowledge/imports/[id]/chunks/route';
import {ImportStagingError} from '@/lib/imports/import-staging';
const id='fcff13a7-f7ba-4bfd-aed7-aac9270925c1';
const query='expectedJobRevision=2&expectedExtractionRevision=2&expectedReviewRevision=1';
const request=(suffix=query)=>new Request(`http://localhost:3000/api/knowledge/imports/${id}/chunks?${suffix}`);
const context={params:Promise.resolve({id})};
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.get.mockResolvedValue({jobId:id,jobRevision:2,extractionRevision:2,reviewRevision:1,plan:{digest:'a'.repeat(64)}});});
it('denies anonymous and wrong roles before parsing private chunk query or preparing',async()=>{
 mocks.actor.mockResolvedValue(null);expect((await GET(request(),context)).status).toBe(401);expect(mocks.get).not.toHaveBeenCalled();
 mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));expect((await GET(request('sql=select'),{params:Promise.resolve({id:'bad'})})).status).toBe(403);expect(mocks.get).not.toHaveBeenCalled();
});
it('returns a private exact-snapshot DTO and passes cancellation without caller extraction/model data',async()=>{
 const input=request(),response=await GET(input,context);expect(response.status).toBe(200);expect(await response.json()).toEqual({snapshot:await mocks.get.mock.results[0].value});
 expect(mocks.get).toHaveBeenCalledWith('admin',id,{expectedJobRevision:2,expectedExtractionRevision:2,expectedReviewRevision:1},{signal:input.signal});expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
});
it('rejects missing/duplicate/unknown/noncanonical counters and invalid job paths',async()=>{
 for(const suffix of ['',query+'&model=x',query+'&expectedJobRevision=2',query.replace('Revision=1','Revision=0'),query.replace('Revision=1','Revision=1e2'),query.replace('Revision=1','Revision=01')])expect((await GET(request(suffix),context)).status).toBe(400);
 expect((await GET(request(),{params:Promise.resolve({id:'bad'})})).status).toBe(404);expect(mocks.get).not.toHaveBeenCalled();
});
it('returns conflict and fixed failures without logging private text or upstream errors',async()=>{
 mocks.get.mockRejectedValue(new ImportStagingError('CONFLICT'));expect((await GET(request(),context)).status).toBe(409);
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.get.mockRejectedValue(new Error('private text token password'));const response=await GET(request(),context);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();
});
