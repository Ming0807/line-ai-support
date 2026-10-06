import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireStaff} from '@/lib/auth/staff';
import {listImportJobs} from '@/lib/imports/import-staging';
import type {ImportJobView} from '@/lib/imports/import-staging';
import '@/app/knowledge.css';

const statusLabel:Record<ImportJobView['status'],string>={READY:'รับต้นฉบับแล้ว',FAILED:'ต้องตรวจการวิเคราะห์'};
const formatName:Record<ImportJobView['format'],string>={PDF:'PDF',DOCX:'Word',XLSX:'Excel',CSV:'CSV',HTML:'HTML'};
const dateLabel=(value:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export default async function KnowledgePage(){
 const staff=await requireStaff();
 if(staff.role!=='SUPER_ADMIN')notFound();
 let jobs:ImportJobView[]=[],loadError=false;
 try{jobs=await listImportJobs(staff.id);}catch{loadError=true;}
 return <main className="knowledge-page">
  <nav className="knowledge-breadcrumb" aria-label="เส้นทางนำทาง"><Link href="/dashboard">กลับหน้าหลัก</Link></nav>
  <header className="knowledge-heading">
   <div><h1>คลังความรู้</h1><p>จัดเก็บและตรวจข้อความจากเอกสารก่อนเข้าสู่ขั้นตอนเผยแพร่</p></div>
   <Link className="knowledge-button knowledge-button-primary" href="/knowledge/import">นำเข้าเอกสาร</Link>
  </header>
  <p className="knowledge-state">เปิดรายการเพื่อตรวจร่างและใบรับรองการอนุมัติ เอกสารจะใช้ตอบได้ตามขอบเขตและวันที่ที่ตรวจแล้ว</p>
  <section className="knowledge-job-section" aria-labelledby="knowledge-job-title">
   <div className="knowledge-section-heading"><h2 id="knowledge-job-title">รายการนำเข้า</h2><span>{jobs.length} รายการล่าสุด</span></div>
   {loadError?<p className="knowledge-message knowledge-message-error" role="alert">โหลดรายการไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง</p>:jobs.length===0?
    <div className="knowledge-empty"><h3>ยังไม่มีเอกสารนำเข้า</h3><p>เริ่มจากเพิ่มไฟล์หรือ URL ของมหาวิทยาลัย แล้วตรวจผลการอ่านก่อนแก้ไขข้อความ</p><Link className="knowledge-button knowledge-button-secondary" href="/knowledge/import">เริ่มนำเข้า</Link></div>:
    <ul className="knowledge-job-list">{jobs.map(job=><li key={job.id}>
     <Link className="knowledge-job-link" href={`/knowledge/import?id=${encodeURIComponent(job.id)}`}>
      <span className="knowledge-job-main"><strong>{job.filename}</strong><span>{formatName[job.format]} · {job.acquiredFrom==='URL'?'URL ทางการ':'อัปโหลด'}{job.sourceUrl?` · ${job.sourceUrl}`:''}</span></span>
      <span className={`knowledge-status knowledge-status-${job.status.toLowerCase()}`}>{statusLabel[job.status]}</span>
      <span className="knowledge-job-meta">ฉบับ {job.revision} · {Math.ceil(job.byteLength/1024)} KB · {dateLabel(job.createdAt)}</span>
     </Link>
    </li>)}</ul>}
  </section>
 </main>;
}
