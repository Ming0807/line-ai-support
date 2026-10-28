'use client';

import { useEffect, useReducer, useRef, type Dispatch } from 'react';
import {
  initialApprovalState, reduceApproval, loadApplications, decideApplication,
  suspendApplication, validateDecisionForm, activeRequestId,
  decisionAllowed, decisionRetained,
  type ApprovalsStatusFilter, type DecisionKind, type DecisionFormErrors, type ApprovalAction, type DecisionDialog,
} from './applications-controller';
import {formatThaiStamp} from '../../staff/application/status-controller';
import type {StaffApplicationItem} from '@/types/staff-applications';

const STATUS_LABELS: Record<StaffApplicationItem['status'], {label:string; tone:string}> = {
  PENDING:{label:'อยู่ระหว่างพิจารณา', tone:'pending'},
  APPROVED:{label:'อนุมัติแล้ว', tone:'approved'},
  REJECTED:{label:'ไม่อนุมัติ', tone:'rejected'},
  SUSPENDED:{label:'ระงับการใช้งาน', tone:'suspended'},
};

const TAB_LABELS: Record<ApprovalsStatusFilter, string> = {
  PENDING:'รออนุมัติ', APPROVED:'อนุมัติแล้ว', REJECTED:'ไม่อนุมัติ', SUSPENDED:'ระงับการใช้งาน',
};

const TAB_ORDER: ApprovalsStatusFilter[] = ['PENDING','APPROVED','REJECTED','SUSPENDED'];

const DECISION_CONSENT: Record<DecisionKind, string> = {
  APPROVE:'การอนุมัติส่งมอบสิทธิ์ให้บัญชีนี้เข้าใช้งานตามฝ่ายสุดท้ายที่ยืนยัน สิทธิ์ไม่มาจากฝ่ายที่ผู้สมัครเลือกเอง',
  REJECT:'การไม่อนุมัติจบคำขอนี้ ผู้สมัครจะเห็นเหตุผลที่บันทึกไว้',
  SUSPEND:'การระงับหยุดการเข้าใช้งานของบัญชีนี้ทันที และเหตุผลจะถูกบันทึก',
};

