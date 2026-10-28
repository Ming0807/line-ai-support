/**
 * Reusable LINE login entry for the existing login page. Root integration owns
 * where this renders; this file only offers fixed navigation targets and copy.
 * Never accept tokens, names, LINE identity or arbitrary next URLs in queries.
 */
export const LINE_LOGIN_APPLICATION_URL = '/auth/line?next=/staff/apply';
export const LINE_LINK_EXISTING_URL = '/auth/line?mode=link&next=/staff/application';

export function LineLoginEntry() {
  return (
    <section className="staff-onboard-line-entry" aria-labelledby="staff-onboard-line-entry-heading">
      <h2 id="staff-onboard-line-entry-heading" className="staff-onboard-line-entry-heading">
        เข้าสู่ระบบด้วยบัญชี LINE
      </h2>
      <p className="staff-onboard-line-entry-note">
        LINE ใช้เพื่อยืนยันตัวตนของคุณเท่านั้น สิทธิ์การใช้งานระบบงานบริการ
        ต้องผ่านการอนุมัติจากผู้ดูแลระบบของมหาวิทยาลัยก่อน
      </p>
      <ul className="staff-onboard-line-entry-actions">
        <li>
          <a className="staff-onboard-button" href={LINE_LOGIN_APPLICATION_URL}>
            สมัครใช้งานใหม่ด้วย LINE
          </a>
          <p className="staff-onboard-line-entry-muted">สำหรับบุคลากรที่ยังไม่เคยยื่นคำขอในระบบนี้</p>
        </li>
        <li>
          <a className="staff-onboard-button staff-onboard-button-secondary" href={LINE_LINK_EXISTING_URL}>
            ผูกบัญชีบุคลากรที่มีอยู่แล้ว
          </a>
          <p className="staff-onboard-line-entry-muted">
            สำหรับผู้ที่เข้าสู่ระบบด้วยอีเมลได้อยู่แล้ว และต้องการผูก LINE เข้ากับบัญชีเดิม
            โดยไม่สร้างข้อมูลซ้ำ
          </p>
        </li>
      </ul>
      <p className="staff-onboard-line-entry-muted">
        การเข้าสู่ระบบและกู้คืนรหัสผ่านด้วยอีเมลยังใช้ได้ตามปกติผ่านแบบฟอร์มหลัก
      </p>
    </section>
  );
}

export default LineLoginEntry;
