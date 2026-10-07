import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({staff:vi.fn(),activities:vi.fn(),logs:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:mocks.staff}));
vi.mock('@/lib/operations/reads',()=>({readActivities:mocks.activities,readLogs:mocks.logs}));
import {GET as activities} from '@/app/api/activities/route';
import {GET as logs} from '@/app/api/logs/route';
import {OperationsError} from '@/lib/operations/contracts';
beforeEach(()=>{vi.resetAllMocks();mocks.staff.mockResolvedValue('verified-staff');mocks.activities.mockResolvedValue({items:[]});mocks.logs.mockResolvedValue({items:[]});});
it('authenticates before accessing URL or selectors for both read routes',async()=>{
 mocks.staff.mockResolvedValue(null);
 for(const handler of [activities,logs]){
  const request=new Request('http://localhost/api/logs');Object.defineProperty(request,'url',{get(){throw Error('private');}});
  const response=await handler(request);expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'UNAUTHENTICATED'});
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(response.headers.get('vary')).toBe('Cookie');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 }
 expect(mocks.activities).not.toHaveBeenCalled();expect(mocks.logs).not.toHaveBeenCalled();
});
it('passes only accepted parsed query to the authenticated actor read',async()=>{
 const response=await activities(new Request('http://localhost/api/activities?action=REPLY&page=2&pageSize=7'));
 expect(response.status).toBe(200);expect(mocks.activities).toHaveBeenCalledWith('verified-staff',expect.objectContaining({action:'REPLY',page:2,pageSize:7}));
});
it('rejects unsupported selectors and returns fixed failures without private error echo',async()=>{
 expect((await logs(new Request('http://localhost/api/logs?token=secret'))).status).toBe(400);expect(mocks.logs).not.toHaveBeenCalled();
 for(const [error,status,code] of [[new OperationsError('FORBIDDEN'),403,'FORBIDDEN'],[new OperationsError('NOT_FOUND'),404,'NOT_FOUND'],[Error('private stack token'),503,'UNAVAILABLE']] as const){
  mocks.logs.mockRejectedValue(error);const response=await logs(new Request('http://localhost/api/logs'));expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
 }
});
