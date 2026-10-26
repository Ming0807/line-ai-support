import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),copilot:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/staff/staff-copilot',()=>({createStaffCopilotAssistance:m.copilot}));
import {staffCopilotHandler} from '@/lib/staff/staff-copilot-api';
import {POST} from '@/app/api/tickets/[id]/copilot/route';
import {AssistError} from '@/lib/staff/ai-assistance-contracts';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const result={ticketId:id,revision:4,status:'NO_USER_QUESTION',draftText:null,evidenceText:null,sources:[]};
const request=(body:BodyInit='{"revision":4}',type='application/json',query='')=>new Request('http://localhost:3000/api/tickets/'+id+'/copilot'+query,
 {method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':type},body});
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue(id);m.copilot.mockResolvedValue(result);});
it('uses same-origin authenticated server identity and promised route params, with private no-store output',async()=>{
 expect((await staffCopilotHandler(new Request('http://localhost',{method:'POST'}),id)).status).toBe(403);
 expect(m.staff).not.toHaveBeenCalled();m.staff.mockResolvedValueOnce(null);
 expect((await staffCopilotHandler(request(),id)).status).toBe(401);expect(m.copilot).not.toHaveBeenCalled();
 const response=await POST(request(),{params:Promise.resolve({id})});
 expect(response.status).toBe(200);expect(await response.json()).toEqual(result);
 expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(response.headers.get('vary')).toBe('Cookie');
 expect(m.copilot).toHaveBeenCalledWith(id,id,{revision:4},expect.objectContaining({signal:expect.any(AbortSignal)}));
});
it('rejects caller identity/question/tool/provider overrides, malformed bodies, queries and non-UUID cases',async()=>{
 for(const [r,status] of [
  [request('{'),400],[request('x'.repeat(1025)),413],[request(new Uint8Array([0xff])),400],
  [request('{}','text/plain'),400],[request('{"revision":4}','application/json','?staffId=other'),400],
  ...['staffId','question','tools','providerId','studentId'].map(key=>[request(JSON.stringify({revision:4,[key]:'override'})),400] as const),
 ] as const)expect((await staffCopilotHandler(r,id)).status).toBe(status);
 expect((await staffCopilotHandler(request(),'not-an-id')).status).toBe(404);expect(m.copilot).not.toHaveBeenCalled();
});
it('returns fixed safe errors without echoing model, child process or database details',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{
  for(const [error,status,code] of [[new AssistError('CONFLICT'),409,'CONFLICT'],[new AssistError('NOT_FOUND'),404,'NOT_FOUND'],
   [new Error('synthetic-private-prompt-token'),503,'UNAVAILABLE']] as const){
   m.copilot.mockRejectedValueOnce(error);const response=await staffCopilotHandler(request(),id);
   expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
  }
  expect(log).toHaveBeenCalledExactlyOnceWith('STAFF_COPILOT_FAILED',{code:'UNAVAILABLE'});
 }finally{log.mockRestore();}
});
