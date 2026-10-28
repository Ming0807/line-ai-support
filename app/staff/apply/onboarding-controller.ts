/**
 * Controller for the private staff onboarding flow (apply form + context gate).
 *
 * The production adapter is fetch against the documented API contract:
 *   GET  /api/staff/onboarding -> StaffApplicationContext (401 = not logged in; 503 = unavailable)
 *   POST /api/staff/applications (JSON SubmitStaffApplication) -> StaffApplicationItem
 *
 * All model changes run through pure reducers so the tests can drive real
 * behavior (request-id retention, 409 draft preservation, gating) in Node.
 */
import type {StaffApplicationContext,StaffApplicationItem,SubmitStaffApplication} from '@/types/staff-applications';
import {LINE_LINK_EXISTING_URL,LINE_LOGIN_APPLICATION_URL} from '../../login/line-login-entry';

const ONBOARDING_CONTEXT_API = '/api/staff/onboarding';
const APPLICATIONS_API = '/api/staff/applications';

export const LOGIN_PAGE_URL = '/login';
export const STATUS_PAGE_URL = '/staff/application';
export const DASHBOARD_URL = '/dashboard';
export {LINE_LOGIN_APPLICATION_URL, LINE_LINK_EXISTING_URL};

export type OnboardingNotice = {kind:'error'|'conflict'|'uncertain'|'success'|'info'; text:string};

export type ApplicationDraft = {applicantName:string; staffCode:string; departmentId:string};
export type ApplicationFieldErrors = {applicantName?:string; staffCode?:string; departmentId?:string};

export const emptyApplicationDraft: ApplicationDraft = {applicantName:'', staffCode:'', departmentId:''};

export type ApplyPhase = 'loading'|'unavailable'|'login'|'linkLine'|'form'|'recorded'|'alreadyStaff';

export type OnboardingState = {
  phase:ApplyPhase;
  context:StaffApplicationContext|null;
  draft:ApplicationDraft;
  errors:ApplicationFieldErrors|null;
  submitting:boolean;
  requestId:string|null;
  conflict:boolean;
  notice:OnboardingNotice|null;
};

export type OnboardingAction =
  | {type:'CONTEXT_LOAD_SUCCEEDED'; context:StaffApplicationContext}
  | {type:'CONTEXT_LOAD_FAILED'; kind:'unauthenticated'|'unavailable'}
  | {type:'DRAFT_FIELD_CHANGED'; field:keyof ApplicationDraft; value:string}
  | {type:'SUBMITTED_WITH_VALIDATION_ERRORS'; errors:ApplicationFieldErrors}
  | {type:'SUBMIT_STARTED'; requestId:string}
  | {type:'SUBMIT_SUCCEEDED'; application:StaffApplicationItem}
  | {type:'SUBMIT_FAILED_VALIDATION'; message:string}
  | {type:'SUBMIT_CONFLICT'}
  | {type:'SUBMIT_UNCERTAIN'}
  | {type:'SESSION_CLEARED'};

export function initialOnboardingState(): OnboardingState {
  return {
    phase:'loading', context:null, draft:{...emptyApplicationDraft}, errors:null,
    submitting:false, requestId:null, conflict:false, notice:null,
  };
}

/** The submit view stage implied by the current state (single source for tests and UI). */
export function resolveApplyPhase(state:OnboardingState): ApplyPhase {
  return state.phase;
}

function gateContextPhase(context:StaffApplicationContext): Exclude<ApplyPhase,'loading'> {
  if (!context.authenticated) return 'login';
  if (!context.lineLinked) return 'linkLine';
  if (context.staffActive) return 'alreadyStaff';
  if (context.application) return 'recorded';
  if (context.departments.length === 0) return 'unavailable';
  return 'form';
}

