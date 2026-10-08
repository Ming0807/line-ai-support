import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),assist:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/staff/ai-assistance',()=>({createStaffAssistance:m.assist}));
import {staffAssistHandler} from '@/lib/staff/ai-assistance-api';
import {AssistError} from '@/lib/staff/ai-assistance-contracts';
const id='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue('actor');m.assist.mockResolvedValue({revision:0});});
const request=(body:BodyInit='{"revision":0}',type='application/json')=>new Request('http://localhost:3000/api/tickets/'+id+'/assist',{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':type},body});
it('rejects cross-origin and unauthenticated callers before private service execution',async()=>{
 expect((await staffAssistHandler(new Request('http://localhost',{method:'POST'}),id)).status).toBe(403);expect(m.staff).not.toHaveBeenCalled();m.staff.mockResolvedValue(null);expect((await staffAssistHandler(request(),id)).status).toBe(401);expect(m.assist).not.toHaveBeenCalled();
});
it('accepts bounded strict revision only, and never caller-selected role/context or SQL',async()=>{
 for(const [r,status] of [[request('{'),400],[request('x'.repeat(1025)),413],[request(new Uint8Array([0xff])),400],[request('{}','text/plain'),400],[request('{"revision":0,"sql":"select 1"}'),400]] as const)expect((await staffAssistHandler(r,id)).status).toBe(status);
 expect(m.assist).not.toHaveBeenCalled();const response=await staffAssistHandler(request(),id);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(m.assist).toHaveBeenCalledWith('actor',id,{revision:0},expect.objectContaining({signal:expect.any(AbortSignal)}));
});
it('uses fixed conflict/unavailable errors without model or private database diagnostics',async()=>{
 for(const [error,status,code] of [[new AssistError('CONFLICT'),409,'CONFLICT'],[new AssistError('NOT_FOUND'),404,'NOT_FOUND'],[Error('private credentials'),503,'UNAVAILABLE']] as const){m.assist.mockRejectedValue(error);const r=await staffAssistHandler(request(),id);expect(r.status).toBe(status);expect(await r.json()).toEqual({error:code});}
});
