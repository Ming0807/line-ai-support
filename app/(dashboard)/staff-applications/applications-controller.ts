/**
 * Controller for the SuperAdmin approval console (/staff-applications).
 *
 * Production adapter is fetch against the documented contract:
 *   GET  /api/staff/applications?status=…&page=…&pageSize=… -> StaffApplicationList
 *   POST /api/staff/applications/[id]/decision (DecideStaffApplication)
 *   POST /api/staff/applications/[id]/suspend (SuspendStaffApplication)
 *
 * Server data owns totals and permission decisions. Concurrency uses the
 * application revision plus a per-attempt requestId: uncertain retries reuse the
 * same id, 409 keeps the reviewer's draft and reloads server data, and stale or
 * duplicate responses never overwrite newer state. No mock ships here; mocks live
 * in tests.
 */
import type {StaffApplicationItem,StaffApplicationList} from '@/types/staff-applications';

const APPLICATIONS_API = '/api/staff/applications';

export const PAGE_SIZE_LIMIT = 100;

export type ApprovalsStatusFilter = 'PENDING'|'APPROVED'|'REJECTED'|'SUSPENDED';
export type ApprovalsFilter = {status:ApprovalsStatusFilter; page:number; pageSize:number};
export type ApprovalsNotice = {kind:'error'|'conflict'|'success'|'uncertain'|'info'; text:string};
export type ApprovalsListPhase = 'loading'|'ready'|'empty'|'unavailable'|'unauthenticated'|'forbidden';

export type DecisionKind = 'APPROVE'|'REJECT'|'SUSPEND';
export type DisciplineCommand = {kind:'APPROVE'; departmentId:string}|{kind:'REJECT'; reason:string};
export type DecisionDialogPhase = 'confirm'|'submitting'|'conflict';
export type DecisionFormErrors = {departmentId?:string; reason?:string; impact?:string} | null;

export type DecisionDialog = {
  application:StaffApplicationItem;
  decision:DecisionKind;
  departmentId:string;
  reason:string;
  impactAcknowledged:boolean;
  phase:DecisionDialogPhase;
  requestId:string|null;
  errors:DecisionFormErrors;
  notice:ApprovalsNotice|null;
  freshness:'current'|'refreshing'|'missing';
};

export type ApprovalState = {
  filter:ApprovalsFilter;
  listPhase:ApprovalsListPhase;
  list:StaffApplicationList|null;
  listSerial:number;
  dialog:DecisionDialog|null;
  notice:ApprovalsNotice|null;
};

export type ApprovalAction =
  | {type:'LIST_LOAD_REQUESTED'}
  | {type:'STATUS_TAB_CHANGED'; status:ApprovalsStatusFilter}
  | {type:'LIST_PAGE_CHANGED'; page:number}
  | {type:'LIST_LOAD_SUCCEEDED'; serial:number; list:StaffApplicationList}
  | {type:'LIST_LOAD_FAILED'; serial:number; kind:'unauthenticated'|'forbidden'|'unavailable'}
  | {type:'DECISION_DIALOG_OPENED'; application:StaffApplicationItem; decision:DecisionKind}
  | {type:'DIALOG_FIELD_CHANGED'; departmentId?:string; reason?:string; impactAcknowledged?:boolean}
  | {type:'DIALOG_VALIDATION_FAILED'; errors:Exclude<DecisionFormErrors,null>}
  | {type:'DIALOG_SUBMIT_STARTED'; requestId:string; revision:number; command:DisciplineCommand|{kind:'SUSPEND'; reason:string}}
  | {type:'DIALOG_SUBMIT_SUCCEEDED'; requestId:string; item:StaffApplicationItem}
  | {type:'DIALOG_SUBMIT_CONFLICT'; requestId:string}
  | {type:'DIALOG_SUBMIT_FAILED'; requestId:string; kind:'denied'|'invalid'|'unauthenticated'|'notFound'|'uncertain'}
  | {type:'DIALOG_CLOSED'}
  | {type:'SESSION_CLEARED'};

export function initialApprovalState(): ApprovalState {
  return {
    filter:{status:'PENDING', page:1, pageSize:25},
    listPhase:'loading', list:null, listSerial:0, dialog:null, notice:null,
  };
}

/** Serialised GET path; page starts at 1 and pageSize is bounded by the server limit. */
export function buildApplicationsListQuery(filter:ApprovalsFilter): string {
  const page = Math.max(1, Math.floor(filter.page));
  const pageSize = Math.min(PAGE_SIZE_LIMIT, Math.max(1, Math.floor(filter.pageSize)));
  const params = new URLSearchParams({status:filter.status, page:String(page), pageSize:String(pageSize)});
  return `${APPLICATIONS_API}?${params.toString()}`;
}