export function reduceOnboarding(state:OnboardingState, action:OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'CONTEXT_LOAD_SUCCEEDED': {
      const nextPhase = gateContextPhase(action.context);
      if (nextPhase === 'unavailable') {
        return {...state, phase:'unavailable', context:action.context, submitting:false, conflict:false,
          notice:{kind:'error', text:'ยังไม่มีรายชื่อฝ่ายสำหรับเลือก กรุณากลับมาทำการใหม่ภายหลัง'}};
      }
      return {
        ...state, phase:nextPhase, context:action.context, submitting:false, conflict:false, notice:null,
        // Draft survives a reload that returns to the form (e.g. after a 409 refresh);
        // it never survives a session reset or an explicit clear below.
      };
    }
    case 'CONTEXT_LOAD_FAILED':
      if (action.kind === 'unauthenticated') {
        return {...initialOnboardingState(), phase:'login', notice:{kind:'info', text:'กรุณาเข้าสู่ระบบก่อนยื่นคำขอ'}};
      }
      return {...state, phase:'unavailable', submitting:false,
        notice:{kind:'error', text:'บริการสมัครยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง'}};
    case 'DRAFT_FIELD_CHANGED': {
      if (state.phase !== 'form' || state.requestId) return state;
      const draft = {...state.draft, [action.field]:action.value};
      let errors = state.errors;
      if (errors && errors[action.field]) {
        const remaining = {...errors} as ApplicationFieldErrors;
        delete remaining[action.field];
        errors = remaining;
      }
      return {...state, draft, errors};
    }
    case 'SUBMITTED_WITH_VALIDATION_ERRORS': {
      if (state.phase !== 'form') return state;
      return {...state, errors:action.errors, submitting:false};
    }
    case 'SUBMIT_STARTED': {
      // Double submissions while in flight are ignored; the retained request id
      // (after an uncertain outcome) must be reused instead of replaced.
      if (state.phase !== 'form' || state.submitting) return state;
      if (state.requestId && state.requestId !== action.requestId) return state;
      return {...state, submitting:true, requestId:action.requestId, conflict:false, errors:null, notice:null};
    }
    case 'SUBMIT_SUCCEEDED': {
      if (!state.context) return state;
      return {
        ...state, phase:'recorded', submitting:false, requestId:null, conflict:false,
        context:{...state.context, application:action.application},
        notice:{kind:'success', text:'ส่งคำขอแล้ว รอการพิจารณาจากผู้ดูแลระบบ'},
      };
    }
    case 'SUBMIT_FAILED_VALIDATION': {
      if (state.phase !== 'form') return state;
      // Definitive reject: the request id is dropped, the retry gets a new one.
      return {...state, submitting:false, requestId:null, notice:{kind:'error', text:action.message}};
    }
    case 'SUBMIT_CONFLICT': {
      if (state.phase !== 'form') return state;
      // Conflicts are definitive for THIS attempt: keep the draft for review and
      // reload server state; a new attempt (if appropriate) gets a new request id.
      return {...state, submitting:false, requestId:null, conflict:true,
        notice:{kind:'conflict', text:'บัญชีนี้มีคำขออยู่ในระบบแล้ว กำลังโหลดสถานะล่าสุด กรุณาตรวจสอบก่อนทำการซ้ำ'}};
    }
    case 'SUBMIT_UNCERTAIN': {
      if (state.phase !== 'form') return state;
      // Outcome unknown (network/5xx): keep the same request id for idempotent retry.
      return {...state, submitting:false,
        notice:{kind:'uncertain', text:'ยังยืนยันผลการส่งไม่ได้ คำขอเดิมถูกเก็บไว้ กดส่งซ้ำเพื่อใช้คำขอเดิม'}};
    }
    case 'SESSION_CLEARED':
      return initialOnboardingState();
    default:
      return state;
  }
}

/** Request id to reuse on the next submit, if one was retained after an uncertain outcome. */
export function retryRequestId(state:OnboardingState): string|null {
  return state.requestId;
}

export function validateApplicationDraft(
  draft:ApplicationDraft,
  departments:readonly {id:string}[],
): ApplicationFieldErrors {
  const errors:ApplicationFieldErrors = {};
  const name = draft.applicantName.trim();
  if (!name) errors.applicantName = 'โปรดระบุชื่อจริงและนามสกุล';
  else if (name.length > 120) errors.applicantName = 'ชื่อยาวเกิน 120 อักขระ';
  const staffCode = draft.staffCode.trim();
  if (!staffCode) errors.staffCode = 'โปรดระบุรหัสบุคลากร';
  else if (staffCode.length > 64) errors.staffCode = 'รหัสบุคลากรยาวเกิน 64 อักขระ';
  if (!departments.some(department => department.id === draft.departmentId)) {
    errors.departmentId = 'โปรดเลือกฝ่ายจากรายการที่ระบบให้เท่านั้น';
  }
  return errors;
}

