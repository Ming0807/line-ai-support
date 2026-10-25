import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),options:vi.fn(),preview:vi.fn(),confirm:vi.fn(),status:vi.fn(),retry:vi.fn(),draft:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/incidents/batch-preview',()=>({getIncidentReplyOptions:m.options,previewIncidentReply:m.preview}));
vi.mock('@/lib/incidents/batch-confirm',()=>({confirmIncidentReply:m.confirm}));
vi.mock('@/lib/incidents/batch-status',()=>({listIncidentReplyBatches:m.status,retryIncidentReplyBatch:m.retry,getIncidentReplyDraft:m.draft}));
import {incidentBatchLatestDraft,incidentBatchOptions,incidentBatchPreview,incidentBatchConfirm,incidentBatchStatus,incidentBatchRetry} from '@/lib/incidents/batch-api';
import {IncidentError} from '@/lib/incidents/contracts';
const id='10000000-0000-4000-8000-000000000001';
const input={requestId:id,ticketIds:[id],text:'กำลังตรวจสอบ',intervention:false};
const post=(body:BodyInit=JSON.stringify(input),type='application/json',origin='http://localhost:3000')=>new Request('http://localhost:3000/api/incidents/'+id+'/replies/preview',{
 method:'POST',headers:{origin,host:'localhost:3000','content-type':type},body});
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue(id);m.options.mockResolvedValue({items:[]});m.preview.mockResolvedValue({status:'REVIEW_ONLY'});m.confirm.mockResolvedValue({status:'ACCEPTED'});m.status.mockResolvedValue({batches:[]});m.retry.mockResolvedValue({status:'RETRY_ACCEPTED'});});
it('authenticates before parsing the option request and never caches private projections',async()=>{
 m.staff.mockResolvedValue(null);const req=new Request('http://localhost');Object.defineProperty(req,'url',{get(){throw Error('must authenticate first');}});
 const r=await incidentBatchOptions(req,id);expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(m.options).not.toHaveBeenCalled();
});
it('rejects unrecognized option queries and sends only authenticated actor/incident',async()=>{
 expect((await incidentBatchOptions(new Request('http://localhost/?actorId=other'),id)).status).toBe(400);
 expect((await incidentBatchOptions(new Request('http://localhost/'),id)).status).toBe(200);expect(m.options).toHaveBeenCalledExactlyOnceWith(id,id);
});
it('rejects foreign origin and absent auth before invoking preview',async()=>{
 expect((await incidentBatchPreview(post('{}','application/json','https://other.example'),id)).status).toBe(403);expect(m.staff).not.toHaveBeenCalled();
 m.staff.mockResolvedValue(null);expect((await incidentBatchPreview(post(),id)).status).toBe(401);expect(m.preview).not.toHaveBeenCalled();
});
it('bounds UTF-8/JSON/type and preserves only the strict normalized selection',async()=>{
 for(const [r,status] of [[post('{'),400],[post(new Uint8Array([255])),400],[post('x'.repeat(65537)),413],[post('{}','text/plain'),400],[post(JSON.stringify({...input,actorId:id})),400]] as const){
  expect((await incidentBatchPreview(r,id)).status).toBe(status);
 }
 expect(m.preview).not.toHaveBeenCalled();expect((await incidentBatchPreview(post(),id)).status).toBe(200);expect(m.preview).toHaveBeenCalledExactlyOnceWith(id,id,input);
});
it('returns fixed conflict/permission/unavailable errors without private source text',async()=>{
 for(const [error,status,code] of [[new IncidentError('CONFLICT'),409,'CONFLICT'],[new IncidentError('NOT_FOUND'),404,'NOT_FOUND'],[Error('private identity or key'),503,'UNAVAILABLE']] as const){
  m.preview.mockRejectedValue(error);const r=await incidentBatchPreview(post(),id);expect(r.status).toBe(status);expect(await r.json()).toEqual({error:code});
 }
});
it('authenticates scoped status reads and rejects additional selectors',async()=>{
 m.staff.mockResolvedValue(null);expect((await incidentBatchStatus(new Request('http://localhost/'),id)).status).toBe(401);expect(m.status).not.toHaveBeenCalled();
 m.staff.mockResolvedValue(id);expect((await incidentBatchStatus(new Request('http://localhost/?batch=all'),id)).status).toBe(400);
 const response=await incidentBatchStatus(new Request('http://localhost/'),id);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(m.status).toHaveBeenCalledExactlyOnceWith(id,id);
});
it('confirm accepts only the opaque receipt with enough bounded body space for the complete reviewed text',async()=>{
 for(const body of [{previewReceipt:'reviewed',text:'substitution'},{previewReceipt:''},{previewReceipt:'x'.repeat(200001)}])expect((await incidentBatchConfirm(post(JSON.stringify(body)),id)).status).toBe(400);
 const receipt='x'.repeat(100000);expect((await incidentBatchConfirm(post(JSON.stringify({previewReceipt:receipt})),id)).status).toBe(202);expect(m.confirm).toHaveBeenCalledExactlyOnceWith(id,id,{previewReceipt:receipt});
});
it('confirm and retry reject foreign origin, absent authentication, malformed requests and private failure details',async()=>{
 for(const method of [incidentBatchConfirm,(r:Request,i:string)=>incidentBatchRetry(r,i,id)]){
  expect((await method(post('{}','application/json','https://foreign.example'),id)).status).toBe(403);
  m.staff.mockResolvedValue(null);expect((await method(post('{}'),id)).status).toBe(401);m.staff.mockResolvedValue(id);
  expect((await method(post('{'),id)).status).toBe(400);expect((await method(post(new Uint8Array([255])),id)).status).toBe(400);
 }
 m.confirm.mockRejectedValue(Error('secret raw provider response'));const response=await incidentBatchConfirm(post(JSON.stringify({previewReceipt:'reviewed'})),id);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'UNAVAILABLE'});
});
it('explicit retry accepts only unique selected recipient codes and authenticated route identities',async()=>{
 const body={requestId:id,recipientCodes:['R2']};
 expect((await incidentBatchRetry(post(JSON.stringify({...body,outboxId:id})),id,id)).status).toBe(400);
 expect((await incidentBatchRetry(post(JSON.stringify({...body,recipientCodes:['R2','R2']})),id,id)).status).toBe(400);expect(m.retry).not.toHaveBeenCalled();
 expect((await incidentBatchRetry(post(JSON.stringify(body)),id,id)).status).toBe(202);expect(m.retry).toHaveBeenCalledExactlyOnceWith(id,id,id,body);
});