export type ListOutcome =
  | {kind:'ready'; list:StaffApplicationList}
  | {kind:'unauthenticated'}
  | {kind:'forbidden'}
  | {kind:'unavailable'};

type UnknownRecord = Record<string, unknown>;

function isListShape(value:unknown): value is StaffApplicationList {
  const candidate = value as Partial<StaffApplicationList> | null;
  return !!candidate
    && Array.isArray(candidate.items)
    && Array.isArray(candidate.departments)
    && typeof candidate.pagination === 'object' && candidate.pagination !== null
    && typeof (candidate.pagination as Partial<StaffApplicationList['pagination']>)?.total === 'number';
}

function isItemShape(value:unknown): value is StaffApplicationItem {
  const candidate = value as Partial<StaffApplicationItem> | null;
  return !!candidate && typeof candidate.id === 'string' && typeof candidate.status === 'string';
}

/** GET /api/staff/applications — totals come back untouched from the server. */
export async function loadApplications(fetchImpl:typeof fetch, filter:ApprovalsFilter): Promise<ListOutcome> {
  let response:Response;
  try {
    response = await fetchImpl(buildApplicationsListQuery(filter), {
      method:'GET', credentials:'same-origin', cache:'no-store',
      headers:{accept:'application/json'},
    });
  } catch {
    return {kind:'unavailable'};
  }
  if (response.status === 401) return {kind:'unauthenticated'};
  if (response.status === 403) return {kind:'forbidden'};
  if (!response.ok) return {kind:'unavailable'};
  try {
    const parsed = JSON.parse(await response.text()) as UnknownRecord;
    return isListShape(parsed) ? {kind:'ready', list:parsed} : {kind:'unavailable'};
  } catch {
    return {kind:'unavailable'};
  }
}

/** POST /api/staff/applications/[id]/decision with exact contract fields. */
export async function decideApplication(
  fetchImpl:typeof fetch,
  applicationId:string,
  command:DisciplineCommand,
  revision:number,
  requestId:string,
): Promise<DecisionMutationOutcome> {
  let body:UnknownRecord;
  if (command.kind === 'APPROVE') body = {decision:'APPROVE', departmentId:command.departmentId, revision, requestId};
  else body = {decision:'REJECT', reason:command.reason, revision, requestId};
  return runApplicationMutation(fetchImpl, `${encodeURIComponent(applicationId)}/decision`, body);
}

/** POST /api/staff/applications/[id]/suspend with reason, revision and requestId. */
export async function suspendApplication(
  fetchImpl:typeof fetch,
  applicationId:string,
  reason:string,
  revision:number,
  requestId:string,
): Promise<DecisionMutationOutcome> {
  return runApplicationMutation(fetchImpl, `${encodeURIComponent(applicationId)}/suspend`, {reason, revision, requestId});
}

export type DecisionMutationOutcome =
  | {kind:'updated'; item:StaffApplicationItem}
  | {kind:'conflict'}
  | {kind:'denied'}
  | {kind:'unauthenticated'}
  | {kind:'notFound'}
  | {kind:'invalid'; message:string}
  | {kind:'uncertain'};

async function runApplicationMutation(
  fetchImpl:typeof fetch,
  subpath:string,
  body:UnknownRecord,
): Promise<DecisionMutationOutcome> {
  let response:Response;
  try {
    response = await fetchImpl(`${APPLICATIONS_API}/${subpath}`, {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'content-type':'application/json', accept:'application/json'},
      body:JSON.stringify(body),
    });
  } catch {
    return {kind:'uncertain'};
  }
  if (response.ok) {
    try {
      const parsed = JSON.parse(await response.text()) as UnknownRecord;
      if (isItemShape(parsed)) return {kind:'updated', item:parsed};
    } catch {
      return {kind:'uncertain'};
    }
    return {kind:'uncertain'};
  }
  if (response.status === 401) return {kind:'unauthenticated'};
  if (response.status === 409) return {kind:'conflict'};
  if (response.status === 403) return {kind:'denied'};
  if (response.status === 404) return {kind:'notFound'};
  if (response.status >= 500) return {kind:'uncertain'};
  return {kind:'invalid', message:'ระบบปฏิเสธการตัดสินใจนี้ กรุณาตรวจสอบข้อมูลล่าสุดแล้วทำใหม่อีกครั้ง'};
}

