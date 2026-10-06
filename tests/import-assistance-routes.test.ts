import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),assistance:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/assistance',()=>({getImportAssistance:mocks.assistance}));
import {GET} from '@/app/api/knowledge/imports/[id]/assistance/route';
import {ImportStagingError} from '@/lib/imports/import-staging';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request=()=>new Request('http://localhost:3000/api/knowledge/imports/'+id+'/assistance');
const context={params:Promise.resolve({id})};
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.assistance.mockResolvedValue({jobId:id});});
it('denies before touching private path or selectors',async()=>{
 const read=request();Object.defineProperty(read,'url',{get(){throw new Error('URL_BEFORE_AUTH');}});
 mocks.actor.mockResolvedValue(null);expect((await GET(read,context)).status).toBe(401);
 mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));expect((await GET(read,context)).status).toBe(403);expect(mocks.assistance).not.toHaveBeenCalled();
});
it('returns a private exact envelope and passes cancellation',async()=>{
 const read=request(),result=await GET(read,context);expect(result.status).toBe(200);expect(await result.json()).toEqual({assistance:{jobId:id}});expect(mocks.assistance).toHaveBeenCalledWith('admin',id,{signal:read.signal});expect(result.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(result.headers.get('vary')).toBe('Cookie');expect(result.headers.get('x-content-type-options')).toBe('nosniff');
});
it('rejects unknown selectors and invalid IDs without reading the original',async()=>{
 expect((await GET(new Request(request().url+'?approved=true'),context)).status).toBe(400);expect((await GET(request(),{params:Promise.resolve({id:'bad'})})).status).toBe(404);expect(mocks.assistance).not.toHaveBeenCalled();
});
it('returns fixed conflict and unavailable errors without leaking source details',async()=>{
 mocks.assistance.mockRejectedValue(new ImportStagingError('CONFLICT'));expect((await GET(request(),context)).status).toBe(409);
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.assistance.mockRejectedValue(new Error('private original credentials'));const r=await GET(request(),context);expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();
});
