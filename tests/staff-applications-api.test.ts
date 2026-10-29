import {beforeEach,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  auth:vi.fn(),config:vi.fn(),context:vi.fn(),submit:vi.fn(),list:vi.fn(),decide:vi.fn(),suspend:vi.fn(),
}));

vi.mock('@/lib/auth/line-staff-server',()=>({getVerifiedStaffAuth:mocks.auth}));
vi.mock('@/lib/auth/line-staff-config',()=>({readStaffLineConfig:mocks.config}));
vi.mock('@/lib/staff/applications',()=>({
  getStaffApplicationContext:mocks.context,
  submitStaffApplication:mocks.submit,
  listStaffApplications:mocks.list,
  decideStaffApplication:mocks.decide,
  suspendStaffApplication:mocks.suspend,
}));

import {
  getOnboarding,
  getApplications,
  postApplication,
  decideApplication,
  suspendApplication,
} from '@/lib/staff/applications-api';
import {StaffApplicationError} from '@/lib/staff/applications-contracts';

const userId='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const applicationId='e3490a61-8d27-4b60-b7d6-80bd75854138';
const departmentId='91e74be8-857d-4e89-9915-05ce51daf8fc';
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const subject='U'+'a'.repeat(32);
const auth={userId,lineIdentity:{identityId:'32bc51bc-3757-4a39-8b4b-ae2f316017f1',subject}};
const context={authenticated:true,lineLinked:true,staffActive:false,loginAvailable:true,canReview:false,application:null,departments:[{id:departmentId,name:'ฝ่ายตัวอย่าง'}]};
const item={
  id:applicationId,applicantName:'ผู้สมัคร ตัวอย่าง',staffCode:'YRU-123',requestedDepartmentId:departmentId,
  requestedDepartmentName:'ฝ่ายตัวอย่าง',approvedDepartmentId:null,approvedDepartmentName:null,status:'PENDING',revision:0,
  submittedAt:'2026-10-29T03:00:00.000Z',reviewedAt:null,reviewerName:null,decisionReason:null,
};
const list={items:[item],departments:[{id:departmentId,name:'ฝ่ายตัวอย่าง'}],pagination:{page:1,pageSize:20,total:1,totalPages:1,hasNext:false,hasPrevious:false}};

beforeEach(()=>{
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(auth);
  mocks.config.mockReturnValue({loginAvailable:true,sameProviderConfirmed:true});
  mocks.context.mockResolvedValue(context);
  mocks.submit.mockResolvedValue(item);
  mocks.list.mockResolvedValue(list);
  mocks.decide.mockResolvedValue({...item,status:'APPROVED',approvedDepartmentId:departmentId});
  mocks.suspend.mockResolvedValue({...item,status:'SUSPENDED'});
});

function request(path:string,options:{method?:string;body?:BodyInit|null;origin?:string|null;contentType?:string|null}={}) {
  const method=options.method??'GET';
  const headers=new Headers({host:'localhost:3000'});
  if(options.origin!==null)headers.set('origin',options.origin??'http://localhost:3000');
  if(options.contentType!==null)headers.set('content-type',options.contentType??'application/json');
  return new Request(`http://localhost:3000${path}`,{method,headers,...(options.body===undefined?{}:{body:options.body})});
}

async function responseJson(response:Response) {return await response.json() as unknown;}

it('returns the anonymous onboarding context honestly without calling protected application service',async()=>{
  mocks.auth.mockResolvedValue(null);
  const response=await getOnboarding(request('/api/staff/onboarding'));
  expect(response.status).toBe(200);
  expect(await responseJson(response)).toEqual({authenticated:false,lineLinked:false,staffActive:false,loginAvailable:true,canReview:false,application:null,departments:[]});
  expect(mocks.context).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
});

it('returns a pending linked applicant DTO without exposing the verified LINE subject or auth details',async()=>{
  mocks.context.mockResolvedValue({...context,application:item});
  const response=await getOnboarding(request('/api/staff/onboarding'));
  expect(response.status).toBe(200);
  const body=await responseJson(response);
  expect(body).toEqual({...context,application:item});
  expect(JSON.stringify(body)).not.toContain(subject);
  expect(JSON.stringify(body)).not.toContain('access_token');
  expect(mocks.context).toHaveBeenCalledWith(auth,expect.objectContaining({loginAvailable:true,sameProviderConfirmed:true}));
  expect(response.headers.get('cache-control')).toContain('private, no-store');
});

it('rejects onboarding query parameters and application listing for unauthenticated callers',async()=>{
  mocks.auth.mockResolvedValue(null);
  const onboarding=await getOnboarding(request('/api/staff/onboarding?userId=other'));
  expect(onboarding.status).toBe(400);
  const listing=await getApplications(request('/api/staff/applications'));
  expect(listing.status).toBe(401);
  expect(await responseJson(listing)).toEqual({error:'UNAUTHENTICATED'});
  expect(mocks.list).not.toHaveBeenCalled();
});

