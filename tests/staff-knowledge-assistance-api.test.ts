import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),assist:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/staff/knowledge-assistance',()=>({createStaffKnowledgeAssistance:m.assist}));
import {staffKnowledgeHandler} from '@/lib/staff/knowledge-assistance-api';
import {AssistError} from '@/lib/staff/ai-assistance-contracts';
const id='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue('actor');m.assist.mockResolvedValue({revision:0,status:'NO_USER_QUESTION',answer:null,draftText:null,sources:[]});});
const request=(body:BodyInit='{"revision":0}',type='application/json',query='')=>new Request('http://localhost:3000/api/tickets/'+id+'/knowledge-assistance'+query,{method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':type},body});
it('requires same-origin authenticated staff before private knowledge service',async()=>{
 expect((await staffKnowledgeHandler(new Request('http://localhost',{method:'POST'}),id)).status).toBe(403);expect(m.staff).not.toHaveBeenCalled();
 m.staff.mockResolvedValue(null);expect((await staffKnowledgeHandler(request(),id)).status).toBe(401);expect(m.assist).not.toHaveBeenCalled();
});
it('accepts only a bounded revision, not caller evidence/identity/question/tools',async()=>{
 for(const [r,status] of [[request('{'),400],[request('x'.repeat(1025)),413],[request(new Uint8Array([0xff])),400],[request('{}','text/plain'),400],[request('','application/json','?scope=other'),400],[request('{"revision":0,"question":"override"}'),400],[request('{"revision":0,"evidence":[]}'),400]] as const)expect((await staffKnowledgeHandler(r,id)).status).toBe(status);
 expect(m.assist).not.toHaveBeenCalled();const response=await staffKnowledgeHandler(request(),id);expect(response.status).toBe(200);
 expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
 expect(m.assist).toHaveBeenCalledWith('actor',id,{revision:0},expect.objectContaining({signal:expect.any(AbortSignal)}));
});
it('returns fixed source/context/unavailable errors without leaking SQL/model diagnostics',async()=>{
 for(const [error,status,code] of [[new AssistError('CONFLICT'),409,'CONFLICT'],[new AssistError('NOT_FOUND'),404,'NOT_FOUND'],[Error('private credentials'),503,'UNAVAILABLE']] as const){m.assist.mockRejectedValue(error);const response=await staffKnowledgeHandler(request(),id);expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});}
});
