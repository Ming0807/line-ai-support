'use client';

import {useEffect,useMemo,useState} from 'react';
import {createStaffCopilotController,type StaffCopilotPanelState} from './staff-copilot-controller';

export type StaffCopilotPanelProps={id:string;revision:number;canReply:boolean;onDraft:(text:string)=>void};
type ViewProps=StaffCopilotPanelProps&{
 state:StaffCopilotPanelState;
 onGenerate:()=>void;
 onCancel:()=>void;
 onDraftTextChange:(text:string)=>void;
};

export function StaffCopilotPanelView({id,canReply,onDraft,state,onGenerate,onCancel,onDraftTextChange}:ViewProps){
 const advice=state.status==='result'?state.advice:null;
 const draftText=state.status==='result'?state.draftText:'';
 const canApply=advice?.status==='DRAFT'&&canReply&&draftText.trim().length>0&&draftText.length<=5_000;
 return <section className="ticket-ai-panel ticket-copilot-panel" aria-labelledby={`staff-copilot-heading-${id}`} aria-busy={state.status==='loading'}>
  <div className="ticket-copilot-heading">
   <div><h3 id={`staff-copilot-heading-${id}`}>Hermes · ช่วยร่างคำตอบ</h3>
    <p className="ticket-muted">ร่างจากคำถามของผู้แจ้งและแหล่งข้อมูลที่ตรวจสอบแล้ว เจ้าหน้าที่เป็นผู้ตรวจและเลือกใช้เอง</p>
   </div>
   {state.status==='loading'
    ?<button type="button" className="ticket-button ticket-button-secondary" onClick={onCancel}>ยกเลิกการสร้างร่าง</button>
    :<button type="button" className="ticket-button ticket-button-secondary" disabled={!canReply} onClick={onGenerate}>
      {state.status==='error'?'ลองสร้างใหม่':'สร้างร่าง'}
     </button>}
  </div>
  {!canReply&&<p className="ticket-copilot-note">ไม่มีสิทธิ์ตอบกลับเคสนี้ จึงยังสร้างหรือนำร่างไปใช้ไม่ได้</p>}
  {state.status==='loading'&&<p className="ticket-copilot-progress" role="status">กำลังสร้างร่างจากข้อมูลที่ตรวจสอบแล้ว · รอสักครู่ได้ หรือยกเลิกการทำงาน</p>}
  {state.status==='cancelled'&&<p className="ticket-copilot-note" role="status">ยกเลิกการสร้างร่างแล้ว</p>}
  {state.status==='error'&&<p className="ticket-copilot-error" role="alert">{state.message}</p>}
  {advice?.status==='NOT_VERIFIED'&&<div className="ticket-copilot-outcome" aria-live="polite">
   <h4>ยังยืนยันคำแนะนำไม่ได้</h4><p>{advice.evidenceText}</p>
  </div>}
  {advice?.status==='NO_USER_QUESTION'&&<p className="ticket-copilot-note" role="status">ยังไม่มีข้อความคำถามจากผู้แจ้งในเคสนี้ จึงยังร่างคำตอบไม่ได้</p>}
  {advice?.status==='DRAFT'&&<div className="ticket-copilot-result" aria-live="polite">
   <p className="ticket-copilot-unreviewed">ร่างนี้ยังไม่ได้ตรวจสอบความถูกต้องหรือความครบถ้วน โปรดอ่านทั้งร่างและข้อมูลอ้างอิงก่อนนำไปใช้</p>
   <label htmlFor={`staff-copilot-draft-${id}`}>ร่างคำตอบ · แก้ไขได้</label>
   <textarea id={`staff-copilot-draft-${id}`} className="ticket-copilot-draft" rows={8} maxLength={12_000}
    value={draftText} onChange={event=>onDraftTextChange(event.currentTarget.value)} />
   <div className="ticket-copilot-apply-row">
    <span className={draftText.length>5_000?'ticket-copilot-over-limit':'ticket-copilot-counter'}>
     {draftText.length.toLocaleString('th-TH')} / 5,000 ตัวอักษรสำหรับนำไปใช้
    </span>
    {draftText.length>5_000&&<p className="ticket-copilot-over-limit-note">ร่างฉบับเต็มยังอยู่ครบ แต่ยาวเกินช่องตอบกลับ แก้ให้ไม่เกิน 5,000 ตัวอักษรก่อนนำไปใช้</p>}
   </div>
   <button type="button" className="ticket-button ticket-button-primary" disabled={!canApply} onClick={()=>{if(canApply)onDraft(draftText);}}>
    นำร่างไปแก้ไขในช่องตอบกลับ
   </button>
   <section className="ticket-copilot-evidence" aria-labelledby={`staff-copilot-evidence-${id}`}>
    <h4 id={`staff-copilot-evidence-${id}`}>ข้อมูลที่ใช้ประกอบร่าง</h4>
    <p className="ticket-copilot-evidence-text">{advice.evidenceText}</p>
    <h5>แหล่งอ้างอิง · ตรวจสอบก่อนส่ง</h5>
    <ol className="ticket-copilot-sources" aria-label="แหล่งอ้างอิง">
     {advice.sources.map((source,index)=><li key={`${source.title}-${index}`}>
      {source.url?<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>:<span>{source.title}</span>}
      {source.academicYear!==null&&<span> · ปีการศึกษา {source.academicYear}</span>}
      {source.location&&<span> · {source.location}</span>}
     </li>)}
    </ol>
   </section>
  </div>}
 </section>;
}

export default function StaffCopilotPanel({id,revision,canReply,onDraft}:StaffCopilotPanelProps){
 const [saved,setSaved]=useState<{id:string;revision:number;state:StaffCopilotPanelState}>({id,revision,state:{status:'idle'}});
 const state=saved.id===id&&saved.revision===revision?saved.state:{status:'idle'} as StaffCopilotPanelState;
 const controller=useMemo(()=>createStaffCopilotController({id,revision,onState:next=>{
  setSaved({id,revision,state:next});
 }}),[id,revision]);
 useEffect(()=>()=>controller.dispose(),[controller]);
 return <StaffCopilotPanelView id={id} revision={revision} canReply={canReply} onDraft={onDraft} state={state}
  onGenerate={()=>void controller.generate()} onCancel={()=>controller.cancel()}
  onDraftTextChange={text=>setSaved(previous=>previous.id===id&&previous.revision===revision&&previous.state.status==='result'
   ?{...previous,state:{...previous.state,draftText:text}}:previous)} />;
}
