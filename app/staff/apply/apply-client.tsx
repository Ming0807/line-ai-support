'use client';

import { useCallback, useEffect, useReducer, useRef, type FormEvent } from 'react';
import Link from 'next/link';
import {
  initialOnboardingState, reduceOnboarding, loadOnboardingContext, submitApplicationDraft,
  validateApplicationDraft, retryRequestId,
  LOGIN_PAGE_URL, STATUS_PAGE_URL, DASHBOARD_URL,
  LINE_LOGIN_APPLICATION_URL, LINE_LINK_EXISTING_URL,
} from './onboarding-controller';
import {formatThaiStamp} from '../application/status-controller';
import type {ApplyPhase} from './onboarding-controller';

const STATUS_LABELS: Record<string, {label:string; tone:'pending'|'approved'|'rejected'|'suspended'}> = {
  PENDING:{label:'อยู่ระหว่างพิจารณา', tone:'pending'},
  APPROVED:{label:'อนุมัติแล้ว', tone:'approved'},
  REJECTED:{label:'ไม่อนุมัติ', tone:'rejected'},
  SUSPENDED:{label:'ระงับการใช้งาน', tone:'suspended'},
};

function noticeTone(kind:'error'|'conflict'|'uncertain'|'success'|'info') {
  switch (kind) {
    case 'error': return 'error';
    case 'conflict': return 'conflict';
    case 'uncertain': return 'uncertain';
    case 'success': return 'success';
    default: return 'info';
  }
}

