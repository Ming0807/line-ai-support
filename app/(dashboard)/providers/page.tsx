import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/staff';
import { listProviders } from '@/lib/ai/provider-admin';
import type { ProviderView } from '@/types/providers';
import ProviderForms from './provider-forms';
import '@/app/providers.css';

export default async function ProvidersPage() {
  const staff = await requireStaff();
  if (staff.role !== 'SUPER_ADMIN') notFound();

  const providers: ProviderView[] = await listProviders(staff.id);

  return (
    <main className="provider-page">
      <Link className="provider-back-link" href="/dashboard">กลับหน้าหลัก</Link>
      <header className="provider-heading">
        <div>
          <h1>ผู้ให้บริการ AI</h1>
          <p>จัดการการเชื่อมต่อ OpenAI และรายการ Model ที่ระบบเลือกใช้</p>
        </div>
        <span className="provider-total">{providers.length} ผู้ให้บริการ</span>
      </header>
      <p className="provider-security-note">คีย์ API ใช้สำหรับเชื่อมต่อเท่านั้น ระบบจะไม่แสดงคีย์เดิมในหน้านี้</p>
      <ProviderForms providers={providers} />
    </main>
  );
}
