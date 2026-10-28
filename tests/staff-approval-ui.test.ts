import {describe,expect,it,vi} from 'vitest';
import {
  initialApprovalState,reduceApproval,buildApplicationsListQuery,loadApplications,
  decideApplication,suspendApplication,validateDecisionForm,activeRequestId,
} from '../app/(dashboard)/staff-applications/applications-controller';
import type {StaffApplicationItem,StaffApplicationList} from '../types/staff-applications';

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

function itemFixture(overrides:Partial<StaffApplicationItem>={}):StaffApplicationItem{
  return {
    id:'app-1',applicantName:'สมชาย ใจดี',staffCode:'YRU-0001',
    requestedDepartmentId:'dept-1',requestedDepartmentName:'บริการวิชาการ',
    approvedDepartmentId:null,approvedDepartmentName:null,status:'PENDING',
    revision:3,submittedAt:'2026-10-28T03:00:00.000Z',reviewedAt:null,reviewerName:null,decisionReason:null,
    ...overrides,
  };
}

function listFixture(items:StaffApplicationItem[]=[itemFixture()],pagination?:Partial<StaffApplicationList['pagination']>):StaffApplicationList{
  return {
    items,departments:[{id:'dept-1',name:'บริการวิชาการ'},{id:'dept-2',name:'ห้องสมุด'}],
    pagination:{page:1,pageSize:25,total:97,totalPages:4,hasNext:true,hasPrevious:false,...pagination},
  };
}

function readyState(items:StaffApplicationItem[]=[itemFixture()]){
  const requested=reduceApproval(initialApprovalState(),{type:'LIST_LOAD_REQUESTED'});
  const loaded=reduceApproval(requested,{type:'LIST_LOAD_SUCCEEDED',serial:requested.listSerial,list:listFixture(items)});
  return reduceApproval(loaded,{type:'DECISION_DIALOG_OPENED',application:items[0]!,decision:'APPROVE'});
}

describe('server-driven list query',()=>{
  it('serialises status, page and pageSize exactly as the API expects',()=>{
    expect(buildApplicationsListQuery({status:'PENDING',page:1,pageSize:25})).toBe('/api/staff/applications?status=PENDING&page=1&pageSize=25');
    expect(buildApplicationsListQuery({status:'SUSPENDED',page:7,pageSize:1})).toBe('/api/staff/applications?status=SUSPENDED&page=7&pageSize=1');
  });
  it('clamps page and pageSize inside the server limits',()=>{
    expect(buildApplicationsListQuery({status:'PENDING',page:0,pageSize:1000})).toBe('/api/staff/applications?status=PENDING&page=1&pageSize=100');
  });
  it('loads a page and reflects the server totals untouched',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json(listFixture([itemFixture()],{page:3,total:97,totalPages:4})));
    const outcome=await loadApplications(fetchImpl,{status:'PENDING',page:3,pageSize:25});
    expect(outcome.kind).toBe('ready');
    if(outcome.kind==='ready'){
      expect(outcome.list.pagination).toEqual({page:3,pageSize:25,total:97,totalPages:4,hasNext:true,hasPrevious:false});
    }
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('/api/staff/applications?status=PENDING&page=3&pageSize=25');
  });
  it('maps 401/403/load failures to distinct outcomes',async()=>{
    expect((await loadApplications(vi.fn<typeof fetch>().mockResolvedValue(json({},401)),{status:'PENDING',page:1,pageSize:25})).kind).toBe('unauthenticated');
    expect((await loadApplications(vi.fn<typeof fetch>().mockResolvedValue(json({},403)),{status:'PENDING',page:1,pageSize:25})).kind).toBe('forbidden');
    expect((await loadApplications(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),{status:'PENDING',page:1,pageSize:25})).kind).toBe('unavailable');
    expect((await loadApplications(vi.fn<typeof fetch>().mockResolvedValue(new Response('{"items":[',{status:200})),{status:'PENDING',page:1,pageSize:25})).kind).toBe('unavailable');
  });
});

