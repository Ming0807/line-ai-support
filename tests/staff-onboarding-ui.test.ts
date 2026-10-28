import {describe,expect,it,vi} from 'vitest';
import {
  initialOnboardingState,reduceOnboarding,loadOnboardingContext,submitApplicationDraft,
  validateApplicationDraft,buildApplicationSubmitBody,retryRequestId,resolveApplyPhase,
  LOGIN_PAGE_URL,STATUS_PAGE_URL,DASHBOARD_URL,
  type OnboardingState,
} from '../app/staff/apply/onboarding-controller';
import {resolveStatusView,formatThaiStamp} from '../app/staff/application/status-controller';
import {LINE_LOGIN_APPLICATION_URL,LINE_LINK_EXISTING_URL} from '../app/login/line-login-entry';
import type {StaffApplicationContext,StaffApplicationItem} from '../types/staff-applications';

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

function staffContext(overrides:Partial<StaffApplicationContext>={}):StaffApplicationContext{
  return {
    authenticated:true,lineLinked:true,staffActive:false,loginAvailable:true,canReview:false,
    application:null,
    departments:[{id:'dept-1',name:'บริการวิชาการ'},{id:'dept-2',name:'ห้องสมุด'}],
    ...overrides,
  };
}

function applicationFixture(overrides:Partial<StaffApplicationItem>={}):StaffApplicationItem{
  return {
    id:'app-1',applicantName:'สมชาย ใจดี',staffCode:'YRU-0001',
    requestedDepartmentId:'dept-1',requestedDepartmentName:'บริการวิชาการ',
    approvedDepartmentId:null,approvedDepartmentName:null,status:'PENDING',
    revision:0,submittedAt:'2026-10-28T03:00:00.000Z',reviewedAt:null,reviewerName:null,decisionReason:null,
    ...overrides,
  };
}

describe('GET /api/staff/onboarding outcomes',()=>{
  it('reads the application context with same-origin GET',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json(staffContext()));
    const outcome=await loadOnboardingContext(fetchImpl);
    expect(outcome.kind).toBe('ready');
    if(outcome.kind==='ready')expect(outcome.context.lineLinked).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [input,init]=fetchImpl.mock.calls[0]!;
    expect(String(input)).toBe('/api/staff/onboarding');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
  });
  it('treats 401 as unauthenticated, not as an error page',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({error:'unauthenticated'},401));
    expect((await loadOnboardingContext(fetchImpl)).kind).toBe('unauthenticated');
  });
  it('treats 503, malformed payload and network failure as unavailable',async()=>{
    expect((await loadOnboardingContext(vi.fn<typeof fetch>().mockResolvedValue(new Response('service unavailable',{status:503})))).kind).toBe('unavailable');
    expect((await loadOnboardingContext(vi.fn<typeof fetch>().mockResolvedValue(new Response('{"authenticated":true',{status:200})))).kind).toBe('unavailable');
    expect((await loadOnboardingContext(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))).kind).toBe('unavailable');
  });
});

describe('context gating before the apply form',()=>{
  it('starts in loading and maps each failure kind',()=>{
    expect(resolveApplyPhase(initialOnboardingState())).toBe('loading');
    expect(resolveApplyPhase(reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_FAILED',kind:'unauthenticated'}))).toBe('login');
    expect(resolveApplyPhase(reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_FAILED',kind:'unavailable'}))).toBe('unavailable');
  });
  it('requires auth, then LINE linking, before showing the form',()=>{
    expect(resolveApplyPhase(reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext({authenticated:false})}))).toBe('login');
    expect(resolveApplyPhase(reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext({lineLinked:false})}))).toBe('linkLine');
  });
  it('routes active staff and existing applications away from the form',()=>{
    expect(resolveApplyPhase(reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext({staffActive:true,application:applicationFixture({status:'APPROVED'})})}))).toBe('alreadyStaff');
    expect(resolveApplyPhase(reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext({application:applicationFixture()})}))).toBe('recorded');
  });
  it('shows the form only with departments supplied by the API',()=>{
    const state=reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext()});
    expect(resolveApplyPhase(state)).toBe('form');
    expect(state.phase==='form'&&state.context?.departments.length).toBe(2);
    const empty=reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext({departments:[]})});
    expect(resolveApplyPhase(empty)).toBe('unavailable');
  });
});

