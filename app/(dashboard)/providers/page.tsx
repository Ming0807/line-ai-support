import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/staff';
import { listProviders } from '@/lib/ai/provider-admin';
import { providerBases, type ProviderKind, type ProviderView } from '@/types/providers';
import ProviderForms from './provider-forms';
import '@/app/providers.css';
import {getEmbeddingStatus} from '@/lib/knowledge/embedding-status';
import {LOCAL_EMBEDDING_MODEL} from '@/lib/knowledge/embedding-space';

export default async function ProvidersPage() {
  const staff = await requireStaff();
  if (staff.role !== 'SUPER_ADMIN') notFound();

  let providers: ProviderView[] = [];
  let loadError = false;
  try { providers = await listProviders(staff.id); }
  catch { loadError = true; }
  let embedding:Awaited<ReturnType<typeof getEmbeddingStatus>>|null=null;
  try{embedding=await getEmbeddingStatus(staff.id);}catch{/* Read-only controlled unavailable state. */}
  const choices: { adapter: ProviderKind; baseUrl: string }[] = [
    ...Object.entries(providerBases).map(([adapter, baseUrl]) => ({ adapter: adapter as ProviderKind, baseUrl })),
    { adapter: 'COMPATIBLE', baseUrl: '' },
  ];

  return (
    <main className="provider-page">
      <Link className="provider-back-link" href="/dashboard">กลับหน้าหลัก</Link>
      <header className="provider-heading">
        <div>
          <h1>ผู้ให้บริการ AI</h1>
          <p>จัดการโมเดลสร้างคำตอบและ Reasoning พร้อมลำดับที่ระบบจะพิจารณา</p>
        </div>
        <span className="provider-total">{providers.length} ผู้ให้บริการ</span>
      </header>
      <p className="provider-security-note">คีย์ API ใช้สำหรับเชื่อมต่อเท่านั้น ระบบจะไม่แสดงคีย์เดิมในหน้านี้</p>
      <section className="embedding-service-status" aria-labelledby="embedding-service-title">
        <div className="provider-list-title"><h2 id="embedding-service-title">Embedding Service</h2><strong>{embedding?.healthy?'Healthy · เชื่อมต่อแล้ว':'Unavailable · ไม่พร้อมใช้งาน'}</strong></div>
        <dl><div><dt>Model</dt><dd>{embedding?.model??LOCAL_EMBEDDING_MODEL}</dd></div><div><dt>Dimension</dt><dd>384</dd></div><div><dt>Mode</dt><dd>Local · CPU</dd></div></dl>
        <p>โมเดลเริ่มต้นสำหรับค้นหาเอกสาร จัดการการเชื่อมต่อผ่านการตั้งค่าระบบ</p>
        {embedding&&<p className="provider-field-hint">ตรวจล่าสุด <time dateTime={embedding.observedAt}>{new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}).format(new Date(embedding.observedAt))}</time>{embedding.httpStatus!==null?` · HTTP ${embedding.httpStatus}`:''}</p>}
      </section>
      <ProviderForms providers={providers} choices={choices} loadError={loadError} />
    </main>
  );
}