describe('list state machine',()=>{
  it('defaults to the pending tab and loads page one',()=>{
    expect(initialApprovalState().filter).toEqual({status:'PENDING',page:1,pageSize:25});
    const state=reduceApproval(initialApprovalState(),{type:'LIST_LOAD_REQUESTED'});
    expect(state.listPhase).toBe('loading');
  });
  it('ignores stale list responses and accepts the current serial only',()=>{
    const requested=reduceApproval(initialApprovalState(),{type:'LIST_LOAD_REQUESTED'});
    const stale=reduceApproval(requested,{type:'LIST_LOAD_SUCCEEDED',serial:0,list:listFixture([itemFixture({status:'APPROVED',revision:9})])});
    expect(stale.list).toBeNull();
    expect(stale.listPhase).toBe('loading');
    const current=reduceApproval(requested,{type:'LIST_LOAD_SUCCEEDED',serial:requested.listSerial,list:listFixture()});
    expect(current.listPhase).toBe('ready');
    expect(current.list?.pagination.total).toBe(97);
  });
  it('marks empty, unavailable and denied views distinctly',()=>{
    const base=reduceApproval(initialApprovalState(),{type:'LIST_LOAD_REQUESTED'});
    expect(reduceApproval(base,{type:'LIST_LOAD_SUCCEEDED',serial:base.listSerial,list:listFixture([])}).listPhase).toBe('empty');
    expect(reduceApproval(base,{type:'LIST_LOAD_FAILED',serial:base.listSerial,kind:'unavailable'}).listPhase).toBe('unavailable');
    const denied=reduceApproval(base,{type:'LIST_LOAD_FAILED',serial:base.listSerial,kind:'forbidden'});
    expect(denied.listPhase).toBe('forbidden');
    expect(denied.notice?.kind).toBe('error');
  });
  it('changing the tab restarts at page one with a fresh serial',()=>{
    const started=reduceApproval(initialApprovalState(),{type:'LIST_LOAD_REQUESTED'});
    let state=reduceApproval(started,{type:'LIST_LOAD_SUCCEEDED',serial:started.listSerial,list:listFixture()});
    state=reduceApproval(state,{type:'STATUS_TAB_CHANGED',status:'REJECTED'});
    expect(state.filter).toEqual({status:'REJECTED',page:1,pageSize:25});
    expect(state.listPhase).toBe('loading');
    expect(state.listSerial).toBeGreaterThan(started.listSerial);
    expect(state.list).toBeNull();
  });
});

describe('decision dialog and validation',()=>{
  it('opens the dialog per decision and requires an explicit final department for approve',()=>{
    const dialog=readyState().dialog;
    expect(dialog?.phase).toBe('confirm');
    expect(validateDecisionForm('APPROVE',{departmentId:'',reason:''},true).departmentId).toBeTruthy();
    expect(validateDecisionForm('APPROVE',{departmentId:'dept-2',reason:''},true)).toEqual({});
    expect(validateDecisionForm('REJECT',{departmentId:'',reason:''},true).reason).toBeTruthy();
    expect(validateDecisionForm('REJECT',{departmentId:'',reason:'เหตุผล'},true)).toEqual({});
  });
  it('suspension needs a reason plus impact acknowledgment',()=>{
    expect(validateDecisionForm('SUSPEND',{departmentId:'',reason:''},false).impact).toBeTruthy();
    expect(validateDecisionForm('SUSPEND',{departmentId:'',reason:'ละเมิดข้อบังคับ'},false)).toEqual({impact:expect.any(String)});
    expect(validateDecisionForm('SUSPEND',{departmentId:'',reason:'ละเมิดข้อบังคับ'},true)).toEqual({});
  });
});