export default function ApplyClient() {
  const [state, dispatch] = useReducer(reduceOnboarding, undefined, initialOnboardingState);

  const reloadContext = useCallback(async () => {
    const outcome = await loadOnboardingContext(fetch);
    if (outcome.kind === 'ready') dispatch({type:'CONTEXT_LOAD_SUCCEEDED', context:outcome.context});
    else dispatch({type:'CONTEXT_LOAD_FAILED', kind:outcome.kind});
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const outcome = await loadOnboardingContext(fetch);
      if (!alive) return;
      if (outcome.kind === 'ready') dispatch({type:'CONTEXT_LOAD_SUCCEEDED', context:outcome.context});
      else dispatch({type:'CONTEXT_LOAD_FAILED', kind:outcome.kind});
    })();
    return () => { alive = false; };
  }, [reloadContext]);

  // After a 409 the server told us an application already exists: refresh server
  // state into the view. The applicant's draft must stay intact while reloading.
  useEffect(() => {
    if (!state.conflict) return;
    void reloadContext();
  }, [state.conflict, reloadContext]);

  // Synchronous submit guard: React state flips only after a re-render, so a same-tick
  // double activation must not mint two requests (one POST, one requestId).
  const submittingRef = useRef(false);

  async function handleSubmit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.phase !== 'form' || state.submitting || submittingRef.current) return;
    const errors = validateApplicationDraft(
      state.draft,
      state.context?.departments ?? [],
    );
    if (Object.keys(errors).length > 0) {
      dispatch({type:'SUBMITTED_WITH_VALIDATION_ERRORS', errors});
      return;
    }
    // Reuse the retained request id after uncertain outcomes so a duplicate
    // submit never creates a second request.
    const requestId = retryRequestId(state) ?? crypto.randomUUID();
    dispatch({type:'SUBMIT_STARTED', requestId});
    submittingRef.current = true;
    try {
      const outcome = await submitApplicationDraft(fetch, requestId, state.draft);
      switch (outcome.kind) {
        case 'submitted': dispatch({type:'SUBMIT_SUCCEEDED', application:outcome.application}); break;
        case 'conflict': dispatch({type:'SUBMIT_CONFLICT'}); break;
        case 'uncertain': dispatch({type:'SUBMIT_UNCERTAIN'}); break;
        case 'unauthenticated': dispatch({type:'CONTEXT_LOAD_FAILED', kind:'unauthenticated'}); break;
        case 'invalid': dispatch({type:'SUBMIT_FAILED_VALIDATION', message:outcome.message}); break;
        default: break;
      }
    } finally {
      submittingRef.current = false;
    }
  }

  const phase:ApplyPhase = state.phase;
  const notice = state.notice;

  return (
    <div className="staff-onboard-card">
      {phase === 'loading' && (<>
        <h1 className="staff-onboard-h1">สมัครใช้งานระบบงานบริการ</h1>
        <p className="staff-onboard-notice" data-tone="info" role="status" aria-busy="true">กำลังตรวจสอบสถานะการเข้าใช้งาน…</p>
      </>)}

      {phase === 'unavailable' && (<>
        <h1 className="staff-onboard-h1">ไม่สามารถเปิดหน้าสมัครได้ในขณะนี้</h1>
        {/* OP06-11: unavailable keeps the exact standing copy for load failures;
            an approved application waiting for activation shows its honest manual
            review reason carried by the controller notice instead. */}
        <p className="staff-onboard-lead">{state.notice?.text ?? 'บริการสมัครยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง'}</p>
        <div className="staff-onboard-actions">
          <button className="staff-onboard-button" type="button" onClick={() => void reloadContext()}>ลองโหลดใหม่</button>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
        </div>
      </>)}

      {phase === 'login' && (() => {
        // OP06-11: LINE staff login may be unconfigured (loginAvailable:false).
        // The LINE affordance only appears when the server says it is available;
        // a missing context (the bare-401 fallback) keeps both honest entry points.
        const lineConfigured = state.context?.loginAvailable !== false;
        return lineConfigured ? (
          <>
            <p className="staff-onboard-eyebrow">ผู้ใช้ใหม่ / ผูกบัญชีเดิม</p>
            <h1 className="staff-onboard-h1">ต้องเข้าสู่ระบบก่อนยื่นคำขอ</h1>
            <p className="staff-onboard-lead">
              <strong>LINE ใช้เพื่อยืนยันตัวตนเท่านั้น</strong> สิทธิ์การใช้งานระบบต้องได้รับการอนุมัติจากผู้ดูแลระบบก่อน
            </p>
            <div className="staff-onboard-actions">
              <a className="staff-onboard-button" href={LINE_LOGIN_APPLICATION_URL}>เข้าสู่ระบบด้วย LINE เพื่อสมัคร</a>
              <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>เข้าสู่ระบบด้วยบัญชีบุคลากร</a>
            </div>
          </>
        ) : (
          <>
            <p className="staff-onboard-eyebrow">ผู้ใช้ใหม่ / ผูกบัญชีเดิม</p>
            <h1 className="staff-onboard-h1">ยังเข้าสู่ระบบด้วย LINE เพื่อสมัครไม่ได้</h1>
            <p className="staff-onboard-lead">
              ระบบยังไม่เปิดใช้การเข้าสู่ระบบด้วย LINE จึงยังยื่นคำขอออนไลน์ไม่ได้ในขณะนี้
              บุคลากรที่มีบัญชีอยู่แล้วเข้าสู่ระบบด้วยบัญชีบุคลากรได้ตามปกติ หรือกลับมาตรวจสอบอีกครั้งภายหลัง
            </p>
            <div className="staff-onboard-actions">
              <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>เข้าสู่ระบบด้วยบัญชีบุคลากร</a>
            </div>
          </>
        );
      })()}

      {phase === 'linkLine' && (() => {
        // OP06-11: without a configured LINE staff login, no LINE link is offered
        // — the system never fakes an OAuth entry that does not exist.
        const lineConfigured = state.context?.loginAvailable !== false;
        return lineConfigured ? (
          <>
            <p className="staff-onboard-eyebrow">ผูกบัญชีเดิมกับ LINE</p>
            <h1 className="staff-onboard-h1">บัญชีของคุณยังไม่ได้ผูกกับ LINE</h1>
            <p className="staff-onboard-lead">
              หน้านี้ใช้สำหรับบัญชีบุคลากรที่มีอยู่แล้ว การผูกจะไปยัง LINE เองโดยระบบไม่สร้างข้อมูลใหม่
              และไม่เดาข้อมูลจากชื่อหรืออีเมล
            </p>
            <div className="staff-onboard-actions">
              <a className="staff-onboard-button" href={LINE_LINK_EXISTING_URL}>ผูกบัญชีนี้กับ LINE</a>
              <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
            </div>
          </>
        ) : (
          <>
            <p className="staff-onboard-eyebrow">ผูกบัญชีเดิมกับ LINE</p>
            <h1 className="staff-onboard-h1">ระบบยังเชื่อมต่อ LINE ไม่พร้อม จึงผูกบัญชีไม่ได้</h1>
            <p className="staff-onboard-lead">
              ระบบยังไม่เปิดใช้การเข้าสู่ระบบด้วย LINE จึงยังผูกบัญชีไม่ได้ในขณะนี้
              และไม่สร้างหรือเดาข้อมูลแทนบัญชีของคุณ โปรดกลับมาตรวจสอบอีกครั้งภายหลัง
            </p>
            <div className="staff-onboard-actions">
              <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
            </div>
          </>
        );
      })()}

      {phase === 'form' && (
        <form className="staff-onboard-fields" onSubmit={handleSubmit} noValidate>
          <p className="staff-onboard-eyebrow">ยื่นคำขอการใช้งาน</p>
          <h1 className="staff-onboard-h1">สมัครใช้งานระบบงานบริการ</h1>
          <p className="staff-onboard-lead">
            กรอกเพียง 3 ช่อง — สิทธิ์การทำงานจะมาจากฝ่ายที่ผู้ดูแลระบบอนุมัติให้ ไม่ใช่จากฟอร์มนี้
          </p>
          <label className="staff-onboard-field" htmlFor="staff-onboard-name">
            ชื่อจริงและนามสกุล
            <input
              disabled={state.requestId !== null}
              id="staff-onboard-name" name="applicantName" type="text" autoComplete="name"
              maxLength={120} required value={state.draft.applicantName}
              aria-describedby={state.errors?.applicantName ? 'staff-onboard-name-error' : undefined}
              onChange={event => dispatch({type:'DRAFT_FIELD_CHANGED', field:'applicantName', value:event.target.value})}
            />
            {state.errors?.applicantName && (
              <p className="staff-onboard-field-error" id="staff-onboard-name-error">{state.errors.applicantName}</p>
            )}
          </label>
          <label className="staff-onboard-field" htmlFor="staff-onboard-code">
            รหัสบุคลากร
            <input
              disabled={state.requestId !== null}
              id="staff-onboard-code" name="staffCode" type="text" autoComplete="off"
              maxLength={64} required value={state.draft.staffCode}
              aria-describedby={state.errors?.staffCode ? 'staff-onboard-code-error' : undefined}
              onChange={event => dispatch({type:'DRAFT_FIELD_CHANGED', field:'staffCode', value:event.target.value})}
            />
            {state.errors?.staffCode && (
              <p className="staff-onboard-field-error" id="staff-onboard-code-error">{state.errors.staffCode}</p>
            )}
          </label>
          <label className="staff-onboard-field" htmlFor="staff-onboard-department">
            ฝ่ายที่ขอทำงาน
            <select
              disabled={state.requestId !== null}
              id="staff-onboard-department" name="departmentId" required value={state.draft.departmentId}
              aria-describedby={state.errors?.departmentId ? 'staff-onboard-department-error' : undefined}
              onChange={event => dispatch({type:'DRAFT_FIELD_CHANGED', field:'departmentId', value:event.target.value})}
            >
              <option value="">— โปรดเลือกจากรายการ —</option>
              {(state.context?.departments ?? []).map(department => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            {state.errors?.departmentId && (
              <p className="staff-onboard-field-error" id="staff-onboard-department-error">{state.errors.departmentId}</p>
            )}
          </label>
          {notice && (
            <p className="staff-onboard-notice" role={notice.kind === 'error' || notice.kind === 'conflict' ? 'alert' : 'status'} data-tone={noticeTone(notice.kind)}>
              {notice.text}
            </p>
          )}
          <div className="staff-onboard-actions">
            <button className="staff-onboard-button" type="submit" disabled={state.submitting} aria-busy={state.submitting}>
              {state.submitting
                ? 'กำลังส่งคำขอ…'
                : state.notice?.kind === 'uncertain'
                  ? 'ส่งใหม่ (ใช้คำขอเดิม)'
                  : 'ยื่นคำขอ'}
            </button>
            <Link className="staff-onboard-button-quiet" href="/">กลับหน้าหลัก</Link>
          </div>
        </form>
      )}

      {phase === 'recorded' && (() => {
        const application = state.context?.application ?? null;
        const chip = application ? STATUS_LABELS[application.status] : null;
        return (
          <>
            <p className="staff-onboard-eyebrow">สถานะคำขอของคุณ</p>
            <h1 className="staff-onboard-h1">คำขอของคุณอยู่ในระบบแล้ว</h1>
            <div className="staff-onboard-definition">
              <dt>สถานะ</dt>
              <dd>
                <span className="staff-onboard-chip" data-tone={chip?.tone ?? 'unknown'}>
                  {chip?.label ?? 'ไม่ทราบสถานะ'}
                </span>
              </dd>
              <dt>ส่งเมื่อ</dt>
              <dd>{formatThaiStamp(application?.submittedAt ?? null) ?? '—'}</dd>
              {application?.status === 'PENDING' && (<><dt>ขั้นตอนต่อไป</dt><dd>อยู่ระหว่างการพิจารณาโดยผู้ดูแลระบบ ไม่ต้องยื่นซ้ำ</dd></>)}
              {/* OP06-11: terminal outcomes stay fixed and truthful — no reapply
                  in V1 and no automatic reactivation; server-provided reviewer
                  facts are shown as saved, never invented. */}
              {application?.status === 'REJECTED' && (
                <><dt>ขั้นตอนต่อไป</dt><dd>คำขอนี้ไม่ได้รับการอนุมัติ ไม่สามารถยื่นซ้ำได้ในช่วงนี้ และจะไม่ถูกเปิดใช้งานอัตโนมัติ หากเห็นว่าข้อมูลไม่ถูกต้อง โปรดติดต่อผู้ดูแลระบบของหน่วยงาน</dd></>
              )}
              {application?.status === 'SUSPENDED' && (
                <><dt>ขั้นตอนต่อไป</dt><dd>การใช้งานถูกระงับ ระบบจะไม่เปิดใช้งานอัตโนมัติ โปรดติดต่อผู้ดูแลระบบของหน่วยงานเพื่อทบทวน</dd></>
              )}
              {application?.reviewerName && (<><dt>ผู้พิจารณา</dt><dd>{application.reviewerName}</dd></>)}
              {application?.decisionReason && (<><dt>เหตุผลที่บันทึก</dt><dd>{application.decisionReason}</dd></>)}
            </div>
            {notice && (
              <p className="staff-onboard-notice" role="status" data-tone={noticeTone(notice.kind)}>{notice.text}</p>
            )}
            <div className="staff-onboard-actions">
              <a className="staff-onboard-button" href={STATUS_PAGE_URL}>ดูสถานะคำขอแบบเต็ม</a>
              <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
            </div>
          </>
        );
      })()}

      {phase === 'alreadyStaff' && (<>
        <p className="staff-onboard-eyebrow">บัญชีใช้งานอยู่แล้ว</p>
        <h1 className="staff-onboard-h1">บัญชีของคุณเป็นบุคลากรที่เปิดใช้งานแล้ว</h1>
        <p className="staff-onboard-lead">
          สิทธิ์ของคุณจัดการโดยผู้ดูแลระบบ หากเห็นว่าข้อมูลของคุณไม่ถูกต้อง โปรดติดต่อผู้ดูแลของฝ่ายคุณ
        </p>
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button" href={DASHBOARD_URL}>เปิดหน้างานของฉัน</a>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
        </div>
      </>)}
    </div>
  );
}