/** Exactly the four contract fields; nothing about roles, activation or permissions. */
export function buildApplicationSubmitBody(requestId:string, draft:ApplicationDraft): SubmitStaffApplication {
  return {
    applicantName:draft.applicantName.trim(),
    staffCode:draft.staffCode.trim(),
    departmentId:draft.departmentId,
    requestId,
  };
}

export type OnboardingContextOutcome =
  | {kind:'ready'; context:StaffApplicationContext}
  | {kind:'unauthenticated'}
  | {kind:'unavailable'};

type UnknownRecord = Record<string, unknown>;

function isContextShape(value:unknown): value is StaffApplicationContext {
  const candidate = value as Partial<StaffApplicationContext> | null;
  if (!candidate) return false;
  const departments = candidate.departments;
  return typeof candidate.authenticated === 'boolean'
    && typeof candidate.lineLinked === 'boolean'
    && typeof candidate.staffActive === 'boolean'
    && (candidate.application === null
      || (typeof candidate.application === 'object' && candidate.application !== null))
    && Array.isArray(departments)
    && departments.every(department => {
      const entry = department as Partial<{id:string; name:string}> | null;
      return typeof entry?.id === 'string' && typeof entry?.name === 'string';
    });
}

/** GET /api/staff/onboarding — injectable fetch for tests; production passes `fetch`. */
export async function loadOnboardingContext(fetchImpl:typeof fetch): Promise<OnboardingContextOutcome> {
  let response:Response;
  try {
    response = await fetchImpl(ONBOARDING_CONTEXT_API, {
      method:'GET', credentials:'same-origin', cache:'no-store',
      headers:{accept:'application/json'},
    });
  } catch {
    return {kind:'unavailable'};
  }
  if (response.status === 401) return {kind:'unauthenticated'};
  if (!response.ok) return {kind:'unavailable'};
  try {
    const parsed = JSON.parse(await response.text()) as UnknownRecord;
    return isContextShape(parsed) ? {kind:'ready', context:parsed} : {kind:'unavailable'};
  } catch {
    return {kind:'unavailable'};
  }
}

export type SubmitOutcome =
  | {kind:'submitted'; application:StaffApplicationItem}
  | {kind:'conflict'}
  | {kind:'invalid'; message:string}
  | {kind:'unauthenticated'}
  | {kind:'uncertain'};

function isItemShape(value:unknown): value is StaffApplicationItem {
  const candidate = value as Partial<StaffApplicationItem> | null;
  return !!candidate && typeof candidate.id === 'string' && typeof candidate.status === 'string';
}

/** POST /api/staff/applications — server resolves duplicates and permissions; never invents success. */
export async function submitApplicationDraft(
  fetchImpl:typeof fetch,
  requestId:string,
  draft:ApplicationDraft,
): Promise<SubmitOutcome> {
  let response:Response;
  try {
    response = await fetchImpl(APPLICATIONS_API, {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'content-type':'application/json', accept:'application/json'},
      body:JSON.stringify(buildApplicationSubmitBody(requestId, draft)),
    });
  } catch {
    return {kind:'uncertain'};
  }
  if (response.ok) {
    try {
      const parsed = JSON.parse(await response.text()) as UnknownRecord;
      if (isItemShape(parsed)) return {kind:'submitted', application:parsed};
    } catch {
      // fall through to uncertain: the write may have committed.
    }
    return {kind:'uncertain'};
  }
  if (response.status === 401) return {kind:'unauthenticated'};
  if (response.status === 409) return {kind:'conflict'};
  if (response.status >= 500) return {kind:'uncertain'};
  if (response.status === 404) return {kind:'invalid', message:'ไม่พบบริการสมัคร กรุณาลองใหม่ภายหลัง'};
  return {kind:'invalid', message:'ข้อมูลที่กรอกไม่เป็นที่ยอมรับ กรุณาตรวจสอบแล้วส่งใหม่อีกครั้ง'};
}