describe('decision payloads use only contract fields',()=>{
  it('posts an approve with exactly decision, departmentId, revision and requestId',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json(itemFixture()));
    const outcome=await decideApplication(fetchImpl,'app-1',{kind:'APPROVE',departmentId:'dept-2'},3,'req-a');
    expect(outcome.kind).toBe('updated');
    const [input,init]=fetchImpl.mock.calls[0]!;
    expect(String(input)).toBe('/api/staff/applications/app-1/decision');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
    expect(Object.keys(body).sort()).toEqual(['decision','departmentId','requestId','revision']);
    expect(body.decision).toBe('APPROVE');
    expect(body.departmentId).toBe('dept-2');
    expect(body.revision).toBe(3);
    expect(body.requestId).toBe('req-a');
  });
  it('posts a reject with reason and never a department grant',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json(itemFixture()));
    await decideApplication(fetchImpl,'app-1',{kind:'REJECT',reason:'ตำแหน่งไม่ตรง'},3,'req-b');
    const body=JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0]![1]?.body)) as Record<string,unknown>;
    expect(Object.keys(body).sort()).toEqual(['decision','reason','requestId','revision']);
    expect(body.departmentId ?? null).toBeNull();
  });
  it('posts suspensions to their own endpoint with reason, revision and requestId',async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json(itemFixture({status:'SUSPENDED'})));
    await suspendApplication(fetchImpl,'app 2','ละเมิดข้อบังคับ',3,'req-c');
    const [input,init]=fetchImpl.mock.calls[0]!;
    expect(String(input)).toBe('/api/staff/applications/app%202/suspend');
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
    expect(Object.keys(body).sort()).toEqual(['reason','requestId','revision']);
    expect(body.decision ?? null).toBeNull();
  });
  it('maps 409/403/401/404/400/5xx into distinct outcomes',async()=>{
    const draft={kind:'APPROVE' as const,departmentId:'dept-2'};
    expect((await decideApplication(vi.fn<typeof fetch>().mockResolvedValue(json({error:'conflict'},409)),'a',draft,3,'r')).kind).toBe('conflict');
    expect((await decideApplication(vi.fn<typeof fetch>().mockResolvedValue(json({},403)),'a',draft,3,'r')).kind).toBe('denied');
    expect((await decideApplication(vi.fn<typeof fetch>().mockResolvedValue(json({},401)),'a',draft,3,'r')).kind).toBe('unauthenticated');
    expect((await decideApplication(vi.fn<typeof fetch>().mockResolvedValue(json({},404)),'a',draft,3,'r')).kind).toBe('notFound');
    expect((await decideApplication(vi.fn<typeof fetch>().mockResolvedValue(json({error:'bad'},400)),'a',draft,3,'r')).kind).toBe('invalid');
    expect((await decideApplication(vi.fn<typeof fetch>().mockResolvedValue(json({},500)),'a',draft,3,'r')).kind).toBe('uncertain');
    expect((await decideApplication(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),'a',draft,3,'r')).kind).toBe('uncertain');
  });
});

