'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import type {ImportReviewState} from '@/lib/imports/import-review';
import type {ImportReviewDraft} from '@/lib/imports/review-schema';
import type {ImportPublicationReceipt} from '@/lib/imports/import-publication';
import {isPublicationResult,isReceiptEnvelope} from '@/lib/imports/publication-response';

type ApprovalPanelProps={
 review:ImportReviewState;
 dirty:boolean;
 disabled:boolean;
 onPendingChange:(pending:boolean)=>void;
 onReceiptChange:(receipt:ImportPublicationReceipt|null)=>void;
};
type ReadState='loading'|'ready'|'error';
type Message={kind:'info'|'error';text:string;binding:string};
type Result={response:Response;body:unknown};
type ReadResult={key:string;state:ReadState;message?:string};
type ReceiptResult={jobId:string;receipt:ImportPublicationReceipt|null};
type Confirmation={key:string;open:boolean;checked:boolean};
const actions:Record<NonNullable<ImportReviewDraft['action']>,string>={
 NEW_FAMILY:'เริ่มกลุ่มเอกสารใหม่',ADD_ADDITIONAL:'เพิ่มเอกสารในกลุ่ม',REPLACE_CURRENT:'แทนฉบับปัจจุบัน',ADD_HISTORICAL:'เพิ่มฉบับย้อนหลัง',AMEND_EXISTING:'แก้ไขเอกสารเดิม',
};
const attestations:readonly (keyof ImportReviewDraft['attestations'])[]=['sourceAuthorityReviewed','extractionReviewed','applicabilityReviewed','sensitivityReviewed','versionReviewed'];
const digest=/^[a-f0-9]{64}$/;
async function request(url:string,init:RequestInit):Promise<Result>{
 const response=await fetch(url,{...init,cache:'no-store',credentials:'same-origin'});
 let body:unknown=null;try{body=await response.json();}catch{/* strict callers fail closed */}
 return {response,body};
}
function formatDate(value:string){return new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value));}
function display(value:string|number|null|undefined){return value===null||value===undefined||value===''?'ไม่ระบุ':String(value);}
function scopeSummary(draft:ImportReviewDraft){
 const m=draft.metadata,s=m.scope;
 return [
  ['หน่วยงาน',m.departmentCode],['ผู้รับเอกสาร',s.audience],['ประเภทผู้เรียน',s.studentType],['ภาคการศึกษา',s.semester],['หลักสูตร',s.programCode],
  ['หลักสูตรตามโครงสร้าง',s.curriculumCode],['รุ่นผู้เรียน',s.cohort],['ปีการศึกษา',m.academicYear],
  ['วันที่ประกาศ',m.publishedAt],['เริ่มมีผล',m.effectiveFrom],['สิ้นสุดผล',m.effectiveTo],['การมองเห็น',m.visibility],
 ];
}
function statusMessage(status:number){
 if(status===401||status===403)return 'บัญชีนี้ไม่มีสิทธิ์อนุมัติ กรุณาให้ผู้ดูแลที่ได้รับอนุญาตดำเนินการ';
 if(status===404)return 'ไม่พบงานนำเข้าที่เลือก หรือรายการนี้ไม่พร้อมสำหรับการอนุมัติ';
 if(status===409)return 'ข้อมูลตรวจทานหรือแผนเอกสารเปลี่ยนไป กรุณาตรวจใบรับรองและโหลดข้อมูลล่าสุดก่อนดำเนินการอีกครั้ง';
 if(status===422)return 'ข้อมูลตรวจทานยังไม่ผ่านเงื่อนไขการอนุมัติ โปรดแก้ไขและบันทึกร่างก่อนลองอีกครั้ง';
 if(status===408)return 'การเตรียมเอกสารใช้เวลานานเกินกำหนด ผลการอนุมัติยังต้องตรวจสอบจากใบรับรองก่อนลองอีกครั้ง';
 if(status===503)return 'ระบบอนุมัติยังไม่พร้อม โปรดตรวจใบรับรองอีกครั้งก่อนลองใหม่';
 return 'ระบบไม่สามารถยืนยันผลการอนุมัติได้ โปรดตรวจใบรับรองอีกครั้ง';
}