it('latest draft authenticates before URL parsing, rejects selectors and returns only the private scoped projection',async()=>{
 m.staff.mockResolvedValue(null);const request=new Request('http://localhost/');Object.defineProperty(request,'url',{get(){throw Error('AUTH_FIRST_REQUIRED');}});
 expect((await incidentBatchLatestDraft(request,id)).status).toBe(401);expect(m.draft).not.toHaveBeenCalled();
 m.staff.mockResolvedValue(id);expect((await incidentBatchLatestDraft(new Request('http://localhost/?ticketIds=all'),id)).status).toBe(400);expect(m.draft).not.toHaveBeenCalled();
 m.draft.mockResolvedValue({status:'EMPTY'});const response=await incidentBatchLatestDraft(new Request('http://localhost/'),id);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(await response.json()).toEqual({status:'EMPTY'});expect(m.draft).toHaveBeenCalledExactlyOnceWith(id,id);
});

it('latest draft never leaks private decode or scope errors',async()=>{
 m.draft.mockRejectedValue(Error('private encrypted provenance and credentials'));const response=await incidentBatchLatestDraft(new Request('http://localhost/'),id);
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'UNAVAILABLE'});
 m.draft.mockRejectedValue(new IncidentError('NOT_FOUND'));expect((await incidentBatchLatestDraft(new Request('http://localhost/'),id)).status).toBe(404);
});
