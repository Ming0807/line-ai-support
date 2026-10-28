'use client';

import { useCallback, useEffect, useState } from 'react';
import {loadOnboardingContext, DASHBOARD_URL, LOGIN_PAGE_URL, LINE_LOGIN_APPLICATION_URL, LINE_LINK_EXISTING_URL} from '../apply/onboarding-controller';
import {resolveStatusView, formatThaiStamp, statusLabel, type StatusPhase} from './status-controller';

const STATUS_TONES: Record<'pending'|'approved'|'rejected'|'suspended', 'pending'|'approved'|'rejected'|'suspended'> = {
  pending:'pending', approved:'approved', rejected:'rejected', suspended:'suspended',
};

type StatusContext = Parameters<typeof resolveStatusView>[0];

export default function StatusClient() {
  const [context, setContext] = useState<StatusContext | null>(null);
  const [failed, setFailed] = useState<'unauthenticated'|'unavailable'|null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const outcome = await loadOnboardingContext(fetch);
    setLoading(false);
    if (outcome.kind === 'ready') setContext(outcome.context);
    else setFailed(outcome.kind);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const outcome = await loadOnboardingContext(fetch);
      if (!alive) return;
      setLoading(false);
      if (outcome.kind === 'ready') setContext(outcome.context);
      else setFailed(outcome.kind);
    })();
    return () => { alive = false; };
  }, [reload]);

  const phase: StatusPhase = context
    ? resolveStatusView(context, context.application).phase
    : failed === 'unauthenticated' ? 'login' : 'unavailable';
  const application = context?.application ?? null;

  return (
    <div className="staff-onboard-card">
      {loading && (<>
        <h1 className="staff-onboard-h1">สถานะคำขอใช้งาน</h1>
        <p className="staff-onboard-notice" data-tone="info" role="status" aria-busy="true">กำลังโหลดสถานะล่าสุด…</p>
      </>)}

      {!loading && phase === 'unavailable' && (<>
        <h1 className="staff-onboard-h1">โหลดสถานะไม่สำเร็จ</h1>
        <p className="staff-onboard-lead">บริการสมัครยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง</p>
        <div className="staff-onboard-actions">
          <button className="staff-onboard-button" type="button" onClick={() => void reload()}>ลองโหลดใหม่</button>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
        </div>
      </>)}

      {!loading && phase === 'login' && (<>
        <h1 className="staff-onboard-h1">ต้องเข้าสู่ระบบเพื่อดูสถานะ</h1>
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button" href={LINE_LOGIN_APPLICATION_URL}>เข้าสู่ระบบด้วย LINE</a>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>เข้าสู่ระบบด้วยบัญชีบุคลากร</a>
        </div>
      </>)}

      {!loading && phase === 'linkLine' && (<>
        <h1 className="staff-onboard-h1">บัญชีของคุณยังไม่ได้ผูกกับ LINE</h1>
        <p className="staff-onboard-lead">
          ระบบไม่เดาบัญชีจากชื่อหรืออีเมล โปรดผูกบัญชีผ่าน LINE ก่อนตรวจสอบสถานะ
        </p>
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button" href={LINE_LINK_EXISTING_URL}>ผูกบัญชีนี้กับ LINE</a>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
        </div>
      </>)}

      {!loading && phase === 'noApplication' && (<>
        <h1 className="staff-onboard-h1">ยังไม่มีคำขอการใช้งาน</h1>
        <p className="staff-onboard-lead">บัญชีของคุณผูก LINE แล้ว แต่ยังไม่มีคำขอในระบบ</p>
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button" href="/staff/apply">ไปหน้าสมัคร</a>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
        </div>
      </>)}

      {!loading && phase === 'alreadyStaff' && (<>
        <h1 className="staff-onboard-h1">บัญชีของคุณเปิดใช้งานแล้ว</h1>
        <p className="staff-onboard-lead">สิทธิ์การทำงานของคุณจัดการโดยผู้ดูแลระบบ</p>
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button" href={DASHBOARD_URL}>เปิดหน้างานของฉัน</a>
        </div>
      </>)}

      {!loading && application && (phase === 'pending' || phase === 'approved' || phase === 'rejected' || phase === 'suspended') && (<>
        <p className="staff-onboard-eyebrow">สถานะคำขอใช้งานบุคลากร</p>
        <h1 className="staff-onboard-h1">
          <span className="staff-onboard-chip" data-tone={STATUS_TONES[phase as 'pending'|'approved'|'rejected'|'suspended']}>
            {statusLabel(phase)}
          </span>
        </h1>
        {application.status === 'PENDING' && (
          <p className="staff-onboard-lead">
            อยู่ระหว่างการพิจารณาโดยผู้ดูแลระบบ คุณไม่ต้องยื่นคำขอใหม่ โปรดกลับมาตรวจสอบหน้านี้ภายหลัง
          </p>
        )}
        {application.status === 'APPROVED' && (
          <p className="staff-onboard-lead">
            คำขอของคุณได้รับการอนุมัติ หากยังเข้าใช้งานไม่ได้ โปรดเข้าสู่ระบบแล้วเปิดหน้างานของฉัน
          </p>
        )}
        {application.status === 'REJECTED' && (
          <p className="staff-onboard-lead">
            คำขอนี้ไม่ได้รับการอนุมัติ หากเห็นว่าข้อมูลไม่ถูกต้อง โปรดติดต่อผู้ดูแลระบบของหน่วยงาน
          </p>
        )}
        {application.status === 'SUSPENDED' && (
          <p className="staff-onboard-lead">
            บัญชีนี้ถูกระงับการใช้งานชั่วคราว โปรดติดต่อผู้ดูแลระบบของหน่วยงานเพื่อทบทวน
          </p>
        )}
        <div className="staff-onboard-definition">
          <dt>ฝ่ายที่ขอ</dt>
          <dd>{application.requestedDepartmentName}</dd>
          {application.approvedDepartmentName && (<><dt>ฝ่ายที่อนุมัติ</dt><dd>{application.approvedDepartmentName}</dd></>)}
          <dt>ส่งเมื่อ</dt>
          <dd>{formatThaiStamp(application.submittedAt) ?? application.submittedAt}</dd>
          {application.reviewedAt && (<>
            <dt>ตรวจเมื่อ</dt>
            <dd>{formatThaiStamp(application.reviewedAt) ?? application.reviewedAt}</dd>
          </>)}
          {application.reviewerName && (<><dt>ผู้ตรวจ</dt><dd>{application.reviewerName}</dd></>)}
          {application.decisionReason && (<><dt>เหตุผลที่บันทึก</dt><dd>{application.decisionReason}</dd></>)}
        </div>
        <div className="staff-onboard-actions">
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LOGIN_PAGE_URL}>กลับหน้าเข้าสู่ระบบ</a>
          {application.status === 'APPROVED' && (
            <a className="staff-onboard-button" href={DASHBOARD_URL}>เปิดหน้างานของฉัน</a>
          )}
        </div>
      </>)}
    </div>
  );
}