describe('near-field validation before submit',()=>{
  const departments=[{id:'dept-1',name:'บริการวิชาการ'},{id:'dept-2',name:'ห้องสมุด'}];
  it('rejects blank fields and departments outside the API list',()=>{
    const errors=validateApplicationDraft({applicantName:'   ',staffCode:'',departmentId:'dept-9'},departments);
    expect(Object.keys(errors).sort()).toEqual(['applicantName','departmentId','staffCode']);
  });
  it('accepts a complete draft and blocks submit while invalid',()=>{
    expect(validateApplicationDraft({applicantName:'สมชาย ใจดี',staffCode:'YRU-0001',departmentId:'dept-1'},departments)).toEqual({});
    expect(resolveApplyPhase(reduceOnboarding(
      reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext()}),
      {type:'SUBMITTED_WITH_VALIDATION_ERRORS',errors:{staffCode:'โปรดระบุรหัสบุคลากร'}},
    ))).toBe('form');
  });
});

describe('POST /api/staff/applications body and outcomes',()=>{
  it('sends exactly the four contract fields and nothing about roles or permissions',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json(applicationFixture()));
    const outcome=await submitApplicationDraft(fetchImpl,'req-1',{applicantName:' สมชาย ใจดี  ',staffCode:' YRU-0001 ',departmentId:'dept-1'});
    expect(outcome.kind).toBe('submitted');
    const [input,init]=fetchImpl.mock.calls[0]!;
    expect(String(input)).toBe('/api/staff/applications');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(init?.body))).toEqual(buildApplicationSubmitBody(
      'req-1',{applicantName:'สมชาย ใจดี',staffCode:'YRU-0001',departmentId:'dept-1'},
    ));
  });
  it('builds a body with only the four contract keys',()=>{
    const body=buildApplicationSubmitBody('req-1',{applicantName:'สมชาย ใจดี',staffCode:'YRU-0001',departmentId:'dept-1'});
    expect(Object.keys(body).sort()).toEqual(['applicantName','departmentId','requestId','staffCode']);
    expect('role' in body || 'active' in body || 'permissions' in body).toBe(false);
  });
  it('maps 409 to conflict and 401 to unauthenticated without retry',async()=>{
    expect((await submitApplicationDraft(vi.fn<typeof fetch>().mockResolvedValue(json({error:'duplicate'},409)),'req-1',{applicantName:'A',staffCode:'1',departmentId:'dept-1'})).kind).toBe('conflict');
    expect((await submitApplicationDraft(vi.fn<typeof fetch>().mockResolvedValue(json({},401)),'req-1',{applicantName:'A',staffCode:'1',departmentId:'dept-1'})).kind).toBe('unauthenticated');
  });
  it('treats network and 5xx as uncertain so the retry can reuse the request id',async()=>{
    expect((await submitApplicationDraft(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),'req-1',{applicantName:'A',staffCode:'1',departmentId:'dept-1'})).kind).toBe('uncertain');
    expect((await submitApplicationDraft(vi.fn<typeof fetch>().mockResolvedValue(json({},500)),'req-1',{applicantName:'A',staffCode:'1',departmentId:'dept-1'})).kind).toBe('uncertain');
  });
});

