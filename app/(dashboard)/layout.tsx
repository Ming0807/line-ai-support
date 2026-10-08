import type { ReactNode } from 'react';
import { requireStaff } from '@/lib/auth/staff';
import NavBar from './nav-bar';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="page-shell">
      <NavBar staff={staff} />
      <div id="main-content" className="shell-body">
        {children}
      </div>
    </div>
  );
}