describe('concurrent reviewer protection',()=>{
  it.each(['unauthenticated','forbidden'] as const)('clears private rows and drawer after list access becomes %s',kind=>{
    const state=readyState();
    const denied=reduceApproval(state,{type:'LIST_LOAD_FAILED',serial:state.listSerial,kind});
    expect(denied.list).toBeNull();
    expect(denied.dialog).toBeNull();
  });
  it.each(['denied','unauthenticated','notFound'] as const)('clears private snapshots after mutation %s',kind=>{
    const state=reduceApproval(readyState(),{type:'DIALOG_SUBMIT_STARTED',requestId:'req-a',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    const denied=reduceApproval(state,{type:'DIALOG_SUBMIT_FAILED',requestId:'req-a',kind});
    expect(denied.list).toBeNull();
    expect(denied.dialog).toBeNull();
  });
  it('cannot dismiss or change a pending or uncertain mutation payload',()=>{
    let state=reduceApproval(readyState(),{type:'DIALOG_FIELD_CHANGED',departmentId:'dept-2'});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-a',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    expect(reduceApproval(state,{type:'DIALOG_CLOSED'}).dialog).toEqual(state.dialog);
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_FAILED',requestId:'req-a',kind:'uncertain'});
    expect(reduceApproval(state,{type:'DIALOG_CLOSED'}).dialog).toEqual(state.dialog);
    expect(reduceApproval(state,{type:'DIALOG_FIELD_CHANGED',departmentId:'dept-1'}).dialog).toEqual(state.dialog);
  });
  it('keeps a conflicted draft non-actionable when the row leaves the filtered page',()=>{
    let state=reduceApproval(readyState(),{type:'DIALOG_FIELD_CHANGED',departmentId:'dept-2'});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-a',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_CONFLICT',requestId:'req-a'});
    expect(reduceApproval(state,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}}).dialog?.requestId).toBeNull();
    state=reduceApproval(state,{type:'LIST_LOAD_SUCCEEDED',serial:state.listSerial,list:listFixture([])});
    expect(state.dialog?.departmentId).toBe('dept-2');
    expect(state.dialog?.notice?.text).toContain('ไม่อยู่ในรายการ');
    expect(reduceApproval(state,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}}).dialog?.requestId).toBeNull();
  });
  it('blocks double submission while a request is in flight',()=>{
    const opened=reduceApproval(readyState(),{type:'DIALOG_SUBMIT_STARTED',requestId:'req-a',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    expect(opened.dialog?.phase).toBe('submitting');
    expect(opened.dialog?.requestId).toBe('req-a');
    const echoed=reduceApproval(opened,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-z',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    expect(echoed.dialog?.requestId).toBe('req-a');
    expect(activeRequestId(echoed)).toBe('req-a');
  });
  it('ignores out-of-order responses from an older request',()=>{
    const opened=reduceApproval(readyState(),{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    const stale=reduceApproval(opened,{type:'DIALOG_SUBMIT_SUCCEEDED',requestId:'req-a',item:itemFixture()});
    expect(stale.dialog?.phase).toBe('submitting');
    const fresh=reduceApproval(opened,{type:'DIALOG_SUBMIT_SUCCEEDED',requestId:'req-b',item:itemFixture()});
    expect(fresh.dialog).toBeNull();
    expect(fresh.listPhase).toBe('loading');
    expect(fresh.notice?.kind).toBe('success');
  });
  it('on conflict keeps the review draft, reloads server data and never auto-decides',()=>{
    let state=reduceApproval(readyState(),{type:'DIALOG_FIELD_CHANGED',departmentId:'dept-2',reason:'สอดคล้องกับงบประมาณ'});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_CONFLICT',requestId:'req-b'});
    expect(state.dialog?.phase).toBe('conflict');
    expect(state.dialog?.departmentId).toBe('dept-2');
    expect(activeRequestId(state)).toBeNull();
    expect(state.listPhase).toBe('loading');
    state=reduceApproval(state,{type:'LIST_LOAD_SUCCEEDED',serial:state.listSerial,list:listFixture([itemFixture({revision:4})])});
    expect(state.dialog?.application.revision).toBe(4);
    expect(state.dialog?.phase).toBe('conflict');
    expect(state.dialog?.departmentId).toBe('dept-2');
  });
  it('retains the request id across uncertain outcomes so retries stay idempotent',()=>{
    let state=reduceApproval(readyState(),{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_FAILED',requestId:'req-b',kind:'uncertain'});
    expect(state.dialog?.phase).toBe('confirm');
    expect(activeRequestId(state)).toBe('req-b');
  });
  it('clears request ids on definitive failures and surfaces denials without retry',()=>{
    let state=reduceApproval(readyState(),{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    state=reduceApproval(state,{type:'DIALOG_SUBMIT_FAILED',requestId:'req-b',kind:'denied'});
    expect(state.dialog).toBeNull();
    expect(activeRequestId(state)).toBeNull();
    expect(state.notice?.kind).toBe('error');
  });
  it('background refresh cannot change the revision of a retained request',()=>{
    let state=reduceApproval(readyState(),{type:'DIALOG_SUBMIT_STARTED',requestId:'req-b',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}});
    state=reduceApproval(state,{type:'LIST_LOAD_REQUESTED'});
    const refreshed=reduceApproval(state,{type:'LIST_LOAD_SUCCEEDED',serial:state.listSerial,list:listFixture([itemFixture({revision:5})])});
    expect(refreshed.dialog?.application.revision).toBe(3);
  });
  it('read-only details cannot issue a second decision on a finished application',()=>{
    const state=readyState([itemFixture({status:'REJECTED'})]);
    expect(reduceApproval(state,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-a',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}}).dialog?.requestId).toBeNull();
  });
  it('closing the dialog drafts nothing and clearing the session resets everything',()=>{
    const opened=readyState();
    const closed=reduceApproval(opened,{type:'DIALOG_CLOSED'});
    expect(closed.dialog).toBeNull();
    expect(closed.listPhase).toBe('ready');
    const reset=reduceApproval(reduceApproval(opened,{type:'DIALOG_SUBMIT_STARTED',requestId:'req-a',revision:3,command:{kind:'APPROVE',departmentId:'dept-2'}}),{type:'SESSION_CLEARED'});
    expect(reset).toEqual(initialApprovalState());
  });
});
