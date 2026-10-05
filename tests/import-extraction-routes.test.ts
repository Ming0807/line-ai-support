import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),analyze:vi.fn(),preview:vi.fn(),edit:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async importOriginal=>({...await importOriginal<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/import-extraction',()=>({analyzeImportJob:mocks.analyze,getImportPreview:mocks.preview,editImportExtraction:mocks.edit}));
import {ImportStagingError} from '@/lib/imports/import-staging';
import {POST} from '@/app/api/knowledge/analyze/route';
import {GET} from '@/app/api/knowledge/imports/[id]/preview/route';
import {PATCH} from '@/app/api/knowledge/imports/[id]/edit/route';
const id='fd5f470c-7193-4e43-931d-081ea3fb186a';
const request=(body:unknown,path='/api/knowledge/analyze')=>new Request('http://localhost:3000'+path,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
const context={params:Promise.resolve({id})};
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.analyze.mockResolvedValue({job:{id,revision:1}});mocks.preview.mockResolvedValue({job:{id,revision:1}});mocks.edit.mockResolvedValue({job:{id,revision:2}});});
describe('private extraction/preview/edit HTTP boundaries',()=>{
 it('requires same-origin before auth and authenticated admin before body read',async()=>{
  const foreign=new Request('http://localhost:3000/api/knowledge/analyze',{method:'POST',headers:{origin:'https://foreign.test','content-type':'application/json'},body:'{}'});
  expect((await POST(foreign)).status).toBe(403);expect(mocks.actor).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue(null);expect((await POST(request({id,revision:0}))).status).toBe(401);expect(mocks.analyze).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));
  const input=request({id,revision:0});const read=vi.spyOn(input.body!,'getReader');expect((await POST(input)).status).toBe(403);expect(read).not.toHaveBeenCalled();
 });
 it('analyzes a strict revision-bound request with caller signal and private headers',async()=>{
  const input=request({id,revision:0}),response=await POST(input);
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
  expect(mocks.analyze).toHaveBeenCalledWith('admin',id,0,{signal:input.signal});expect(await response.json()).toEqual({preview:{job:{id,revision:1}}});
 });
 it('rejects media type, malformed JSON, unknown fields, invalid ID/revision and declared byte overflow',async()=>{
  for(const body of [{id,revision:-1},{id:'bad',revision:0},{id,revision:0,publish:true}])expect((await POST(request(body))).status).toBe(400);
  expect((await POST(new Request('http://localhost:3000/api/knowledge/analyze',{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':'application/json'},body:'{'}))).status).toBe(400);
  const wrong=request({id,revision:0});wrong.headers.set('content-type','text/plain');expect((await POST(wrong)).status).toBe(400);
  const large=request({id,revision:0});large.headers.set('content-length','8193');expect((await POST(large)).status).toBe(413);expect(mocks.analyze).not.toHaveBeenCalled();
 });
 it('returns stale and controlled failure codes without leaked upstream detail',async()=>{
  mocks.analyze.mockRejectedValue(new ImportStagingError('CONFLICT'));expect((await POST(request({id,revision:0}))).status).toBe(409);
  const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.analyze.mockRejectedValue(new Error('private token and original contents'));
  const failed=await POST(request({id,revision:0}));expect(failed.status).toBe(503);expect(await failed.json()).toEqual({error:'INTERNAL_ERROR'});expect(log).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});log.mockRestore();
 });
 it('preview is authenticated, private and active role checked by backend',async()=>{
  mocks.actor.mockResolvedValue(null);expect((await GET(request({}),context)).status).toBe(401);expect(mocks.preview).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue('admin');const response=await GET(request({}),context);expect(response.status).toBe(200);expect(mocks.preview).toHaveBeenCalledWith('admin',id);expect(response.headers.get('cache-control')).toContain('no-store');
  mocks.preview.mockRejectedValue(new ImportStagingError('FORBIDDEN'));expect((await GET(request({}),context)).status).toBe(403);
 });
 it('edit accepts only revision plus text edit, rejects extra approval state and passes abort signal',async()=>{
  const input=request({revision:1,edit:{reason:'แก้ข้อความ',pages:[{index:0,text:'แก้ไข'}]}});const response=await PATCH(input,context);expect(response.status).toBe(200);
  expect(mocks.edit).toHaveBeenCalledWith('admin',id,1,{reason:'แก้ข้อความ',pages:[{index:0,text:'แก้ไข'}]},{signal:input.signal});
  expect((await PATCH(request({revision:1,edit:{},approved:true}),context)).status).toBe(400);
  mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));const forbidden=request({revision:1,edit:{}});const read=vi.spyOn(forbidden.body!,'getReader');expect((await PATCH(forbidden,context)).status).toBe(403);expect(read).not.toHaveBeenCalled();
 });
});