export default function ApprovalsClient() {
  const [state, dispatch] = useReducer(reduceApproval, undefined, initialApprovalState);
  const drawerCloseRef = useRef<HTMLButtonElement|null>(null);
  const submitting = useRef(false);
  const dialogOpen = state.dialog !== null;

  useEffect(() => {
    let alive = true;
    const serial = state.listSerial;
    const filter = state.filter;
    void (async () => {
      const outcome = await loadApplications(fetch, filter);
      if (!alive) return;
      if (outcome.kind === 'ready') dispatch({type:'LIST_LOAD_SUCCEEDED', serial, list:outcome.list});
      else dispatch({type:'LIST_LOAD_FAILED', serial, kind:outcome.kind});
    })();
    return () => { alive = false; };
  }, [state.filter, state.listSerial]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [dialogOpen]);

  async function submitDecision() {
    const dialog = state.dialog;
    if (!dialog || dialog.phase === 'submitting' || !decisionAllowed(dialog) || submitting.current) return;
    const errors:DecisionFormErrors = validateDecisionForm(
      dialog.decision,
      {departmentId:dialog.departmentId, reason:dialog.reason},
      dialog.impactAcknowledged,
    );
    if (errors && Object.keys(errors).length > 0) {
      dispatch({type:'DIALOG_VALIDATION_FAILED', errors});
      return;
    }
    const revision = dialog.application.revision;
    // Reuse the retained id after uncertain outcomes; conflicts start a fresh id.
    const requestId = activeRequestId(state) ?? crypto.randomUUID();
    submitting.current = true;
    dispatch({
      type:'DIALOG_SUBMIT_STARTED', requestId, revision,
      command:dialog.decision === 'APPROVE'
        ? {kind:'APPROVE', departmentId:dialog.departmentId}
        : {kind:dialog.decision, reason:dialog.reason},
    });
    const outcome = await (async () => { try { return dialog.decision === 'SUSPEND'
      ? await suspendApplication(fetch, dialog.application.id, dialog.reason, revision, requestId)
      : await decideApplication(fetch, dialog.application.id,
          dialog.decision === 'APPROVE'
            ? {kind:'APPROVE', departmentId:dialog.departmentId}
            : {kind:'REJECT', reason:dialog.reason},
          revision, requestId);
    } finally { submitting.current = false; } })();
    switch (outcome.kind) {
      case 'updated': dispatch({type:'DIALOG_SUBMIT_SUCCEEDED', requestId, item:outcome.item}); break;
      case 'conflict': dispatch({type:'DIALOG_SUBMIT_CONFLICT', requestId}); break;
      case 'uncertain': dispatch({type:'DIALOG_SUBMIT_FAILED', requestId, kind:'uncertain'}); break;
      case 'denied': dispatch({type:'DIALOG_SUBMIT_FAILED', requestId, kind:'denied'}); break;
      case 'unauthenticated': dispatch({type:'DIALOG_SUBMIT_FAILED', requestId, kind:'unauthenticated'}); break;
      case 'notFound': dispatch({type:'DIALOG_SUBMIT_FAILED', requestId, kind:'notFound'}); break;
      case 'invalid': dispatch({type:'DIALOG_SUBMIT_FAILED', requestId, kind:'invalid'}); break;
      default: return;
    }
  }

  const list = state.list;
  const pagination = list?.pagination ?? null;
  const dialog = state.dialog;
  const departments = list?.departments ?? [];

  return (
    <div className="staff-onboard-admin">
      <header className="staff-onboard-admin-heading">
        <div>
          <h1>คำขอเปิดบัญชีบุคลากร</h1>
          <p>ตรวจทานและตัดสินใจคำขอ — รายการ สถานะ และจำนวนทั้งหมดอ้างอิงจากเซิร์ฟเวอร์ ฝ่ายสุดท้ายต้องยืนยันเอง</p>
        </div>
        <button
          className="staff-onboard-row-button" type="button"
          onClick={() => dispatch({type:'LIST_LOAD_REQUESTED'})}
        >
          โหลดใหม่
        </button>
      </header>

      <nav className="staff-onboard-tabs" aria-label="กรองคำขอตามสถานะ">
        {TAB_ORDER.map(status => (
          <button
            key={status} type="button" className="staff-onboard-tab"
            aria-pressed={state.filter.status === status}
            onClick={() => dispatch({type:'STATUS_TAB_CHANGED', status})}
          >
            {TAB_LABELS[status]}
          </button>
        ))}
      </nav>

      {state.notice && state.listPhase !== 'ready' && (
        <p className="staff-onboard-notice" role="alert" data-tone={state.notice.kind}>{state.notice.text}</p>
      )}

      {state.listPhase === 'unauthenticated' && (
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button" href="/login">เข้าสู่ระบบ</a>
        </div>
      )}

      {(state.listPhase === 'unavailable' || state.listPhase === 'forbidden') && (
        <div className="staff-onboard-actions">
          {state.listPhase === 'unavailable' && (
            <button className="staff-onboard-button" type="button" onClick={() => dispatch({type:'LIST_LOAD_REQUESTED'})}>ลองใหม่</button>
          )}
        </div>
      )}

      <section className="staff-onboard-list staff-onboard-list-grid" aria-live="polite">
        <div className="staff-onboard-row staff-onboard-row-head" aria-hidden="true">
          <span>ผู้สมัคร</span>
          <span>ฝ่ายที่ขอ</span>
          <span>ฝ่ายที่อนุมัติ</span>
          <span>สถานะ</span>
          <span>การจัดการ</span>
        </div>
        {state.listPhase === 'loading' && !list && (
          <p className="staff-onboard-empty" role="status" aria-busy="true">กำลังโหลดรายการ…</p>
        )}
        {list?.items.map(application => (
          <ApplicationRow
            key={application.id}
            application={application}
            onOpen={decision => dispatch({type:'DECISION_DIALOG_OPENED', application, decision})}
          />
        ))}
        {list && list.items.length === 0 && state.listPhase !== 'loading' && (
          <p className="staff-onboard-empty">ไม่มีคำขอในสถานะนี้</p>
        )}
      </section>

      {pagination && (
        <div className="staff-onboard-pagination">
          <span className="staff-onboard-legend">
            หน้า {pagination.page} จาก {pagination.totalPages} · รวม {pagination.total} คำขอ (จากเซิร์ฟเวอร์)
          </span>
          <div className="staff-onboard-row-actions">
            <button
              className="staff-onboard-row-button" type="button"
              disabled={!pagination.hasPrevious}
              onClick={() => dispatch({type:'LIST_PAGE_CHANGED', page:pagination.page - 1})}
            >
              ก่อนหน้า
            </button>
            <button
              className="staff-onboard-row-button" type="button"
              disabled={!pagination.hasNext}
              onClick={() => dispatch({type:'LIST_PAGE_CHANGED', page:pagination.page + 1})}
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}

      {dialog && (
        <DecisionDrawer
          dialog={dialog}
          departments={departments}
          closeRef={drawerCloseRef}
          onClose={() => dispatch({type:'DIALOG_CLOSED'})}
          onField={dispatch}
          onSubmit={() => void submitDecision()}
        />
      )}
    </div>
  );
}

function ApplicationRow({application, onOpen}:{application:StaffApplicationItem; onOpen:(decision:DecisionKind)=>void}) {
  const chip = STATUS_LABELS[application.status];
  const pending = application.status === 'PENDING';
  const approved = application.status === 'APPROVED';
  return (
    <div className="staff-onboard-row">
      <div className="staff-onboard-row-main">
        <span className="staff-onboard-row-title">{application.applicantName}</span>
        <span className="staff-onboard-row-sub">รหัส {application.staffCode}</span>
      </div>
      <span className="staff-onboard-row-cell">{application.requestedDepartmentName}</span>
      <span className="staff-onboard-row-cell">{application.approvedDepartmentName ?? '—'}</span>
      <span className="staff-onboard-row-cell">
        <span className="staff-onboard-chip" data-tone={chip.tone}>{chip.label}</span>
      </span>
      <div className="staff-onboard-row-actions">
        {pending && (<>
          <button className="staff-onboard-row-button" type="button" onClick={() => onOpen('APPROVE')}>อนุมัติ</button>
          <button className="staff-onboard-row-button" type="button" onClick={() => onOpen('REJECT')}>ไม่อนุมัติ</button>
        </>)}
        {approved && (
          <button className="staff-onboard-row-button" type="button" onClick={() => onOpen('SUSPEND')}>ระงับ</button>
        )}
        {!(pending || approved) && (
          <button
            className="staff-onboard-row-button" type="button"
            onClick={() => onOpen(application.status === 'REJECTED' ? 'REJECT' : 'SUSPEND')}
          >
            เปิดรายละเอียด
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionDrawer({dialog, departments, closeRef, onClose, onField, onSubmit}:{
  dialog:DecisionDialog;
  departments:{id:string; name:string}[];
  closeRef:{current:HTMLButtonElement|null};
  onClose:() => void;
  onField:Dispatch<ApprovalAction>;
  onSubmit:() => void;
}) {
  const nativeDialog = useRef<HTMLDialogElement|null>(null);
  useEffect(() => {
    const element = nativeDialog.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    closeRef.current?.focus();
    return () => { element?.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, [closeRef]);
  const dialogDetail = dialog.application;
  const isApprove = dialog.decision === 'APPROVE';
  const retained = decisionRetained(dialog);
  const canDecide = decisionAllowed(dialog);
  const readOnly = dialog.decision === 'SUSPEND' ? dialogDetail.status !== 'APPROVED' : dialogDetail.status !== 'PENDING';
  const missingDepartment = isApprove
    && dialog.departmentId !== ''
    && !departments.some(department => department.id === dialog.departmentId);

  return (
    <>
      <dialog ref={nativeDialog}
        className="staff-onboard-drawer" role="dialog" aria-modal="true"
        aria-labelledby="staff-onboard-drawer-title"
        onCancel={event => { event.preventDefault(); onClose(); }}
      >
        <div className="staff-onboard-drawer-heading">
          <h2 id="staff-onboard-drawer-title">
            {dialog.phase === 'conflict'
              ? 'ข้อมูลเปลี่ยนแปลง โปรดตรวจทานแล้วตัดสินใจใหม่'
              : dialog.phase === 'submitting'
                ? 'กำลังบันทึกการตัดสินใจ…'
                : readOnly ? 'รายละเอียดคำขอ' : 'ตรวจทานคำขอและยืนยัน'}
          </h2>
          <button ref={closeRef} disabled={retained} className="staff-onboard-drawer-close" type="button" onClick={onClose} aria-label="ปิดหน้าต่างนี้">×</button>
        </div>

        <section className="staff-onboard-drawer-section">
          <dl className="staff-onboard-definition">
            <dt>ชื่อผู้สมัคร</dt>
            <dd>{dialogDetail.applicantName}</dd>
            <dt>รหัสบุคลากร</dt>
            <dd>{dialogDetail.staffCode}</dd>
            <dt>{dialog.freshness === 'current' ? 'สถานะปัจจุบัน' : 'สถานะจากข้อมูลก่อนโหลดใหม่'}</dt>
            <dd>
              <span className="staff-onboard-chip" data-tone={STATUS_LABELS[dialogDetail.status].tone}>
                {STATUS_LABELS[dialogDetail.status].label}
              </span>
            </dd>
            <dt>ฝ่ายที่ขอ</dt>
            <dd>{dialogDetail.requestedDepartmentName}</dd>
            {dialogDetail.approvedDepartmentName && (<><dt>ฝ่ายที่อนุมัติไว้</dt><dd>{dialogDetail.approvedDepartmentName}</dd></>)}
            <dt>ส่งเมื่อ</dt>
            <dd>{formatThaiStamp(dialogDetail.submittedAt) ?? dialogDetail.submittedAt}</dd>
            {dialogDetail.reviewedAt && (<><dt>ตรวจเมื่อ</dt><dd>{formatThaiStamp(dialogDetail.reviewedAt) ?? dialogDetail.reviewedAt}</dd></>)}
            {dialogDetail.reviewerName && (<><dt>ผู้ตรวจล่าสุด</dt><dd>{dialogDetail.reviewerName}</dd></>)}
            {dialogDetail.decisionReason && (<><dt>เหตุผลบันทึกล่าสุด</dt><dd>{dialogDetail.decisionReason}</dd></>)}
            <dt>เวอร์ชันข้อมูล</dt>
            <dd>revision {dialogDetail.revision}</dd>
          </dl>
        </section>

        <hr className="staff-onboard-divider" />

        {!readOnly && <section className="staff-onboard-drawer-section">
          {isApprove && (
            <>
              <h3>เลือกฝ่ายสุดท้ายที่จะอนุมัติ</h3>
              <label className="staff-onboard-field" htmlFor="staff-onboard-final-department">
                ฝ่ายสุดท้าย (ยืนยันโดยผู้ดูแล)
                <select
                  id="staff-onboard-final-department" required value={dialog.departmentId}
                  disabled={retained || !canDecide}
                  aria-describedby={dialog.errors?.departmentId ? 'staff-onboard-final-department-error' : undefined}
                  onChange={event => onField({type:'DIALOG_FIELD_CHANGED', departmentId:event.target.value})}
                >
                  <option value="">— โปรดเลือกฝ่าย —</option>
                  {missingDepartment && <option value={dialog.departmentId}>(ฝ่ายเดิมที่เลือกไว้ ไม่อยู่ในรายการล่าสุด)</option>}
                  {departments.map(department => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
                {dialog.errors?.departmentId && (
                  <p className="staff-onboard-field-error" id="staff-onboard-final-department-error">{dialog.errors.departmentId}</p>
                )}
              </label>
              <p className="staff-onboard-drawer-note">{DECISION_CONSENT.APPROVE}</p>
            </>
          )}
          {!isApprove && (
            <>
              <h3>{dialog.decision === 'REJECT' ? 'เหตุผลการไม่อนุมัติ' : 'เหตุผลการระงับการใช้งาน'}</h3>
              <label className="staff-onboard-field" htmlFor="staff-onboard-decision-reason">
                เหตุผล (ผู้สมัครและผู้ดูแลระบบจะเห็นข้อความนี้)
                <textarea
                  id="staff-onboard-decision-reason" required maxLength={2000}
                  value={dialog.reason} disabled={retained || !canDecide}
                  aria-describedby={dialog.errors?.reason ? 'staff-onboard-decision-reason-error' : undefined}
                  onChange={event => onField({type:'DIALOG_FIELD_CHANGED', reason:event.target.value})}
                />
                {dialog.errors?.reason && (
                  <p className="staff-onboard-field-error" id="staff-onboard-decision-reason-error">{dialog.errors.reason}</p>
                )}
              </label>
              {dialog.decision === 'SUSPEND' && (
                <label className="staff-onboard-check" htmlFor="staff-onboard-suspend-impact">
                  <input
                    id="staff-onboard-suspend-impact" type="checkbox"
                    checked={dialog.impactAcknowledged} disabled={retained || !canDecide}
                    aria-describedby={dialog.errors?.impact ? 'staff-onboard-suspend-impact-error' : undefined}
                    onChange={event => onField({type:'DIALOG_FIELD_CHANGED', impactAcknowledged:event.target.checked})}
                  />
                  <span>ยืนยัน: เข้าใจผลกระทบว่าบัญชีนี้จะหยุดเข้าใช้งานทันที และงานที่รับผิดชอบอยู่อาจต้องย้ายผู้รับผิดชอบ</span>
                  {dialog.errors?.impact && (
                    <p className="staff-onboard-field-error" id="staff-onboard-suspend-impact-error">{dialog.errors.impact}</p>
                  )}
                </label>
              )}
              <p className="staff-onboard-drawer-note">{DECISION_CONSENT[dialog.decision]}</p>
            </>
          )}
        </section>}

        {dialog.notice && (
          <p className="staff-onboard-notice" role="alert" data-tone={dialog.notice.kind}>{dialog.notice.text}</p>
        )}

        <div className="staff-onboard-actions">
          {canDecide && <button
            className="staff-onboard-button" type="button" onClick={onSubmit}
            disabled={dialog.phase === 'submitting'} aria-busy={dialog.phase === 'submitting'}
          >
            {dialog.phase === 'submitting'
              ? 'กำลังบันทึก…'
              : dialog.decision === 'APPROVE'
                ? 'ยืนยันอนุมัติ'
                : dialog.decision === 'REJECT'
                  ? 'ยืนยันไม่อนุมัติ'
                  : 'ยืนยันการระงับ'}
          </button>}
          <button className="staff-onboard-button staff-onboard-button-secondary" type="button" onClick={onClose} disabled={retained}>
            ปิดหน้าต่าง
          </button>
        </div>
        <p className="staff-onboard-drawer-note">
          หากเกิดการเปลี่ยนแปลงพร้อมกัน ระบบจะไม่บันทึกแทนคุณ — กรุณาตรวจทานข้อมูลล่าสุดแล้วยืนยันอีกครั้ง
        </p>
      </dialog>
    </>
  );
}
