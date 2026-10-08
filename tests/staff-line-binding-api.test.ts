import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),status:vi.fn(),create:vi.fn(),unlink:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/staff/line-binding',()=>({getBindingStatus:m.status,createBindingChallenge:m.create,unlinkStaffLine:m.unlink}));
import {bindingRead,bindingMutation} from '@/lib/staff/line-binding-api';
import {BindingError} from '@/lib/staff/line-binding-contracts';
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue('actor');m.status.mockResolvedValue({bound:false,pending:false,expiresAt:null});m.create.mockResolvedValue({});m.unlink.mockResolvedValue({bound:false,pending:false,expiresAt:null});});
const id='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const request=(body:BodyInit='{}',method='POST',type='application/json')=>new Request('http://localhost:3000/api/staff/line-binding',{method,headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':type},body});
it('authenticates reads and returns only private uncached observations',async()=>{
 m.staff.mockResolvedValue(null);expect((await bindingRead(new Request('http://localhost'))).status).toBe(401);expect(m.status).not.toHaveBeenCalled();
 m.staff.mockResolvedValue('actor');const response=await bindingRead(new Request('http://localhost'));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
 expect((await bindingRead(new Request('http://localhost?staffId=other'))).status).toBe(400);
});
it('requires same origin before auth or any binding mutation',async()=>{
 expect((await bindingMutation(new Request('http://localhost',{method:'POST'}),'challenge')).status).toBe(403);expect(m.staff).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
});
it('rejects malformed, oversized, invalid UTF-8, unknown and caller-selected fields',async()=>{
 for(const [r,status] of [[request('{'),400],[request('x'.repeat(1025)),413],[request(new Uint8Array([0xff])),400],[request('{}','POST','text/plain'),400],[request(JSON.stringify({requestId:id,staffId:id})),400]] as const)expect((await bindingMutation(r,'challenge')).status).toBe(status);
 expect(m.create).not.toHaveBeenCalled();
 expect((await bindingMutation(request(JSON.stringify({requestId:id})),'challenge')).status).toBe(200);expect(m.create).toHaveBeenCalledWith('actor',{requestId:id});
});
it('unlink uses the authenticated self only and accepts only empty strict JSON',async()=>{
 expect((await bindingMutation(request('{}','DELETE'),'unlink')).status).toBe(200);expect(m.unlink).toHaveBeenCalledWith('actor');
 expect((await bindingMutation(request('{"staffId":"other"}','DELETE'),'unlink')).status).toBe(400);
});
it('uses fixed failure codes without private database errors',async()=>{
 for(const [error,status,code] of [[new BindingError('ALREADY_BOUND'),409,'ALREADY_BOUND'],[new BindingError('CHALLENGE_EXPIRED'),409,'CHALLENGE_EXPIRED'],[Error('private credentials'),503,'UNAVAILABLE']] as const){m.status.mockRejectedValue(error);const response=await bindingRead(new Request('http://localhost'));expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});}
});
