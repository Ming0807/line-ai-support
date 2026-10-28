import type {Metadata} from 'next';
import '@/app/staff-onboarding.css';
import ApprovalsClient from './approvals-client';
import {requireStaff} from '@/lib/auth/staff';
import {notFound} from 'next/navigation';

export const metadata: Metadata = {title:'อนุมัติคำขอเปิดบัญชีบุคลากร | มหาวิทยาลัยราชภัฏยะลา'};

export default async function StaffApplicationsPage() {
  const staff = await requireStaff();
  if (staff.role !== 'SUPER_ADMIN') notFound();
  return <ApprovalsClient />;
}
