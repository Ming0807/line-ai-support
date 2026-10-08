'use client';
import {useEffect,useRef,useState} from 'react';
import {staffKnowledgeAdviceSchema,type StaffKnowledgeAdvice} from '@/lib/staff/knowledge-assistance-contracts';

export default function StaffKnowledgePanel({id,revision,canReply,onDraft}:{id:string;revision:number;canReply:boolean;onDraft:(text:string)=>void}){
 const [view,setView]=useState<StaffKnowledgeAdvice|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null),serial=useRef(0);
 useEffect(()=>()=>{serial.current++;request.current?.abort();},[]);
 async function search(){
  if(busy)return;request.current?.abort();const controller=new AbortController();request.current=controller;const epoch=++serial.current;
  setBusy(true);setError(null);setView(null);
  try{
   const response=await fetch(`/api/tickets/${encodeURIComponent(id)}/knowledge-assistance`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision}),cache:'no-store',signal:controller.signal});
   if(epoch!==serial.current||controller.signal.aborted)return;
   if(!response.ok){setError(response.status===409?'เคสหรือเอกสารมีข้อมูลใหม่ กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง':response.status===401?'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง':response.status===404?'เคสนี้ไม่พร้อมใช้งานหรือสิทธิ์ของคุณเปลี่ยนไป':'ยังค้นเอกสารไม่ได้ กรุณาลองใหม่ภายหลัง');return;}
   const next=staffKnowledgeAdviceSchema.parse(await response.json());if(epoch!==serial.current||controller.signal.aborted)return;
   if(next.revision!==revision){setError('เคสมีข้อมูลใหม่ กรุณาโหลดข้อมูลล่าสุด');return;}setView(next);
  }catch{if(!controller.signal.aborted&&epoch===serial.current)setError('การเชื่อมต่อขาดหาย กรุณาลองใหม่ ข้อความที่พิมพ์ไว้ยังคงอยู่');}
  finally{if(!controller.signal.aborted&&epoch===serial.current)setBusy(false);}
 }
 return <section className="ticket-ai-panel" aria-labelledby="staff-knowledge-heading" aria-busy={busy}>
  <h3 id="staff-knowledge-heading">เอกสารประกอบ</h3><p className="ticket-muted">ค้นจากข้อความล่าสุดของผู้แจ้งในเอกสารที่ผ่านการตรวจสอบ แล้วตรวจทานก่อนส่ง</p>
  <button className="ticket-button ticket-button-secondary" type="button" disabled={busy} onClick={()=>void search()}>{busy?'กำลังค้นเอกสาร…':'ค้นเอกสารประกอบ'}</button>
  {busy&&<p className="ticket-muted" role="status">กำลังตรวจข้อมูลและแหล่งอ้างอิง</p>}
  {error&&<p role="alert">{error}</p>}
  {view&&<div className="ticket-ai-result" aria-live="polite">
   {view.status==='NO_USER_QUESTION'?<p>ยังไม่มีข้อความคำถามจากผู้แจ้งให้ค้นเอกสารประกอบ</p>:<>
    <h4>{view.status==='VERIFIED'?'คำตอบจากเอกสาร':'ยังยืนยันข้อมูลไม่ได้'}</h4><p className="ticket-ai-draft">{view.answer}</p>
    {view.status==='VERIFIED'&&<><h4>แหล่งอ้างอิง</h4><ol className="ticket-knowledge-sources">{view.sources.map((source,i)=><li key={i}>
     {source.url?<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>:<span>{source.title}</span>}
     {source.academicYear!==null&&<span> · ปีการศึกษา {source.academicYear}</span>}{source.location&&<span> · {source.location}</span>}
    </li>)}</ol><p className="ticket-muted">ตรวจว่าคำตอบตรงกรณีของผู้แจ้งก่อนใช้</p>
     {view.draftText===null?<p className="ticket-muted">คำตอบพร้อมอ้างอิงยาวเกินข้อความตอบกลับ กรุณาเรียบเรียงพร้อมแหล่งอ้างอิงเอง</p>:canReply&&<button className="ticket-button ticket-button-secondary" type="button" onClick={()=>onDraft(view.draftText!)}>นำคำตอบพร้อมอ้างอิงไปแก้ไข</button>}
    </>}
   </>}
  </div>}
 </section>;
}