export default function ApprovalPanel({review,dirty,disabled,onPendingChange,onReceiptChange}:ApprovalPanelProps){
 const binding=`${review.jobId}:${review.jobRevision}:${review.extractionRevision}:${review.reviewRevision}`;
 const saved=review.saved?.draft??null;
 const savedV2=saved?.schemaVersion===2?saved:null;
 const savedBinding=review.saved?`${review.saved.jobRevision}:${review.saved.extractionRevision}:${review.saved.reviewRevision}`:'';
 const expectedBinding=`${review.jobRevision}:${review.extractionRevision}:${review.reviewRevision}`;
 const matchingSaved=Boolean(review.saved&&savedBinding===expectedBinding&&!review.stale&&savedV2?.chunkPlan?.chunkerVersion==='located-e5-v1'&&digest.test(savedV2.chunkPlan.digest));
 const attestationsComplete=Boolean(saved&&attestations.every(key=>saved.attestations[key]));
 const plan=savedV2?.chunkPlan;
 const planAcknowledged=plan!==null&&plan!==undefined&&plan.chunkerVersion==='located-e5-v1'&&digest.test(plan.digest);
 const storageMode=saved?.metadata.storageMode??null;
 const [refresh,setRefresh]=useState(0);
 const currentReadKey=`${binding}:${refresh}`;
 const [readResult,setReadResult]=useState<ReadResult|null>(null);
 const readState=readResult?.key===currentReadKey?readResult.state:'loading';
 const [receiptResult,setReceiptResult]=useState<ReceiptResult|null>(null);
 const receiptRef=useRef<ReceiptResult|null>(null);
 const completed=receiptResult?.jobId===review.jobId?receiptResult.receipt:null;
 const [publishing,setPublishing]=useState(false);
 const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
 const [confirmationContext,setConfirmationContext]=useState({binding,dirty,epoch:0});
 if(confirmationContext.binding!==binding||confirmationContext.dirty!==dirty)setConfirmationContext({binding,dirty,epoch:confirmationContext.epoch+1});
 const confirmationKey=`${binding}:${confirmationContext.epoch}`;
 const open=confirmation?.key===confirmationKey&&confirmation.open;
 const checked=confirmation?.key===confirmationKey&&confirmation.checked;
 const [message,setMessage]=useState<Message|null>(null);
 const currentMessage=message?.binding===binding?message:null;
 const requestSerial=useRef(0);
 const mounted=useRef(false);
 const activePost=useRef<AbortController|null>(null);
 const confirmationHeading=useRef<HTMLHeadingElement|null>(null);
 const pendingCallback=useRef(onPendingChange);
 const childPending=readState==='loading'||publishing;
 const requestBinding=useMemo(()=>({id:review.jobId,expectedJobRevision:review.jobRevision,expectedExtractionRevision:review.extractionRevision,expectedReviewRevision:review.reviewRevision}),[review.jobId,review.jobRevision,review.extractionRevision,review.reviewRevision]);
 const canStart=Boolean(matchingSaved&&attestationsComplete&&planAcknowledged&&!dirty&&!disabled&&!childPending&&readState==='ready'&&!completed&&storageMode==='RAG');
 const setApprovalMessage=(value:Omit<Message,'binding'>|null)=>setMessage(value?{...value,binding}:null);

 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;activePost.current?.abort();pendingCallback.current(false);};},[]);
 useEffect(()=>{pendingCallback.current=onPendingChange;},[onPendingChange]);
 useEffect(()=>{onPendingChange(childPending);},[onPendingChange,childPending]);
 useEffect(()=>{if(open)confirmationHeading.current?.focus();},[open,confirmationKey]);
 useEffect(()=>{
  const controller=new AbortController();const serial=++requestSerial.current;let active=true;
  void request(`/api/knowledge/imports/${encodeURIComponent(review.jobId)}/publication`,{method:'GET',headers:{accept:'application/json'},signal:controller.signal})
   .then(({response,body})=>{
    if(!active||!mounted.current||controller.signal.aborted||serial!==requestSerial.current)return;
    if(!response.ok||!isReceiptEnvelope(body,review.jobId)){
     setReadResult({key:currentReadKey,state:'error',message:'ยังอ่านใบรับรองการอนุมัติไม่ได้ ระบบจะไม่เริ่มการอนุมัติจนกว่าจะตรวจสถานะได้'});return;
    }
    const next=body.publication.receipt;
    const known=receiptRef.current;
    if(next===null&&known?.jobId===review.jobId&&known.receipt!==null){
     setReadResult({key:currentReadKey,state:'error',message:'พบข้อมูลไม่สอดคล้อง ใบรับรองที่ยืนยันไว้ก่อนหน้ายังแสดงอยู่ แต่การอ่านล่าสุดไม่ส่งใบรับรองกลับมา ระบบเก็บใบรับรองเดิมและปิดการดำเนินการต่อไว้'});return;
    }
    const nextResult={jobId:review.jobId,receipt:next};receiptRef.current=nextResult;setReceiptResult(nextResult);setReadResult({key:currentReadKey,state:'ready'});
   })
   .catch(()=>{if(!active||!mounted.current||controller.signal.aborted||serial!==requestSerial.current)return;setReadResult({key:currentReadKey,state:'error',message:'การเชื่อมต่อขัดข้องขณะอ่านใบรับรอง ระบบจะไม่เริ่มการอนุมัติจนกว่าจะตรวจสถานะได้'});});
  return ()=>{active=false;controller.abort();activePost.current?.abort();};
 },[review.jobId,binding,currentReadKey]);
 useEffect(()=>{if(receiptResult?.jobId===review.jobId)onReceiptChange(receiptResult.receipt);},[receiptResult,review.jobId,onReceiptChange]);

 const checkReceipt=()=>{setApprovalMessage(null);setRefresh(value=>value+1);};
 const submit=async()=>{
  if(!checked||!open||!canStart)return;
  onPendingChange(true);
  const serial=++requestSerial.current;const controller=new AbortController();activePost.current=controller;setPublishing(true);setApprovalMessage({kind:'info',text:'กำลังบันทึกผลการอนุมัติ'});
  try{
   const {response,body}=await request('/api/knowledge/approve',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},signal:controller.signal,body:JSON.stringify({...requestBinding,confirmPublication:true})});
   if(!mounted.current||serial!==requestSerial.current)return;
   if(response.ok&&isPublicationResult(body,review.jobId)&&body.publication.receipt.jobRevision===requestBinding.expectedJobRevision&&body.publication.receipt.extractionRevision===requestBinding.expectedExtractionRevision&&body.publication.receipt.reviewRevision===requestBinding.expectedReviewRevision){
    const nextReceipt={jobId:review.jobId,receipt:body.publication.receipt};receiptRef.current=nextReceipt;setReceiptResult(nextReceipt);setReadResult({key:currentReadKey,state:'ready'});setConfirmation({key:confirmationKey,open:false,checked:false});
    setApprovalMessage({kind:'info',text:body.publication.replayed?'พบผลอนุมัติเดิมสำหรับฉบับตรวจทานนี้':'บันทึกผลอนุมัติแล้ว'});return;
   }
   if(response.ok){setApprovalMessage({kind:'error',text:'ได้รับคำตอบที่ตรวจสอบไม่ได้ ผลการอนุมัติยังไม่ยืนยัน โปรดอ่านใบรับรองหรือส่งคำขอเดิมอีกครั้ง'});return;}
   setApprovalMessage({kind:'error',text:statusMessage(response.status)});
  }catch{
   if(mounted.current&&serial===requestSerial.current)setApprovalMessage({kind:'error',text:'การเชื่อมต่อขาดหาย ผลการอนุมัติยังยืนยันไม่ได้ โปรดตรวจใบรับรองก่อน หรือส่งคำขอเดิมซ้ำเมื่อพร้อม'});
  }finally{if(activePost.current===controller){activePost.current=null;if(mounted.current)setPublishing(false);}}
 };

 if(completed){
  return <section className="knowledge-review knowledge-approval" aria-labelledby="knowledge-approval-title">
   <div className="knowledge-review-heading"><div><h3 id="knowledge-approval-title">อนุมัติและเผยแพร่</h3><p>มีใบรับรองผลการดำเนินการสำหรับงานนี้แล้ว</p></div><span className="knowledge-approval-status">เสร็จแล้ว</span></div>
   <dl className="knowledge-approval-grid">
    <div><dt>การดำเนินการ</dt><dd>{completed.relationship==='CANCELS'?'ยกเลิกเอกสารเป้าหมาย':actions[completed.action]}</dd></div><div><dt>รูปแบบจัดเก็บ</dt><dd>{completed.storageMode}</dd></div>
    <div><dt>รหัสเอกสาร</dt><dd>{completed.documentId}</dd></div><div><dt>บันทึกเมื่อ</dt><dd>{formatDate(completed.createdAt)}</dd></div>
    <div><dt>รุ่นงาน</dt><dd>{completed.jobRevision}</dd></div><div><dt>รุ่นข้อความที่สกัด</dt><dd>{completed.extractionRevision}</dd></div>
    <div><dt>รุ่นตรวจทาน</dt><dd>{completed.reviewRevision}</dd></div>
   </dl>
   {currentMessage&&<p className="knowledge-approval-message" role="status">{currentMessage.text}</p>}
   {readState==='error'&&readResult?.key===currentReadKey&&<p className="knowledge-approval-error" role="alert">{readResult.message}</p>}
   <p className="knowledge-approval-note">ใบรับรองเก็บผลอนุมัติสำหรับฉบับตรวจทานนี้ไว้ และงานนี้จะไม่เปิดให้อนุมัติซ้ำ</p>
   <button className="knowledge-button knowledge-button-tertiary" type="button" onClick={checkReceipt} disabled={disabled||childPending}>ตรวจใบรับรองอีกครั้ง</button>
  </section>;
 }

 return <section className="knowledge-review knowledge-approval" aria-labelledby="knowledge-approval-title">
  <div className="knowledge-review-heading"><div><h3 id="knowledge-approval-title">อนุมัติและเผยแพร่</h3><p>ตรวจข้อมูลฉบับที่บันทึกแล้วก่อนยืนยัน</p></div></div>
  {storageMode!==null&&storageMode!=='RAG'&&<p className="knowledge-review-stale" role="status">รูปแบบ {storageMode} ยังไม่มีตัวเชื่อมที่รองรับ จึงยังอนุมัติรายการนี้ไม่ได้</p>}
  {readState==='loading'&&<p className="knowledge-review-pending" role="status">กำลังตรวจใบรับรอง…</p>}
  {readState==='error'&&<div className="knowledge-review-conflict" role="alert"><p>{readResult?.key===currentReadKey?readResult.message:'ยังตรวจใบรับรองไม่ได้ ระบบปิดการอนุมัติไว้จนกว่าจะตรวจสถานะได้'}</p><button className="knowledge-button knowledge-button-secondary" type="button" onClick={checkReceipt} disabled={disabled||childPending}>ตรวจใบรับรองอีกครั้ง</button></div>}
  {readState==='ready'&&!matchingSaved&&<p className="knowledge-review-stale" role="status">ต้องบันทึกร่างตรวจทานปัจจุบัน รุ่น 2 พร้อมแผนแบ่งส่วนที่ตรงกับเอกสารก่อน</p>}
  {readState==='ready'&&matchingSaved&&savedV2&&<>
   {!attestationsComplete&&<p className="knowledge-review-stale" role="status">กรุณาตรวจและยืนยันหัวข้อทบทวนทั้งห้าข้อในร่างที่บันทึกแล้วก่อน</p>}
   {dirty&&<p className="knowledge-review-stale" role="status">มีการแก้ไขที่ยังไม่บันทึก กรุณาบันทึกฉบับตรวจทานก่อนอนุมัติ</p>}
   {disabled&&<p className="knowledge-review-pending" role="status">กำลังบันทึกหรือโหลดข้อมูลตรวจทาน</p>}
   {storageMode==='RAG'&&attestationsComplete&&matchingSaved&&<p className="knowledge-review-state">แผนเอกสารตรงกับฉบับตรวจทานที่บันทึกไว้แล้ว · {savedV2.chunkPlan?.digest.slice(0,12)}…</p>}
   {open&&<div className="knowledge-approval-confirm" role="region" aria-labelledby="knowledge-approval-confirm-title">
    <h4 id="knowledge-approval-confirm-title" tabIndex={-1} ref={confirmationHeading}>ตรวจทานข้อมูลก่อนยืนยัน</h4>
    <dl className="knowledge-approval-grid">
     <div><dt>ชื่อเอกสาร</dt><dd>{display(savedV2.metadata.title)}</dd></div>
     <div><dt>กลุ่มเอกสาร</dt><dd>{display(savedV2.metadata.familyCode)}{savedV2.metadata.newFamily?` · ${display(savedV2.metadata.newFamily.name)}`:''}</dd></div>
     <div><dt>ฉบับ</dt><dd>{display(savedV2.metadata.versionName)} · {display(savedV2.metadata.versionStream)}</dd></div>
     <div><dt>การดำเนินการ</dt><dd>{savedV2.action?actions[savedV2.action]:'ไม่ระบุ'}{savedV2.relationship==='CANCELS'?' · ยกเลิกเอกสารเป้าหมาย':''}</dd></div>
     {savedV2.target&&<div className="knowledge-approval-wide"><dt>เป้าหมาย (รหัสและรุ่น)</dt><dd>{savedV2.target.documentId} · รุ่น {savedV2.target.revision}</dd></div>}
     <div className="knowledge-approval-wide"><dt>แหล่งที่มา</dt><dd>{display(savedV2.metadata.sourceUrl)}</dd></div>
     {scopeSummary(savedV2).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}
     <div className="knowledge-approval-wide"><dt>แผนเอกสารที่ตรวจแล้ว</dt><dd>{savedV2.chunkPlan?.digest}</dd></div>
    </dl>
    <label className="knowledge-approval-check"><input type="checkbox" checked={Boolean(checked)} onChange={event=>setConfirmation({key:confirmationKey,open:true,checked:event.currentTarget.checked})} disabled={disabled||childPending}/><span>ฉันตรวจข้อมูลและยืนยันให้นำฉบับที่บันทึกไว้นี้เข้าสู่การอนุมัติ</span></label>
    <div className="knowledge-review-actions">
     <button className="knowledge-button knowledge-button-primary" type="button" onClick={()=>void submit()} disabled={!checked||!canStart||childPending}>ยืนยันการอนุมัติ</button>
     <button className="knowledge-button knowledge-button-secondary" type="button" onClick={()=>{setConfirmation({key:confirmationKey,open:false,checked:false});setApprovalMessage(null);}} disabled={disabled||childPending}>กลับไปตรวจทาน</button>
    </div>
   </div>}
   {!open&&<div className="knowledge-review-actions"><button className="knowledge-button knowledge-button-primary" type="button" onClick={()=>{setConfirmation({key:confirmationKey,open:true,checked:false});setApprovalMessage(null);}} disabled={!canStart}>ตรวจข้อมูลและเริ่มยืนยัน</button></div>}
  </>}
  {currentMessage&&readState==='ready'&&<p className={currentMessage.kind==='error'?'knowledge-approval-error':'knowledge-approval-message'} role={currentMessage.kind==='error'?'alert':'status'}>{currentMessage.text}</p>}
  {readState==='ready'&&<button className="knowledge-button knowledge-button-tertiary" type="button" onClick={checkReceipt} disabled={disabled||childPending}>ตรวจใบรับรองอีกครั้ง</button>}
  <p className="knowledge-approval-note">การยืนยันนี้บันทึกสถานะการอนุมัติสำหรับฉบับตรวจทานที่แสดงเท่านั้น</p>
 </section>;
}
