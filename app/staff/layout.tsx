import type {ReactNode} from 'react';
import Link from 'next/link';
import '@/app/staff-onboarding.css';

/** Public shell for /staff/** — visitors are not yet active Staff, so it has no
    dashboard navigation; identity and access live behind /login and approval. */
export default function StaffPublicLayout({children}:{children:ReactNode}) {
  return (
    <div className="staff-onboard-shell">
      <header className="staff-onboard-shell-header">
        <Link className="staff-onboard-brand" href="/login">
          <span className="staff-onboard-brand-badge" aria-hidden="true">ยร</span>
          ระบบงานบริการบุคลากร
        </Link>
        <Link className="staff-onboard-shell-header-link" href="/login">หน้าเข้าสู่ระบบ</Link>
      </header>
      <main id="main-content" className="staff-onboard-shell-main">{children}</main>
      <footer className="staff-onboard-shell-footer">
        มหาวิทยาลัยราชภัฏยะลา · LINE ใช้ยืนยันตัวตน สิทธิ์การใช้งานอนุมัติโดยผู้ดูแลระบบ
      </footer>
    </div>
  );
}
