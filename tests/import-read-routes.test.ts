import {beforeEach,expect,it,vi} from 'vitest';
import {GET as list} from '../app/api/knowledge/imports/route';
import {GET as detail} from '../app/api/knowledge/imports/[id]/route';
import {GET as original} from '../app/api/knowledge/imports/[id]/original/route';
import {ImportStagingError,type ImportJobView} from '../lib/imports/import-staging';
const mocks=vi.hoisted(()=>({staff:vi.fn(),list:vi.fn(),detail:vi.fn(),original:vi.fn()}));
vi.mock('../lib/tickets/api',()=>({apiStaffId:mocks.staff}));
vi.mock('../lib/imports/import-staging',async original=>{
 const actual=await original<typeof import('../lib/imports/import-staging')>();
 return {...actual,listImportJobs:mocks.list,getImportJob:mocks.detail,readImportOriginal:mocks.original};
});
const actor='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const job:ImportJobView={id,status:'READY',revision:0,filename:"คู่มือ'ฉบับ(1).html",format:'HTML',mimeType:'text/html',sourceUrl:'https://yru.ac.th/guide',
 acquiredFrom:'UPLOAD',fetchedAt:null,acquisition:null,byteLength:12,createdAt:'2026-10-05T00:00:00.000Z',errorCode:null};
const context={params:Promise.resolve({id})},request=new Request(`http://localhost:3000/api/knowledge/imports/${id}`);
beforeEach(()=>{vi.clearAllMocks();mocks.staff.mockResolvedValue(actor);mocks.list.mockResolvedValue([job]);mocks.detail.mockResolvedValue(job);mocks.original.mockResolvedValue({job,bytes:Buffer.from('<p>fixture</p>')});});
it('requires authentication before every private import read',async()=>{
 mocks.staff.mockResolvedValue(null);
 for(const response of [await list(),await detail(request,context),await original(request,context)]){expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'UNAUTHENTICATED'});}
 expect(mocks.list).not.toHaveBeenCalled();expect(mocks.detail).not.toHaveBeenCalled();expect(mocks.original).not.toHaveBeenCalled();
});
it('uses the verified actor and awaited route parameters with private no-store metadata',async()=>{
 const response=await detail(request,context);expect(response.status).toBe(200);expect(await response.json()).toEqual({job});
 expect(mocks.detail).toHaveBeenCalledWith(actor,id);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toContain('Cookie');
 const listed=await list();expect(await listed.json()).toEqual({jobs:[job]});expect(mocks.list).toHaveBeenCalledWith(actor);
});
it('serves original bytes as a private attachment without rendering active source content',async()=>{
 const response=await original(request,context);expect(response.status).toBe(200);expect(await response.text()).toBe('<p>fixture</p>');expect(mocks.original).toHaveBeenCalledWith(actor,id);
 expect(response.headers.get('content-type')).toBe('application/octet-stream');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 expect(response.headers.get('content-security-policy')).toContain('sandbox');expect(response.headers.get('cache-control')).toContain('no-store');
 const disposition=response.headers.get('content-disposition')!;expect(disposition).toMatch(/^attachment; filename\*=UTF-8''/);expect(disposition).toContain('%27');expect(disposition).toContain('%28');expect(disposition).not.toContain('คู่มือ');
});
it.each([['FORBIDDEN',403],['NOT_FOUND',404],['CONFLICT',409],['INVALID_REQUEST',400],['INTERNAL_ERROR',503]] as const)('maps %s safely for private metadata and original reads',async(code,status)=>{
 const logged=vi.spyOn(console,'error').mockImplementation(()=>undefined);
 try{mocks.detail.mockRejectedValue(new ImportStagingError(code));mocks.original.mockRejectedValue(new ImportStagingError(code));
  for(const response of [await detail(request,context),await original(request,context)]){expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});expect(response.headers.get('cache-control')).toContain('no-store');}
 }finally{logged.mockRestore();}
});
it('does not expose unknown upstream errors or credentials in responses or logs',async()=>{
 const logged=vi.spyOn(console,'error').mockImplementation(()=>undefined),canary='PRIVATE_KEY_AND_ORIGINAL_FIXTURE';
 try{mocks.list.mockRejectedValue(new Error(canary));const response=await list();expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'INTERNAL_ERROR'});
  expect(logged).toHaveBeenCalledWith('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});expect(JSON.stringify(logged.mock.calls)).not.toContain(canary);
 }finally{logged.mockRestore();}
});