it('accepts only the status/page/pageSize list query and rejects duplicates or extra query fields',async()=>{
  const response=await getApplications(request('/api/staff/applications?status=PENDING&page=2&pageSize=10'));
  expect(response.status).toBe(200);
  expect(await responseJson(response)).toEqual(list);
  expect(mocks.list).toHaveBeenCalledWith(userId,{status:'PENDING',page:2,pageSize:10},expect.anything());
  for(const path of [
    '/api/staff/applications?other=x',
    '/api/staff/applications?status=PENDING&status=APPROVED',
    '/api/staff/applications?page=1&page=2',
    '/api/staff/applications?pageSize=20&pageSize=25',
  ]) expect((await getApplications(request(path))).status).toBe(400);
});

it('requires same-origin JSON writes and rejects cross-origin before authentication or service calls',async()=>{
  const crossOrigin=request('/api/staff/applications',{method:'POST',origin:'https://evil.example',body:'{}'});
  const response=await postApplication(crossOrigin);
  expect(response.status).toBe(403);
  expect(await responseJson(response)).toEqual({error:'INVALID_ORIGIN'});
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('rejects write query strings, wrong content types and malformed or oversized JSON before services',async()=>{
  const cases=[
    request('/api/staff/applications?mode=submit',{method:'POST',body:'{}'}),
    request('/api/staff/applications',{method:'POST',contentType:'text/plain',body:'{}'}),
    request('/api/staff/applications',{method:'POST',body:'{' }),
    request('/api/staff/applications',{method:'POST',body:'x'.repeat(16_385)}),
  ];
  for(const input of cases) expect((await postApplication(input)).status).toBeGreaterThanOrEqual(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('validates applicant DTOs before mutation and returns a successful item directly, not an envelope',async()=>{
  const invalid={applicantName:'Applicant',staffCode:'YRU-123',departmentId:'bad',requestId};
  expect((await postApplication(request('/api/staff/applications',{method:'POST',body:JSON.stringify(invalid)}))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
  const body={applicantName:'  Applicant Name ',staffCode:' YRU-123 ',departmentId,requestId};
  const response=await postApplication(request('/api/staff/applications',{method:'POST',body:JSON.stringify(body)}));
  expect(response.status).toBe(200);
  expect(await responseJson(response)).toEqual(item);
  expect(mocks.submit).toHaveBeenCalledWith(auth,body,expect.anything());
  expect(response.headers.get('cache-control')).toContain('private, no-store');
});

it('routes reviewer decisions and suspensions through authenticated subject-bound services',async()=>{
  const decision={decision:'APPROVE',departmentId,revision:0,requestId};
  const approved=await decideApplication(request(`/api/staff/applications/${applicationId}/decision`,{method:'POST',body:JSON.stringify(decision)}),applicationId);
  expect(approved.status).toBe(200);
  expect(await responseJson(approved)).toEqual({...item,status:'APPROVED',approvedDepartmentId:departmentId});
  expect(mocks.decide).toHaveBeenCalledWith(userId,applicationId,decision,expect.anything());
  const suspension={reason:'Policy review',revision:1,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
  const suspended=await suspendApplication(request(`/api/staff/applications/${applicationId}/suspend`,{method:'POST',body:JSON.stringify(suspension)}),applicationId);
  expect(suspended.status).toBe(200);
  expect(await responseJson(suspended)).toEqual({...item,status:'SUSPENDED'});
  expect(mocks.suspend).toHaveBeenCalledWith(userId,applicationId,suspension,expect.anything());
});

it('rejects invalid application ids and mutation payloads before invoking reviewer services',async()=>{
  const invalidId='not-a-uuid';
  expect((await decideApplication(request(`/api/staff/applications/${invalidId}/decision`,{method:'POST',body:'{}'}),invalidId)).status).toBe(400);
  expect((await suspendApplication(request(`/api/staff/applications/${applicationId}/suspend`,{method:'POST',body:'{"reason":"x","revision":0,"requestId":"bad"}'}),applicationId)).status).toBe(400);
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(mocks.suspend).not.toHaveBeenCalled();
});

it('maps pending-user reviewer denial and server failures to fixed private errors',async()=>{
  mocks.list.mockRejectedValueOnce(new StaffApplicationError('FORBIDDEN'));
  const denied=await getApplications(request('/api/staff/applications'));
  expect(denied.status).toBe(403);
  expect(await responseJson(denied)).toEqual({error:'FORBIDDEN'});
  const logger=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.context.mockRejectedValueOnce(new Error('private database credential text'));
  const unavailable=await getOnboarding(request('/api/staff/onboarding'));
  expect(unavailable.status).toBe(503);
  expect(await responseJson(unavailable)).toEqual({error:'UNAVAILABLE'});
  expect(JSON.stringify(logger.mock.calls)).not.toContain('private database credential text');
  expect(unavailable.headers.get('cache-control')).toContain('private, no-store');
  logger.mockRestore();
});
