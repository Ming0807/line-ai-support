import type { ReactNode } from 'react';
import { signOutAction } from '@/app/auth/actions';
import { requireStaff } from '@/lib/auth/staff';

export const dynamic = 'force-dynamic';

const roleLabels = {
  STAFF: 'บุคลากร',
  SUPERVISOR: 'หัวหน้างาน',
  ADMIN: 'ผู้ดูแลระบบ',
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
} as const;

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="page-shell">
      <header className="shell-header">
        <div>
          <p className="shell-title">ระบบงานบริการบุคลากร · มหาวิทยาลัยราชภัฏยะลา</p>
          <div className="user-line">{staff.display_name} · {roleLabels[staff.role]}</div>
        </div>
        <form action={signOutAction}>
          <button className="signout-button" type="submit">ออกจากระบบ</button>
        </form>
      </header>
      {children}
    </div>
  );
}
