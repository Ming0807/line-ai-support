'use client';
import {useEffect,useRef,useState} from 'react';
import {assistViewSchema,type AssistView} from '@/lib/staff/ai-assistance-contracts';
const priorityLabels:Record<AssistView['advice']['suggestedPriority'],string>={LOW:'ต่ำ',MEDIUM:'ปกติ',HIGH:'สูง',CRITICAL:'เร่งด่วน'};

export default function StaffAiPanel({id,revision,canReply,onDraft}:{id:string;revision:number;canReply:boolean;onDraft:(text:string)=>void}){
 const [view,setView]=useState<AssistView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null),serial=useRef(0);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function ask(){
  if(busy)return;request.current?.abort();const controller=new AbortController();request.current=controller;const epoch=++serial.current;
  setBusy(true);setError(null);setView(null);
  try{
   const response=await fetch(`/api/tickets/${id}/assist`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision}),cache:'no-store',signal:controller.signal});
   if(!response.ok){setError(response.status===409?'เคสมีข้อมูลใหม่ กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง':response.status===404?'เคสนี้ไม่พร้อมใช้งานหรือสิทธิ์ของคุณเปลี่ยนไป':'AI ยังไม่พร้อมให้คำแนะนำ กรุณาลองใหม่ภายหลัง');return;}
   const next=assistViewSchema.parse(await response.json());if(epoch!==serial.current||controller.signal.aborted)return;
   if(next.revision!==revision){setError('เคสมีข้อมูลใหม่ กรุณาโหลดข้อมูลล่าสุด');return;}setView(next);
  }catch{if(!controller.signal.aborted&&epoch===serial.current)setError('การเชื่อมต่อขาดหาย กรุณาลองใหม่');}
  finally{if(!controller.signal.aborted&&epoch===serial.current)setBusy(false);}
 }
 return <section className="ticket-ai-panel" aria-labelledby="staff-ai-heading"><h3 id="staff-ai-heading">ผู้ช่วยเจ้าหน้าที่</h3><p className="ticket-muted">ให้ AI ช่วยสรุปและร่างข้อความสำหรับคุณตรวจทานก่อนส่ง</p>
  <button className="ticket-button ticket-button-secondary" type="button" disabled={busy} onClick={()=>void ask()}>{busy?'กำลังเตรียมคำแนะนำ…':'ช่วยสรุปและร่างคำตอบ'}</button>
  {error&&<p role="alert">{error}</p>}
  {view&&<div className="ticket-ai-result" aria-live="polite"><h4>สรุปเรื่อง</h4><p>{view.advice.ticketSummary}</p><h4>สรุปบทสนทนา</h4><p>{view.advice.conversationSummary}</p>
   {view.historyTruncated&&<p className="ticket-muted">ใช้เฉพาะข้อความล่าสุดบางส่วนในการสรุป</p>}
   <p>ฝ่ายที่แนะนำ: {view.advice.suggestedDepartmentCode??'ยังไม่แน่ใจ'} · ความเร่งด่วนที่แนะนำ: {priorityLabels[view.advice.suggestedPriority]}</p><p>{view.advice.reason}</p>
   {!!view.advice.uncertainties.length&&<ul>{view.advice.uncertainties.map((value,i)=><li key={i}>{value}</li>)}</ul>}
   <h4>ร่างคำตอบ</h4><p className="ticket-ai-draft">{view.advice.replyDraft}</p><p className="ticket-muted">ร่างนี้ยังไม่ได้ค้นเอกสารยืนยัน กรุณาตรวจสอบข้อเท็จจริงก่อนใช้</p>
   {canReply&&<button type="button" className="ticket-button ticket-button-secondary" onClick={()=>onDraft(view.advice.replyDraft)}>นำร่างไปแก้ไขก่อนส่ง</button>}
  </div>}
 </section>;
}
