import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),model:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.actor}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/model-assistance',async original=>({...await original<typeof import('@/lib/imports/model-assistance')>(),getImportModelAssistance:mocks.model}));
import {POST} from '@/app/api/knowledge/imports/[id]/assistance/route';
import {ImportModelAssistanceError} from '@/lib/imports/model-assistance';
import {ImportStagingError} from '@/lib/imports/import-staging';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',url=`http://localhost:3000/api/knowledge/imports/${id}/assistance`,context={params:Promise.resolve({id})};
const input={expectedJobRevision:1,expectedExtractionRevision:1,externalProcessingConfirmed:true};
const request=(origin='http://localhost:3000',body=JSON.stringify(input))=>new Request(url,{method:'POST',headers:{origin,host:'localhost:3000','content-type':'application/json'},body});
beforeEach(()=>{vi.resetAllMocks();mocks.actor.mockResolvedValue('admin');mocks.authorize.mockResolvedValue(undefined);mocks.model.mockResolvedValue({jobId:id});});
it('rejects cross-origin, anonymous and forbidden before provider work',async()=>{
 expect((await POST(request('https://elsewhere.example'),context)).status).toBe(403);
 mocks.actor.mockResolvedValue(null);expect((await POST(request(),context)).status).toBe(401);
 mocks.actor.mockResolvedValue('staff');mocks.authorize.mockRejectedValue(new ImportStagingError('FORBIDDEN'));
 expect((await POST(request(),context)).status).toBe(403);expect(mocks.model).not.toHaveBeenCalled();
});
it('passes only server actor, exact input and cancellation and returns private data',async()=>{
 const req=request(),response=await POST(req,context);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(mocks.model).toHaveBeenCalledWith('admin',id,input,{signal:req.signal});
});
it('bounds body and does not expose arbitrary error text',async()=>{
 expect((await POST(request(undefined,'x'.repeat(2049)),context)).status).toBe(413);
 expect((await POST(request(undefined,'{bad'),context)).status).toBe(400);
 expect(mocks.model).not.toHaveBeenCalled();
 mocks.model.mockRejectedValue(new ImportModelAssistanceError('IMPORT_AI_SOURCE_REVIEW_REQUIRED'));expect((await POST(request(),context)).status).toBe(422);
 mocks.model.mockRejectedValue(new ImportModelAssistanceError('AI_UNAVAILABLE'));const response=await POST(request(),context);
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'AI_UNAVAILABLE'});
});