/** Near-field validation of the reviewer form before any network call. */
export function validateDecisionForm(
  decision:DecisionKind,
  form:{departmentId:string; reason:string},
  impactAcknowledged:boolean,
): Exclude<DecisionFormErrors,null> {
  const errors:Exclude<DecisionFormErrors,null> = {};
  if (decision === 'APPROVE' && !form.departmentId) {
    errors.departmentId = 'โปรดเลือกฝ่ายสุดท้ายที่จะอนุมัติก่อนยืนยัน';
  }
  if (decision === 'REJECT' && form.reason.trim() === '') {
    errors.reason = 'โปรดระบุเหตุผลที่ไม่อนุมัติ';
  }
  if (decision === 'SUSPEND') {
    if (form.reason.trim() === '') errors.reason = 'โปรดระบุเหตุผลการระงับการใช้งาน';
    if (!impactAcknowledged) errors.impact = 'โปรดยืนยันว่าเข้าใจผลกระทบของการระงับก่อน';
  }
  return errors;
}

function openDialog(application:StaffApplicationItem, decision:DecisionKind): DecisionDialog {
  return {
    application, decision, departmentId:'', reason:'', impactAcknowledged:false,
    phase:'confirm', requestId:null, errors:null, notice:null, freshness:'current',
  };
}

function clearFieldError(errors:DecisionFormErrors, field:'departmentId'|'reason'|'impact'): DecisionFormErrors {
  if (!errors || !errors[field]) return errors;
  const remaining = {...errors};
  delete remaining[field];
  return remaining;
}

/** Request id of the in-flight or retained submission, used for idempotent retries. */
export function activeRequestId(state:ApprovalState): string|null {
  return state.dialog?.requestId ?? null;
}

function refreshDialogApplication(dialog:DecisionDialog|null, list:StaffApplicationList): DecisionDialog|null {
  if (!dialog) return dialog;
  // An uncertain retry must retain exactly the original body, including revision.
  if (dialog.requestId) return dialog;
  const fresh = list.items.find(item => item.id === dialog.application.id);
  return fresh ? {...dialog, application:fresh, freshness:'current',
    notice:dialog.phase === 'conflict' ? {kind:'conflict',text:'โหลดข้อมูลล่าสุดแล้ว โปรดตรวจทานสถานะและฝ่ายก่อนยืนยันใหม่ ไม่มีการบันทึกซ้ำอัตโนมัติ'} : dialog.notice} : {...dialog, freshness:'missing',
    notice:{kind:'conflict',text:'คำขอนี้ไม่อยู่ในรายการล่าสุด อาจเปลี่ยนสถานะหรือหน้าแล้ว ร่างยังอยู่ แต่ต้องปิดแล้วเลือกคำขอจากรายการล่าสุดก่อนตัดสินใจ'}};
}

export function decisionAllowed(dialog:DecisionDialog):boolean {
  return dialog.freshness === 'current' && (dialog.decision === 'SUSPEND'
    ? dialog.application.status === 'APPROVED' : dialog.application.status === 'PENDING');
}

export function decisionRetained(dialog:DecisionDialog|null):boolean {
  return !!dialog && (dialog.phase === 'submitting' || dialog.requestId !== null);
}

