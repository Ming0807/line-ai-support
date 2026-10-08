import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),summary:vi.fn(),analytics:vi.fn(),usage:vi.fn(),departments:vi.fn(),settings:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/operations/metrics',()=>({readOperationsSummary:m.summary,readOperationsAnalytics:m.analytics,readOperationsUsage:m.usage,readOperationsDepartments:m.departments,readOperationsSettings:m.settings}));
import {metricsHandler} from '@/lib/operations/metrics-api';
import {OperationsError} from '@/lib/operations/contracts';
const kinds=['summary','analytics','usage','departments','settings'] as const;
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue('actor');for(const fn of [m.summary,m.analytics,m.usage,m.departments,m.settings])fn.mockResolvedValue({observed:true});});
it('all metrics authenticate before selector parsing and use private response headers',async()=>{
 m.staff.mockResolvedValue(null);
 for(const kind of kinds){
  const request=new Request('http://localhost');Object.defineProperty(request,'url',{get(){throw Error('private URL');}});
  const response=await metricsHandler(request,kind);expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'UNAUTHENTICATED'});
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(response.headers.get('vary')).toBe('Cookie');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 }
 expect(m.summary).not.toHaveBeenCalled();expect(m.usage).not.toHaveBeenCalled();
});
it('forwards only bounded validated metric selectors to the authenticated actor',async()=>{
 const response=await metricsHandler(new Request('http://localhost?from=2026-10-01&to=2026-10-08'),'summary');
 expect(response.status).toBe(200);expect(m.summary).toHaveBeenCalledWith('actor',expect.objectContaining({from:'2026-10-01',to:'2026-10-08'}));
 for(const kind of kinds){expect((await metricsHandler(new Request('http://localhost?secret=private'),kind)).status).toBe(400);}
 expect((await metricsHandler(new Request('http://localhost?departmentId=11111111-1111-4111-8111-111111111111'),'usage')).status).toBe(400);
});
it('redacts failures and distinguishes forbidden, missing and unavailable reads',async()=>{
 for(const [error,status,code] of [[new OperationsError('FORBIDDEN'),403,'FORBIDDEN'],[new OperationsError('NOT_FOUND'),404,'NOT_FOUND'],[Error('private credentials stack'),503,'UNAVAILABLE']] as const){
  m.settings.mockRejectedValue(error);const response=await metricsHandler(new Request('http://localhost'),'settings');expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
 }
});