describe('draft and request-id retention',()=>{
  function formState():OnboardingState{
    return reduceOnboarding(initialOnboardingState(),{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext()});
  }
  it('keeps an uncertain submission body immutable across edits and context outages',()=>{
    let state=formState();
    state=reduceOnboarding(state,{type:'DRAFT_FIELD_CHANGED',field:'applicantName',value:'ผู้สมัครเดิม'});
    state=reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-9'});
    expect(reduceOnboarding(state,{type:'DRAFT_FIELD_CHANGED',field:'applicantName',value:'เปลี่ยนระหว่างส่ง'}).draft).toEqual(state.draft);
    state=reduceOnboarding(state,{type:'SUBMIT_UNCERTAIN'});
    expect(reduceOnboarding(state,{type:'DRAFT_FIELD_CHANGED',field:'applicantName',value:'เปลี่ยนหลังไม่ทราบผล'}).draft).toEqual(state.draft);
    expect(reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-new'}).requestId).toBe('req-9');
    expect(reduceOnboarding(state,{type:'CONTEXT_LOAD_FAILED',kind:'unavailable'}).requestId).toBe('req-9');
  });
  it('keeps the request id after an uncertain outcome for the retry',()=>{
    let state=formState();
    state=reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-9'});
    state=reduceOnboarding(state,{type:'SUBMIT_UNCERTAIN'});
    expect(retryRequestId(state)).toBe('req-9');
    state=reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-9'});
    expect(state.phase==='form'&&state.requestId).toBe('req-9');
  });
  it('keeps the draft and reloads the context after a conflict',()=>{
    let state=formState();
    state=reduceOnboarding(state,{type:'DRAFT_FIELD_CHANGED',field:'applicantName',value:'สมชาย ใจดี'});
    state=reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-1'});
    state=reduceOnboarding(state,{type:'SUBMIT_CONFLICT'});
    expect(state.phase==='form'&&state.conflict&&retryRequestId(state)).toBeNull();
    expect(state.phase==='form'&&state.draft.applicantName).toBe('สมชาย ใจดี');
    state=reduceOnboarding(state,{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext({application:applicationFixture()})});
    expect(resolveApplyPhase(state)).toBe('recorded');
    state=reduceOnboarding(state,{type:'CONTEXT_LOAD_SUCCEEDED',context:staffContext()});
    expect(state.phase==='form'&&state.draft.applicantName).toBe('สมชาย ใจดี');
  });
  it('clears the request id on definitive client errors but keeps the draft',()=>{
    let state=formState();
    state=reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-1'});
    state=reduceOnboarding(state,{type:'SUBMIT_FAILED_VALIDATION',message:'ข้อมูลไม่ถูกต้อง'});
    expect(retryRequestId(state)).toBeNull();
    expect(state.phase==='form'&&state.errors===null&&state.notice?.kind).toBe('error');
  });
  it('clears everything on session reset',()=>{
    let state=formState();
    state=reduceOnboarding(state,{type:'SUBMIT_STARTED',requestId:'req-1'});
    state=reduceOnboarding(state,{type:'SUBMIT_UNCERTAIN'});
    state=reduceOnboarding(state,{type:'SESSION_CLEARED'});
    expect(state).toEqual(initialOnboardingState());
    expect(retryRequestId(state)).toBeNull();
  });
});

describe('self status presentation uses server truth only',()=>{
  it('maps each application status to its own view',()=>{
    expect(resolveStatusView(staffContext(),null).phase).toBe('noApplication');
    expect(resolveStatusView(staffContext(),applicationFixture()).phase).toBe('pending');
    for(const status of ['APPROVED','REJECTED','SUSPENDED'] as const){
      expect(resolveStatusView(staffContext(),applicationFixture({status})).phase).toBe(status.toLowerCase());
    }
  });
  it('exposes reviewer and reason fields straight from the record',()=>{
    const view=resolveStatusView(staffContext(),applicationFixture({
      status:'REJECTED',reviewerName:'ผู้ดูแล A',decisionReason:'ไม่ผ่านการตรวจสอบกิตติกรรม',reviewedAt:'2026-10-28T04:00:00.000Z',
    }));
    expect(view.phase).toBe('rejected');
    expect(view.application?.decisionReason).toBe('ไม่ผ่านการตรวจสอบกิตติกรรม');
    expect(view.application?.reviewerName).toBe('ผู้ดูแล A');
  });
  it('formats stamps for the viewer and degrades safely on invalid input',()=>{
    expect(formatThaiStamp('2026-10-28T03:00:00.000Z')).toMatch(/28/);
    expect(formatThaiStamp('not-a-date')).toBeNull();
    expect(formatThaiStamp(null)).toBeNull();
  });
});

describe('fixed navigation targets',()=>{
  it('uses only the documented LINE login and link targets',()=>{
    expect(LINE_LOGIN_APPLICATION_URL).toBe('/auth/line?next=/staff/apply');
    expect(LINE_LINK_EXISTING_URL).toBe('/auth/line?mode=link&next=/staff/application');
    expect(LOGIN_PAGE_URL).toBe('/login');
    expect(STATUS_PAGE_URL).toBe('/staff/application');
    expect(DASHBOARD_URL).toBe('/dashboard');
  });
});
