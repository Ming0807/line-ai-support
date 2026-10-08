import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireStaff} from '@/lib/auth/staff';
import {listImportJobs} from '@/lib/imports/import-staging';
import type {ImportJobView} from '@/lib/imports/import-staging';
import ImportForm from './import-form';
import '@/app/knowledge.css';

type SearchParams=Promise<Record<string,string|string[]|undefined>>;

export default async function KnowledgeImportPage({searchParams}:{searchParams:SearchParams}){
 const staff=await requireStaff();
 if(staff.role!=='SUPER_ADMIN')notFound();
 let jobs:ImportJobView[]=[],loadError=false;
 try{jobs=await listImportJobs(staff.id);}catch{loadError=true;}
 const params=await searchParams;
 const requested=params.id;
 const initialJobId=typeof requested==='string'&&/^[0-9a-f-]{36}$/iu.test(requested)?requested:null;
 return <main className="knowledge-page">
  <nav className="knowledge-breadcrumb" aria-label="เส้นทางนำทาง"><Link href="/knowledge">กลับรายการนำเข้า</Link><span aria-hidden="true">/</span><Link href="/dashboard">หน้าหลัก</Link></nav>
  <header className="knowledge-heading"><div><h1>นำเข้าและตรวจเอกสาร</h1><p>ดูข้อความและตำแหน่งต้นทาง แก้เฉพาะข้อความที่อ่านคลาดเคลื่อน แล้วบันทึกเป็น revision ใหม่</p></div></header>
  <nav className="activity-tabs-header" style={{ marginBottom: '1.25rem' }} aria-label="หมวดหมู่คลังความรู้">
    <div className="activity-tabs-group">
      <Link href="/knowledge" className="activity-tab">
        คลังความรู้ที่เผยแพร่ (Catalog)
      </Link>
      <span className="activity-tab is-active" aria-current="page">
        นำเข้าเอกสารใหม่ (Import)
      </span>
    </div>
  </nav>
  <ImportForm initialJobs={jobs} initialJobId={initialJobId} initialListError={loadError}/>
 </main>;
}
