import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),catalog:vi.fn(),history:vi.fn(),detail:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/knowledge/catalog',()=>({listKnowledgeCatalog:mocks.catalog,getKnowledgeFamily:mocks.history,getKnowledgeDocument:mocks.detail}));
import {GET as catalog} from '@/app/api/knowledge/catalog/route';
import {GET as history} from '@/app/api/knowledge/families/[id]/route';
import {GET as detail} from '@/app/api/knowledge/documents/[id]/route';
import {ImportStagingError} from '@/lib/imports/import-staging';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',context={params:Promise.resolve({id})};
const request=(query='')=>new Request('http://localhost:3000/api/knowledge/catalog'+query);
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.catalog.mockResolvedValue({families:[]});mocks.history.mockResolvedValue({documents:[]});mocks.detail.mockResolvedValue({relationships:[]});});
it('authenticates and authorizes before URL/path/query access and private work',async()=>{
 const poisoned=request();Object.defineProperty(poisoned,'url',{get(){throw new Error('PRIVATE_URL_READ_BEFORE_AUTH');}});
 mocks.actor.mockResolvedValue(null);expect((await catalog(poisoned)).status).toBe(401);
 mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));
 expect((await catalog(poisoned)).status).toBe(403);expect((await history(poisoned,{params:Promise.resolve({id:'invalid'})})).status).toBe(403);expect((await detail(poisoned,context)).status).toBe(403);
 expect(mocks.catalog).not.toHaveBeenCalled();expect(mocks.history).not.toHaveBeenCalled();expect(mocks.detail).not.toHaveBeenCalled();
});
it('forwards only typed bounded catalog filters plus cancellation',async()=>{
 const read=request('?q=%20ปฏิทิน%20&departmentCode=REGISTRAR&status=SUPERSEDED&page=2&pageSize=7');
 const response=await catalog(read);expect(await response.json()).toEqual({catalog:{families:[]}});
 expect(mocks.catalog).toHaveBeenCalledWith('admin',{q:'ปฏิทิน',departmentCode:'REGISTRAR',status:'SUPERSEDED',page:2,pageSize:7},{signal:read.signal});
 for(const [key,value] of [['cache-control','private, no-store, max-age=0'],['vary','Cookie'],['x-content-type-options','nosniff']])expect(response.headers.get(key)).toBe(value);
});
it('rejects duplicate/unknown selectors and invalid bounded numbers without repository calls',async()=>{
 for(const query of ['?sql=select','?page=1&page=2','?page=0','?page=10001','?pageSize=51','?pageSize=2.2','?departmentCode=IT%3BDROP','?status=CURRENT','?q='+('x'.repeat(121))])expect((await catalog(request(query))).status).toBe(400);
 expect(mocks.catalog).not.toHaveBeenCalled();
});
it('uses explicit defaults rather than source-supplied mode or SQL for all three reads',async()=>{
 const read=request();await catalog(read);expect(mocks.catalog).toHaveBeenCalledWith('admin',{q:null,departmentCode:null,status:null,page:1,pageSize:10},{signal:read.signal});
 const page=request('?page=2&pageSize=5');expect(await (await history(page,context)).json()).toEqual({history:{documents:[]}});expect(mocks.history).toHaveBeenCalledWith('admin',id,{page:2,pageSize:5},{signal:page.signal});
 const relations=request('?relationsPage=2&relationsPageSize=3');expect(await (await detail(relations,context)).json()).toEqual({document:{relationships:[]}});expect(mocks.detail).toHaveBeenCalledWith('admin',id,{relationsPage:2,relationsPageSize:3},{signal:relations.signal});
});
it('rejects bad IDs and selectors without exposing existence to unauthorized callers',async()=>{
 expect((await history(request(),{params:Promise.resolve({id:'invalid'})})).status).toBe(404);
 expect((await detail(request('?page=1'),context)).status).toBe(400);
 expect((await history(request('?relationsPage=1'),context)).status).toBe(400);
 expect(mocks.history).not.toHaveBeenCalled();expect(mocks.detail).not.toHaveBeenCalled();
});
it('logs only fixed unavailable errors and preserves private headers on failures',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.catalog.mockRejectedValue(new Error('raw private credentials/source'));
 const response=await catalog(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'INTERNAL_ERROR'});expect(response.headers.get('cache-control')).toContain('no-store');expect(log).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});
 mocks.history.mockRejectedValue(new ImportStagingError('NOT_FOUND'));expect((await history(request(),context)).status).toBe(404);log.mockRestore();
});