export function reduceApproval(state:ApprovalState, action:ApprovalAction): ApprovalState {
  switch (action.type) {
    case 'LIST_LOAD_REQUESTED':
      return {...state, listPhase:'loading', listSerial:state.listSerial + 1, notice:null};
    case 'STATUS_TAB_CHANGED':
      if (decisionRetained(state.dialog)) return state;
      return {
        ...state, filter:{status:action.status, page:1, pageSize:state.filter.pageSize},
        listPhase:'loading', list:null, listSerial:state.listSerial + 1, notice:null, dialog:null,
      };
    case 'LIST_PAGE_CHANGED': {
      if (decisionRetained(state.dialog)) return state;
      const page = Math.max(1, Math.floor(action.page));
      if (page === state.filter.page) return state;
      return {
        ...state, filter:{...state.filter, page},
        listPhase:'loading', list:null, listSerial:state.listSerial + 1, notice:null, dialog:null,
      };
    }
    case 'LIST_LOAD_SUCCEEDED': {
      // Out-of-order responses from an older query never land.
      if (action.serial !== state.listSerial) return state;
      return {
        ...state,
        listPhase:action.list.items.length === 0 ? 'empty' : 'ready',
        list:action.list,
        notice:null,
        dialog:refreshDialogApplication(state.dialog, action.list),
      };
    }
    case 'LIST_LOAD_FAILED': {
      if (action.serial !== state.listSerial) return state;
      return {
        ...state,
        listPhase:action.kind,
        list:action.kind === 'unavailable' ? state.list : null,
        dialog:action.kind === 'unavailable' ? state.dialog : null,
        notice:action.kind === 'unauthenticated'
          ? {kind:'error', text:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'}
          : action.kind === 'forbidden'
            ? {kind:'error', text:'คุณไม่มีสิทธิ์เข้าถึงรายการคำขอนี้'}
            : {kind:'error', text:'โหลดรายการคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'},
      };
    }
    case 'DECISION_DIALOG_OPENED':
      if (decisionRetained(state.dialog) || state.listPhase !== 'ready') return state;
      return {...state, dialog:openDialog(action.application, action.decision)};
    case 'DIALOG_FIELD_CHANGED': {
      if (!state.dialog || decisionRetained(state.dialog)) return state;
      let dialog = {...state.dialog};
      if (action.departmentId !== undefined) dialog.departmentId = action.departmentId;
      if (action.reason !== undefined) dialog.reason = action.reason;
      if (action.impactAcknowledged !== undefined) dialog.impactAcknowledged = action.impactAcknowledged;
      dialog = {...dialog, errors:clearFieldError(state.dialog.errors,
        action.departmentId !== undefined ? 'departmentId' : action.reason !== undefined ? 'reason' : 'impact',
      )};
      return {...state, dialog};
    }
    case 'DIALOG_VALIDATION_FAILED': {
      if (!state.dialog) return state;
      return {...state, dialog:{...state.dialog, errors:action.errors, phase:'confirm'}};
    }
    case 'DIALOG_SUBMIT_STARTED': {
      // Double-click guard: a submission already in flight keeps its request id.
      if (!state.dialog || state.dialog.phase === 'submitting' || !decisionAllowed(state.dialog)) return state;
      if (state.dialog.requestId && state.dialog.requestId !== action.requestId) return state;
      if (state.dialog.application.revision !== action.revision) return state;
      return {
        ...state,
        dialog:{...state.dialog, phase:'submitting', requestId:action.requestId, errors:null, notice:null},
      };
    }
    case 'DIALOG_SUBMIT_SUCCEEDED': {
      if (!state.dialog || state.dialog.requestId !== action.requestId) return state;
      return {
        ...state,
        dialog:null,
        notice:{kind:'success', text:'บันทึกการตัดสินใจแล้ว กำลังโหลดข้อมูลล่าสุด'},
        listPhase:'loading',
        listSerial:state.listSerial + 1,
      };
    }
    case 'DIALOG_SUBMIT_CONFLICT': {
      if (!state.dialog || state.dialog.requestId !== action.requestId) return state;
      return {
        ...state,
        dialog:{...state.dialog, phase:'conflict', requestId:null, freshness:'refreshing',
          notice:{kind:'conflict', text:'คำขอนี้ถูกปรับปรุงโดยผู้ดูแลอื่น กำลังโหลดข้อมูลล่าสุด โปรดตรวจทานก่อนตัดสินใจใหม่'}},
        // Keep the reviewer's draft; server truth reloads below without any
        // automated approve/retry.
        listPhase:'loading',
        listSerial:state.listSerial + 1,
      };
    }
    case 'DIALOG_SUBMIT_FAILED': {
      if (!state.dialog || state.dialog.requestId !== action.requestId) return state;
      if (action.kind === 'denied' || action.kind === 'unauthenticated' || action.kind === 'notFound') {
        return {...state, list:null, dialog:null, listSerial:state.listSerial + 1,
          listPhase:action.kind === 'unauthenticated' ? 'unauthenticated' : action.kind === 'denied' ? 'forbidden' : 'unavailable',
          notice:{kind:'error',text:action.kind === 'unauthenticated' ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'ไม่สามารถเข้าถึงคำขอนี้แล้ว กรุณาโหลดรายการใหม่'}};
      }
      const isUncertain = action.kind === 'uncertain';
      return {
        ...state,
        dialog:{...state.dialog, phase:'confirm',
          requestId:isUncertain ? state.dialog.requestId : null,
          notice:{kind:isUncertain ? 'uncertain' : 'error',
            text:isUncertain
              ? 'ยังยืนยันผลการบันทึกไม่ได้ กำลังใช้คำขอเดิมเมื่อกดส่งซ้ำ'
              : 'ระบบปฏิเสธการตัดสินใจนี้ กรุณาตรวจสอบข้อมูลล่าสุด'}},
      };
    }
    case 'DIALOG_CLOSED':
      if (decisionRetained(state.dialog)) return state;
      return {...state, dialog:null};
    case 'SESSION_CLEARED':
      return initialApprovalState();
    default:
      return state;
  }
}
