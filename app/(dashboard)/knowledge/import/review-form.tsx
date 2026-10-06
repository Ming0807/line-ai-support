'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ImportReviewState} from '@/lib/imports/import-review';
import type {ImportReviewDraft} from '@/lib/imports/review-schema';
import type {ImportPublicationReceipt} from '@/lib/imports/import-publication';
import VersionPanel from './version-panel';
import ChunkPlanPanel from './chunk-plan-panel';
import ApprovalPanel from './approval-panel';
import type {VersionCandidate} from '@/lib/imports/version-candidates';

type ReviewStatus='UNRESOLVED'|'CORRECTED'|'FALSE_POSITIVE';
type ReviewProps={jobId:string;jobRevision:number;extractionRevision:number;refreshKey:number;parentPending:boolean;onDraftStateChange:(dirty:boolean,pending:boolean,completedJobId:string|null)=>void;onReloadPreview:()=>void};
type Result={response:Response;body:unknown};
const datasetTypes=['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'] as const;
const storageModes=['RAG','STRUCTURED','BOTH'] as const;
const actionLabels:Record<string,string>={NEW_FAMILY:'เริ่มกลุ่มเอกสารใหม่',ADD_ADDITIONAL:'เพิ่มเอกสารในกลุ่ม',REPLACE_CURRENT:'แทนฉบับปัจจุบัน',ADD_HISTORICAL:'เพิ่มฉบับย้อนหลัง',AMEND_EXISTING:'แก้ไขเอกสารเดิม'};
const datasetLabels:Record<(typeof datasetTypes)[number],string>={academic_calendar_events:'ปฏิทินการศึกษา',tuition_fees:'ค่าเล่าเรียน',transfer_courses:'เทียบโอนรายวิชา',university_services:'บริการมหาวิทยาลัย',university_systems:'ระบบมหาวิทยาลัย',service_forms:'แบบฟอร์มบริการ',announcements:'ประกาศ'};
const warningLabels:Record<string,string>={OCR_REQUIRED:'อาจต้องใช้ OCR',LOW_TEXT_QUALITY:'คุณภาพข้อความต่ำ',UNSUPPORTED_TABLES:'อ่านตารางได้ไม่ครบ',ENCRYPTED_SOURCE:'ไฟล์เข้ารหัส',FORMULAS_PRESENT:'พบสูตรในตาราง',HIDDEN_DATA_REVIEW:'พบข้อมูลซ่อน',EXTERNAL_LINKS_REVIEW:'พบลิงก์ภายนอก',PAGE_REVIEW_REQUIRED:'ต้องตรวจข้อความหรือหน้าเอกสาร',TABLE_SHAPE_REVIEW:'ต้องตรวจรูปแบบตาราง',SOURCE_REVIEW_REQUIRED:'ต้องตรวจแหล่งที่มา',SENSITIVE_DATA_REVIEW_REQUIRED:'อาจมีข้อมูลละเอียดอ่อน',ACADEMIC_YEAR_AMBIGUOUS:'ปีการศึกษาไม่ชัดเจน',FAMILY_AMBIGUOUS:'ประเภทเอกสารไม่ชัดเจน',STRUCTURED_SCHEMA_UNAVAILABLE:'ยังไม่มีตัวเชื่อมชุดข้อมูล'};

function emptyDraft(warnings:ImportReviewState['warnings']):ImportReviewDraft{
 return {schemaVersion:1,metadata:{title:null,familyCode:null,newFamily:null,departmentCode:null,documentType:null,versionName:null,versionStream:null,academicYear:null,
  scope:{semester:null,audience:null,studentType:null,programCode:null,curriculumCode:null,cohort:null},publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:null,
  sourceUrl:null,sourcePageUrl:null,visibility:null,storageMode:null,datasetType:null},action:null,target:null,relationship:null,
  attestations:{sourceAuthorityReviewed:false,extractionReviewed:false,applicabilityReviewed:false,sensitivityReviewed:false,versionReviewed:false},
  warningDispositions:warnings.map(warning=>({warningKey:warning.key,status:'UNRESOLVED',reason:null}))};
}
function cloneDraft(draft:ImportReviewDraft):ImportReviewDraft{return JSON.parse(JSON.stringify(draft)) as ImportReviewDraft;}
function normalizeDraft(draft:ImportReviewDraft):ImportReviewDraft{
 const clean=(value:string|null)=>value===null||value.trim()===''?null:value.trim();
 return {...draft,metadata:{...draft.metadata,title:clean(draft.metadata.title),familyCode:clean(draft.metadata.familyCode),
  newFamily:draft.metadata.newFamily?{name:clean(draft.metadata.newFamily.name),category:clean(draft.metadata.newFamily.category)}:null,
  departmentCode:clean(draft.metadata.departmentCode),documentType:clean(draft.metadata.documentType),versionName:clean(draft.metadata.versionName),versionStream:clean(draft.metadata.versionStream),
  scope:{semester:clean(draft.metadata.scope.semester),audience:clean(draft.metadata.scope.audience),studentType:clean(draft.metadata.scope.studentType),programCode:clean(draft.metadata.scope.programCode),curriculumCode:clean(draft.metadata.scope.curriculumCode),cohort:draft.metadata.scope.cohort},
  sourceUrl:clean(draft.metadata.sourceUrl),sourcePageUrl:clean(draft.metadata.sourcePageUrl)},
  warningDispositions:draft.warningDispositions.map(item=>({...item,reason:clean(item.reason)}))};
}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null;}
function isReviewState(value:unknown):value is ImportReviewState{
 return isRecord(value)&&typeof value.jobId==='string'&&typeof value.jobRevision==='number'&&typeof value.extractionRevision==='number'&&
  typeof value.reviewRevision==='number'&&typeof value.stale==='boolean'&&Array.isArray(value.warnings)&&
  value.warnings.every(warning=>isRecord(warning)&&typeof warning.key==='string'&&typeof warning.code==='string'&&
   (warning.source==='PARSER'||warning.source==='ANALYSIS')&&(warning.severity==='BLOCKING'||warning.severity==='REVIEW')&&typeof warning.count==='number')&&
  (value.saved===null||(isRecord(value.saved)&&typeof value.saved.reviewRevision==='number'&&isRecord(value.saved.draft)));
}
async function request(url:string,init?:RequestInit):Promise<Result>{
 const response=await fetch(url,{...init,cache:'no-store',credentials:'same-origin'});
 return {response,body:await response.json().catch(()=>null)};
}
function apiError(result:Result){
 const code=isRecord(result.body)&&typeof result.body.error==='string'?result.body.error:'';
 if(result.response.status===409||code==='CONFLICT')return 'ข้อมูลฉบับนี้เปลี่ยนระหว่างตรวจ ร่างของคุณยังอยู่ โหลดฉบับล่าสุดก่อนเริ่มบันทึกต่อ';
 if(result.response.status===403)return 'บัญชีนี้ไม่มีสิทธิ์ตรวจเอกสารนำเข้า';
 if(result.response.status===404)return 'ไม่พบรายการตรวจนี้';
 if(code==='INVALID_REQUEST')return 'ข้อมูลบางช่องไม่ถูกต้อง ตรวจรูปแบบวันที่ URL และเหตุผลคำเตือนแล้วลองอีกครั้ง';
 return 'บันทึกร่างตรวจไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง';
}
function nullableText(value:string|null,onChange:(value:string|null)=>void,props:{maxLength?:number;placeholder?:string;disabled?:boolean;type?:string}={}){
 return <input type={props.type??'text'} value={value??''} maxLength={props.maxLength} placeholder={props.placeholder} disabled={props.disabled} onChange={event=>onChange(event.target.value===''?null:event.target.value)}/>;
}
function nullableSelect<T extends string>(value:T|null,options:readonly T[],label:(option:T)=>string,onChange:(value:T|null)=>void,disabled:boolean){
 return <select value={value??''} onChange={event=>onChange(event.target.value===''?null:event.target.value as T)} disabled={disabled}>
  <option value="">ยังไม่ระบุ</option>{options.map(option=><option key={option} value={option}>{label(option)}</option>)}
 </select>;
}
function draftFromState(state:ImportReviewState){
 const draft=state.saved?cloneDraft(state.saved.draft):emptyDraft(state.warnings);
 const savedDispositions=new Map(draft.warningDispositions.map(item=>[item.warningKey,item]));
 draft.warningDispositions=state.warnings.map(warning=>savedDispositions.get(warning.key)??{warningKey:warning.key,status:'UNRESOLVED',reason:null});
 return draft;
}
function warningLocation(location:ImportReviewState['warnings'][number]['location']):string|null{
 if(!location)return null;
 switch(location.kind){
  case 'PDF':return `PDF หน้า ${location.pageNumber} · ข้อความ ${location.blockStart}–${location.blockEnd}`;
  case 'DOCX':return `Word · ${location.headingPath.length?location.headingPath.join(' / '):'เนื้อหา'} · ช่วง ${location.blockStart}–${location.blockEnd}`;
  case 'XLSX':return `Excel ${location.sheetName} · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}`;
  case 'CSV':return `CSV · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}`;
  case 'HTML':return `HTML · ${location.headingPath.length?location.headingPath.join(' / '):'เนื้อหา'} · ช่วง ${location.blockStart}–${location.blockEnd}`;
 }
}

export default function ReviewForm({jobId,jobRevision,extractionRevision,refreshKey,parentPending,onDraftStateChange,onReloadPreview}:ReviewProps){
 const [review,setReview]=useState<ImportReviewState|null>(null);
 const [draft,setDraft]=useState<ImportReviewDraft|null>(null);
 const [baseline,setBaseline]=useState<ImportReviewDraft|null>(null);
 const [pending,setPending]=useState<'load'|'save'|null>(null);
 const [versionPending,setVersionPending]=useState(false);
 const [chunkPending,setChunkPending]=useState(false);
 const [publicationPending,setPublicationPending]=useState(false);
 const [publicationReceipt,setPublicationReceipt]=useState<ImportPublicationReceipt|null>(null);
 const [versionSelectionPending,setVersionSelectionPending]=useState(false);
 const [versionResetEpoch,setVersionResetEpoch]=useState(0);
 const [failure,setFailure]=useState('');
 const [notice,setNotice]=useState('');
 const [conflicted,setConflicted]=useState(false);
 const [revisionMismatch,setRevisionMismatch]=useState(false);
 const [reloadConfirm,setReloadConfirm]=useState(false);
 const [startedCurrent,setStartedCurrent]=useState(false);
 const [loadedKey,setLoadedKey]=useState<string|null>(null);
 const abortRef=useRef<AbortController|null>(null);
 const requestSerial=useRef(0);
 const mountedRef=useRef(false);

 const currentKey=`${jobId}:${jobRevision}:${extractionRevision}:${refreshKey}`;
 const resourceKeyRef=useRef(currentKey);
 const readyForKey=loadedKey===currentKey;
 const dirty=useMemo(()=>draft!==null&&baseline!==null&&JSON.stringify(draft)!==JSON.stringify(baseline),[draft,baseline]);
 const busy=pending!==null;
 const activityPending=busy||versionPending||chunkPending||publicationPending||versionSelectionPending||(!readyForKey&&!failure);
 const reviewLocked=publicationPending||publicationReceipt!==null;
 const approvalDisabled=parentPending||busy||versionPending||chunkPending||!readyForKey||conflicted||revisionMismatch||Boolean(review?.stale&&!startedCurrent);
 const disabled=approvalDisabled||reviewLocked;

 const setMutation=useCallback((updater:(current:ImportReviewDraft)=>ImportReviewDraft)=>{
  if(publicationPending||publicationReceipt)return;
  setDraft(current=>current?updater(current):current);setFailure('');setNotice('');
 },[publicationPending,publicationReceipt]);
 const updateMetadata=useCallback(<K extends keyof ImportReviewDraft['metadata']>(key:K,value:ImportReviewDraft['metadata'][K])=>{
  setMutation(current=>({...current,metadata:{...current.metadata,[key]:value}}));
 },[setMutation]);
 const updateScopeText=useCallback((key:Exclude<keyof ImportReviewDraft['metadata']['scope'],'cohort'>,value:string|null)=>{
  setMutation(current=>({...current,metadata:{...current.metadata,scope:{...current.metadata.scope,[key]:value}}}));
 },[setMutation]);
 const updateCohort=useCallback((value:number|null)=>{
  setMutation(current=>({...current,metadata:{...current.metadata,scope:{...current.metadata.scope,cohort:value}}}));
 },[setMutation]);
 const onVersionSelection=useCallback((selection:'NEW_FAMILY'|'ADD_ADDITIONAL'|'ADD_HISTORICAL'|'REPLACE_CURRENT'|'AMEND_EXISTING'|'CANCELS',candidate:VersionCandidate|null)=>{
  setMutation(current=>({...current,action:selection==='CANCELS'?'ADD_ADDITIONAL':selection,target:candidate?{documentId:candidate.documentId,revision:candidate.revision}:null,
   relationship:selection==='CANCELS'&&candidate?'CANCELS':null,
   metadata:{...current.metadata,newFamily:selection==='NEW_FAMILY'?current.metadata.newFamily:null}}));
 },[setMutation]);
 const clearVersionSelection=useCallback(()=>{
  setMutation(current=>({...current,action:null,target:null,relationship:null,metadata:{...current.metadata,newFamily:null}}));
 },[setMutation]);
 const onVersionPendingChange=useCallback((value:boolean)=>setVersionPending(value),[]);
 const onChunkPendingChange=useCallback((value:boolean)=>setChunkPending(value),[]);
 const onChunkDigestChange=useCallback((digest:string|null)=>{
  setMutation(current=>({...current,schemaVersion:2,chunkPlan:digest===null?null:{digest,chunkerVersion:'located-e5-v1'}}));
 },[setMutation]);

 const load=useCallback(async(signal?:AbortSignal)=>{
  const serial=++requestSerial.current;abortRef.current?.abort();
  const controller=signal?null:new AbortController();if(controller)abortRef.current=controller;
  const activeSignal=signal??controller?.signal;setPending('load');setFailure('');setNotice('');
  try{
   const result=await request(`/api/knowledge/imports/${encodeURIComponent(jobId)}/review`,{signal:activeSignal});
   if(serial!==requestSerial.current||activeSignal?.aborted)return false;
   const next=isRecord(result.body)&&isReviewState(result.body.review)?result.body.review:null;
   if(!result.response.ok||!next){setFailure(apiError(result));return false;}
   if(next.jobId!==jobId||next.jobRevision!==jobRevision||next.extractionRevision!==extractionRevision){
    setConflicted(false);setRevisionMismatch(true);setFailure('ข้อมูลตรวจล่าสุดผูกกับฉบับเอกสารอื่น โหลดข้อความและคำเตือนฉบับล่าสุดก่อนทำต่อ');return false;
   }
   setReview(next);const nextDraft=draftFromState(next);setDraft(nextDraft);setBaseline(cloneDraft(nextDraft));setLoadedKey(currentKey);setConflicted(false);setReloadConfirm(false);
   setVersionResetEpoch(value=>value+1);setVersionSelectionPending(false);setVersionPending(false);
   setStartedCurrent(!next.stale);setRevisionMismatch(false);return true;
  }catch{if(activeSignal?.aborted)return false;setFailure('เชื่อมต่อข้อมูลตรวจไม่ได้ ลองโหลดรายการอีกครั้ง');return false;}
  finally{if(serial===requestSerial.current)setPending(null);}
 },[currentKey,jobId,jobRevision,extractionRevision]);

 useEffect(()=>{
  const controller=new AbortController();
  resourceKeyRef.current=currentKey;
  const launch=setTimeout(()=>{void load(controller.signal);},0);
  mountedRef.current=true;
  return()=>{clearTimeout(launch);controller.abort();abortRef.current?.abort();mountedRef.current=false;};
 },[currentKey,jobId,jobRevision,extractionRevision,refreshKey,load]);
 useEffect(()=>{onDraftStateChange(dirty,activityPending,publicationReceipt?.jobId??null);},[dirty,activityPending,publicationReceipt,onDraftStateChange]);

 function handleStartCurrent(){
  if(!review||reviewLocked)return;
  if(dirty&&!window.confirm('เริ่มตรวจจากฉบับปัจจุบันและทิ้งร่างในเครื่องหรือไม่? ใบตรวจที่บันทึกไว้จะยังคงอยู่ในประวัติ'))return;
  const next=emptyDraft(review.warnings);
  if(review.saved){next.action=review.saved.draft.action;next.target=review.saved.draft.target;next.relationship=review.saved.draft.relationship;
   next.metadata={...review.saved.draft.metadata};}
  setDraft(next);setBaseline(cloneDraft(review.saved?.draft??emptyDraft(review.warnings)));setStartedCurrent(true);setConflicted(false);setFailure('');setNotice('เริ่มร่างตรวจสำหรับฉบับปัจจุบันแล้ว ทุกคำยืนยันและคำเตือนกลับเป็นสถานะที่ยังไม่ตรวจ');
  setVersionResetEpoch(value=>value+1);setVersionSelectionPending(false);setVersionPending(false);
 }
 async function save(){
  if(!review||!draft||disabled||versionSelectionPending||!dirty)return;
  const prepared=normalizeDraft(draft);
  if(prepared.warningDispositions.some(item=>item.status!=='UNRESOLVED'&&!item.reason?.trim())){
   setFailure('ระบุเหตุผลให้ครบสำหรับคำเตือนที่เลือก “แก้ไขแล้ว” หรือ “ผลบวกลวง”');return;
  }
  const serial=++requestSerial.current;const saveKey=currentKey;
  setPending('save');setFailure('');setNotice('');
  try{
   const result=await request(`/api/knowledge/imports/${encodeURIComponent(jobId)}/review`,{method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedJobRevision:review.jobRevision,expectedExtractionRevision:review.extractionRevision,expectedReviewRevision:review.reviewRevision,draft:prepared})});
   if(!mountedRef.current||serial!==requestSerial.current||resourceKeyRef.current!==saveKey)return;
   const next=isRecord(result.body)&&isReviewState(result.body.review)?result.body.review:null;
   if(next&&(next.jobId!==jobId||next.jobRevision!==jobRevision||next.extractionRevision!==extractionRevision)){
    setConflicted(false);setRevisionMismatch(true);setFailure('ข้อมูลตรวจล่าสุดผูกกับฉบับเอกสารอื่น ร่างของคุณยังอยู่ โหลดข้อความและคำเตือนฉบับล่าสุดก่อนทำต่อ');return;
   }
   if(!result.response.ok||!next){if(result.response.status===409)setConflicted(true);setFailure(apiError(result));return;}
   setReview(next);const nextDraft=draftFromState(next);setDraft(nextDraft);setBaseline(cloneDraft(nextDraft));setLoadedKey(currentKey);setConflicted(false);setRevisionMismatch(false);setStartedCurrent(!next.stale);
   setVersionResetEpoch(value=>value+1);setVersionSelectionPending(false);setVersionPending(false);
   setNotice('บันทึกร่างตรวจส่วนตัวแล้ว ยังไม่อนุมัติและยังไม่เผยแพร่');
  }catch{if(mountedRef.current&&serial===requestSerial.current&&resourceKeyRef.current===saveKey)setFailure('เชื่อมต่อระบบไม่ได้ ร่างตรวจยังอยู่ครบ ลองบันทึกอีกครั้ง');}
  finally{if(mountedRef.current&&serial===requestSerial.current&&resourceKeyRef.current===saveKey)setPending(null);}
 }
 async function reloadLatest(discardConfirmed:boolean){
  if(reviewLocked)return;
  if(!discardConfirmed){setReloadConfirm(true);return;}
  const loaded=await load();if(loaded)setNotice('โหลดร่างตรวจฉบับล่าสุดแล้ว');
 }
 async function resetToSaved(){
  if(reviewLocked)return;
  if(!window.confirm('ทิ้งร่างตรวจในเครื่องและโหลดข้อมูลที่บันทึกล่าสุดหรือไม่?'))return;
  const loaded=await load();if(loaded)setNotice('ทิ้งร่างในเครื่องแล้ว โหลดข้อมูลตรวจฉบับล่าสุดเรียบร้อย');
 }

 function setWarning(key:string,status:ReviewStatus){
  setMutation(current=>({...current,warningDispositions:current.warningDispositions.map(item=>item.warningKey===key?{...item,status,reason:status==='UNRESOLVED'?null:item.reason}:item)}));
 }
 function setWarningReason(key:string,reason:string|null){
  setMutation(current=>({...current,warningDispositions:current.warningDispositions.map(item=>item.warningKey===key?{...item,reason:reason===null||reason===''?null:reason}:item)}));
 }
 function setAttestation(key:keyof ImportReviewDraft['attestations'],value:boolean){
  setMutation(current=>({...current,attestations:{...current.attestations,[key]:value}}));
 }

 return <section className="knowledge-review" aria-labelledby="review-draft-title">
  <header className="knowledge-review-heading"><div><h3 id="review-draft-title">ทบทวนข้อมูลเอกสาร</h3><p>{publicationReceipt?'อนุมัติฉบับตรวจที่ระบุในใบรับรองแล้ว ข้อมูลที่แสดงเปิดให้อ่านเพื่อตรวจสอบย้อนหลัง':'บันทึกร่างส่วนตัวได้ก่อนครบการตรวจ เมื่อตรวจครบแล้วจึงยืนยันอนุมัติด้านล่าง'}</p></div>
   {review&&<span className="knowledge-review-counter">ฉบับตรวจ {review.reviewRevision}</span>}
  </header>
  {(!readyForKey||pending==='load')&&<p className="knowledge-loading" role="status" aria-live="polite">กำลังโหลดร่างตรวจส่วนตัว…</p>}
  {failure&&!readyForKey&&!revisionMismatch&&<div className="knowledge-review-conflict" role="alert"><p>{failure}</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void load()} disabled={busy||parentPending}>โหลดข้อมูลตรวจอีกครั้ง</button></div>}
  {revisionMismatch&&<div className="knowledge-review-conflict" role="alert"><p>{failure||'ข้อมูลตรวจผูกกับฉบับเอกสารอื่น โหลดตัวอย่างฉบับล่าสุดก่อนทำต่อ'}</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={onReloadPreview} disabled={busy||parentPending}>โหลดข้อความและคำเตือนฉบับล่าสุด</button></div>}
  {readyForKey&&review?.stale&&<div className="knowledge-review-stale" role="status"><strong>ร่างที่บันทึกไว้ผูกกับฉบับก่อนหน้า</strong><p>ข้อมูลเดิมยังเก็บในประวัติ แต่คำยืนยันและคำเตือนไม่ได้ย้ายมาใช้กับฉบับนี้</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={handleStartCurrent} disabled={busy||parentPending}>เริ่มตรวจฉบับปัจจุบัน</button></div>}
  {readyForKey&&conflicted&&<div className="knowledge-review-conflict" role="alert"><p>มีร่างอื่นบันทึกไว้หลังจากเปิดหน้านี้ ร่างของคุณยังอยู่และบันทึกต่อไม่ได้</p>
   <div className="knowledge-review-actions"><button type="button" className="knowledge-button knowledge-button-secondary" onClick={resetToSaved} disabled={busy||parentPending}>ทิ้งร่างในเครื่องและใช้ฉบับที่บันทึกแล้ว</button>
    <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>void reloadLatest(false)} disabled={busy||parentPending}>โหลดฉบับล่าสุด</button></div>
  </div>}
  {readyForKey&&reloadConfirm&&<div className="knowledge-review-confirm" role="alert"><p>โหลดฉบับล่าสุดจะทิ้งร่างในเครื่องที่ยังไม่ได้บันทึก</p><div className="knowledge-review-actions">
   <button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void reloadLatest(true)} disabled={busy||parentPending}>ยืนยันโหลดและทิ้งร่าง</button>
   <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setReloadConfirm(false)} disabled={busy||parentPending}>กลับไปเก็บร่างนี้</button></div></div>}
  {readyForKey&&review&&draft&&<>
   <p className="knowledge-review-state" role="status">{review.saved?`บันทึกฉบับตรวจ ${review.saved.reviewRevision} เมื่อ ${new Date(review.saved.createdAt).toLocaleString('th-TH')}`:'ยังไม่มีร่างตรวจที่บันทึก'} · {review.stale&&!startedCurrent?'ฉบับตรวจเดิมล้าสมัย':dirty?'มีการแก้ไขที่ยังไม่บันทึก':'ไม่มีการแก้ไขค้าง'} · ยังคงเป็นข้อมูลส่วนตัว</p>
   <p className="knowledge-review-pending">{versionSelectionPending?'กำลังตรวจยืนยันตัวเลือกฉบับ เลือกเป้าหมายหรือยกเลิกตัวเลือกก่อนบันทึก':<>การดำเนินการฉบับถัดไป: {draft.action?actionLabels[draft.action]??'มีตัวเลือกที่บันทึกไว้':'ยังไม่ได้เลือกการดำเนินการ'}
    {draft.target?` · มีเป้าหมายที่บันทึกไว้สำหรับตรวจยืนยัน`:draft.action==='REPLACE_CURRENT'||draft.action==='AMEND_EXISTING'||draft.relationship==='CANCELS'?' · ยังไม่ได้เลือกเป้าหมาย':' · ไม่มีเป้าหมายที่เลือก'}{draft.relationship==='CANCELS'?' · ความสัมพันธ์ยกเลิกเอกสารเดิม':''}</>}{publicationReceipt?' · ดูผลที่ใบรับรองด้านล่าง':' · บันทึกตัวเลือกและตรวจหลักฐานให้ครบก่อนอนุมัติ'}</p>
   <VersionPanel key={`${jobId}:${jobRevision}:${extractionRevision}:${review.reviewRevision}:${versionResetEpoch}:${JSON.stringify(draft.metadata)}`} jobId={jobId} jobRevision={jobRevision} extractionRevision={extractionRevision} reviewRevision={review.reviewRevision} saved={Boolean(review.saved&&!review.stale)}
    metadata={draft.metadata} baselineMetadata={baseline?.metadata??draft.metadata} action={draft.action} target={draft.target} relationship={draft.relationship}
    disabled={disabled} onSelect={onVersionSelection} onClear={clearVersionSelection} onReloadPreview={onReloadPreview} onPendingChange={onVersionPendingChange} onSelectionPendingChange={setVersionSelectionPending}/>
   <ChunkPlanPanel key={`chunks:${jobId}:${jobRevision}:${extractionRevision}:${review.reviewRevision}:${versionResetEpoch}`}
    jobId={jobId} jobRevision={jobRevision} extractionRevision={extractionRevision} reviewRevision={review.reviewRevision}
    saved={Boolean(review.saved&&!review.stale&&!dirty)} disabled={disabled||versionSelectionPending}
    acknowledgedDigest={draft.schemaVersion===2?draft.chunkPlan?.digest??null:null} onDigestChange={onChunkDigestChange} onPendingChange={onChunkPendingChange}/>
   <fieldset className="knowledge-review-fields" disabled={disabled}><legend>ข้อมูลร่างตรวจ</legend>
    <details open><summary>ข้อมูลและขอบเขตเอกสาร</summary><div className="knowledge-review-grid">
     <label className="knowledge-field">ชื่อเอกสาร{nullableText(draft.metadata.title,value=>updateMetadata('title',value),{maxLength:500,disabled})}</label>
     <label className="knowledge-field">รหัสกลุ่มเอกสาร{nullableText(draft.metadata.familyCode,value=>updateMetadata('familyCode',value),{maxLength:80,placeholder:'เช่น REGISTRATION',disabled})}<span className="knowledge-hint">ใช้ตัวพิมพ์ใหญ่และขีดล่าง เช่น REGISTRATION</span></label>
     <label className="knowledge-field">หน่วยงาน{nullableText(draft.metadata.departmentCode,value=>updateMetadata('departmentCode',value),{maxLength:80,placeholder:'เช่น REGISTRAR',disabled})}</label>
     <label className="knowledge-field">ประเภทเอกสาร{nullableText(draft.metadata.documentType,value=>updateMetadata('documentType',value),{maxLength:80,disabled})}</label>
     <label className="knowledge-field">ชื่อฉบับ{nullableText(draft.metadata.versionName,value=>updateMetadata('versionName',value),{maxLength:200,disabled})}</label>
     <label className="knowledge-field">สายฉบับ{nullableText(draft.metadata.versionStream,value=>updateMetadata('versionStream',value),{maxLength:120,disabled})}</label>
     <label className="knowledge-field">ปีการศึกษา<input type="number" min="2400" max="3000" step="1" value={draft.metadata.academicYear??''} disabled={disabled} onChange={event=>updateMetadata('academicYear',event.target.value===''?null:Number(event.target.value))}/></label>
     <label className="knowledge-field">ภาคเรียน{nullableText(draft.metadata.scope.semester,value=>updateScopeText('semester',value),{maxLength:40,disabled})}</label>
     <label className="knowledge-field">กลุ่มผู้ใช้{nullableText(draft.metadata.scope.audience,value=>updateScopeText('audience',value),{maxLength:80,disabled})}</label>
     <label className="knowledge-field">ประเภทนักศึกษา{nullableText(draft.metadata.scope.studentType,value=>updateScopeText('studentType',value),{maxLength:80,disabled})}</label>
     <label className="knowledge-field">รหัสหลักสูตร{nullableText(draft.metadata.scope.programCode,value=>updateScopeText('programCode',value),{maxLength:80,disabled})}</label>
     <label className="knowledge-field">รหัสหลักสูตร/แผน{nullableText(draft.metadata.scope.curriculumCode,value=>updateScopeText('curriculumCode',value),{maxLength:80,disabled})}</label>
     <label className="knowledge-field">รุ่นนักศึกษา<input type="number" min="2400" max="3000" step="1" value={draft.metadata.scope.cohort??''} disabled={disabled} onChange={event=>updateCohort(event.target.value===''?null:Number(event.target.value))}/></label>
    </div></details>
    <details><summary>วันที่และระดับอำนาจเอกสาร</summary><div className="knowledge-review-grid">
     <label className="knowledge-field">วันที่ประกาศ<input type="date" value={draft.metadata.publishedAt??''} disabled={disabled} onChange={event=>updateMetadata('publishedAt',event.target.value||null)}/></label>
     <label className="knowledge-field">วันที่เริ่มมีผล<input type="date" value={draft.metadata.effectiveFrom??''} disabled={disabled} onChange={event=>updateMetadata('effectiveFrom',event.target.value||null)}/></label>
     <label className="knowledge-field">วันที่สิ้นผล<input type="date" value={draft.metadata.effectiveTo??''} disabled={disabled} onChange={event=>updateMetadata('effectiveTo',event.target.value||null)}/></label>
     <label className="knowledge-field">ระดับอำนาจเอกสาร<input type="number" min="0" max="100" step="1" value={draft.metadata.authorityLevel??''} disabled={disabled} onChange={event=>updateMetadata('authorityLevel',event.target.value===''?null:Number(event.target.value))}/></label>
    </div><p className="knowledge-hint">กรอกตามหลักฐานต้นฉบับเท่านั้น ช่องว่างหมายถึงยังไม่ได้ตรวจ</p></details>
    <details><summary>แหล่งอ้างอิงและการใช้ข้อมูล</summary><div className="knowledge-review-grid">
     <label className="knowledge-field">URL แหล่งที่มาอย่างเป็นทางการ{nullableText(draft.metadata.sourceUrl,value=>updateMetadata('sourceUrl',value),{type:'url',maxLength:2000,placeholder:'https://…',disabled})}</label>
     <label className="knowledge-field">URL หน้าต้นฉบับ{nullableText(draft.metadata.sourcePageUrl,value=>updateMetadata('sourcePageUrl',value),{type:'url',maxLength:2000,placeholder:'https://…',disabled})}</label>
     <label className="knowledge-field">ระดับการมองเห็น{nullableSelect(draft.metadata.visibility,['PUBLIC','INTERNAL','RESTRICTED'] as const,value=>value==='PUBLIC'?'สาธารณะ':value==='INTERNAL'?'ภายใน':'จำกัด',value=>updateMetadata('visibility',value),disabled)}</label>
     <label className="knowledge-field">รูปแบบการจัดเก็บ{nullableSelect(draft.metadata.storageMode,storageModes,value=>value,value=>updateMetadata('storageMode',value),disabled)}</label>
     <label className="knowledge-field">ชุดข้อมูล{nullableSelect(draft.metadata.datasetType,datasetTypes,value=>datasetLabels[value],value=>updateMetadata('datasetType',value),disabled)}</label>
    </div><p className="knowledge-hint">ชุดข้อมูลคงตัวเลือกที่บันทึกไว้ แม้ตัวเชื่อมระบบจะยังไม่พร้อม การเผยแพร่ต้องผ่านการตรวจภายหลัง</p></details>
    <details><summary>ครอบครัวเอกสารใหม่</summary>
     {draft.action==='NEW_FAMILY'?<div className="knowledge-review-grid">
      <label className="knowledge-field">ชื่อครอบครัวใหม่{nullableText(draft.metadata.newFamily?.name??null,value=>updateMetadata('newFamily',value===null&&draft.metadata.newFamily===null?null:{name:value,category:draft.metadata.newFamily?.category??null}),{maxLength:200,disabled})}</label>
      <label className="knowledge-field">หมวดครอบครัวใหม่{nullableText(draft.metadata.newFamily?.category??null,value=>updateMetadata('newFamily',value===null&&draft.metadata.newFamily===null?null:{name:draft.metadata.newFamily?.name??null,category:value}),{maxLength:80,disabled})}</label>
     </div>:<p className="knowledge-hint">การเลือกครอบครัวใหม่รอขั้นตอนจัดการฉบับ กรอกได้เมื่อร่างที่บันทึกไว้เลือก “เริ่มกลุ่มเอกสารใหม่”</p>}
    </details>
    <details><summary>คำเตือนที่ต้องพิจารณา <span>({review.warnings.length})</span></summary>
     {review.warnings.length===0?<p className="knowledge-hint">ไม่มีคำเตือนที่ผูกกับฉบับนี้</p>:<ul className="knowledge-review-warnings">{review.warnings.map(warning=>{
      const disposition=draft.warningDispositions.find(item=>item.warningKey===warning.key);if(!disposition)return null;
      const title=warningLabels[warning.code]??'คำเตือนจากตัวอ่าน';
      return <li key={warning.key}><div className="knowledge-review-warning-heading"><strong>{title}</strong><span>{warning.severity==='BLOCKING'?'ต้องแก้ก่อนอนุมัติ':'ต้องตรวจ'} · {warning.source==='PARSER'?'ตัวอ่าน':'ตัววิเคราะห์'} · {warning.count} จุด</span></div>
       {warningLocation(warning.location)&&<p className="knowledge-review-warning-location">{warningLocation(warning.location)}</p>}
       <label className="knowledge-field">ผลการพิจารณา<select value={disposition.status} disabled={disabled} onChange={event=>setWarning(warning.key,event.target.value as ReviewStatus)}><option value="UNRESOLVED">ยังไม่ตัดสินใจ</option><option value="CORRECTED">แก้ไขแล้ว</option><option value="FALSE_POSITIVE">ผลบวกลวง</option></select></label>
       {disposition.status!=='UNRESOLVED'&&<label className="knowledge-field">เหตุผลประกอบ{nullableText(disposition.reason,value=>setWarningReason(warning.key,value),{maxLength:500,placeholder:'ระบุหลักฐานหรือสิ่งที่แก้ไข',disabled})}</label>}
       <p className="knowledge-hint">การบันทึกผลพิจารณาไม่ลบคำเตือนและไม่อนุมัติเอกสาร</p>
      </li>;
     })}</ul>}
    </details>
    <details><summary>คำยืนยันก่อนตรวจต่อ</summary><p className="knowledge-hint">ทุกข้อเริ่มต้นเป็น “ยังไม่ยืนยัน” และต้องเลือกเองจากการตรวจหลักฐาน</p>
     <div className="knowledge-review-attestations">
      <label><input type="checkbox" checked={draft.attestations.sourceAuthorityReviewed} disabled={disabled} onChange={event=>setAttestation('sourceAuthorityReviewed',event.target.checked)}/>ตรวจสอบหน่วยงานและแหล่งที่มาจากหลักฐานแล้ว</label>
      <label><input type="checkbox" checked={draft.attestations.extractionReviewed} disabled={disabled} onChange={event=>setAttestation('extractionReviewed',event.target.checked)}/>ตรวจข้อความและตำแหน่งที่อ่านได้แล้ว</label>
      <label><input type="checkbox" checked={draft.attestations.applicabilityReviewed} disabled={disabled} onChange={event=>setAttestation('applicabilityReviewed',event.target.checked)}/>ตรวจขอบเขตผู้ใช้และการใช้บังคับแล้ว</label>
      <label><input type="checkbox" checked={draft.attestations.sensitivityReviewed} disabled={disabled} onChange={event=>setAttestation('sensitivityReviewed',event.target.checked)}/>ตรวจความละเอียดอ่อนของข้อมูลแล้ว</label>
      <label><input type="checkbox" checked={draft.attestations.versionReviewed} disabled={disabled} onChange={event=>setAttestation('versionReviewed',event.target.checked)}/>ตรวจความสัมพันธ์และสายฉบับแล้ว</label>
     </div>
    </details>
   </fieldset>
   {failure&&<p className="knowledge-message knowledge-message-error" role="alert">{failure}</p>}
   {notice&&<p className="knowledge-message knowledge-message-success" role="status" aria-live="polite">{notice}</p>}
   <footer className="knowledge-review-footer"><p>{publicationReceipt?'ฉบับที่อนุมัติและต้นฉบับเก็บไว้ตรวจสอบย้อนหลังแล้ว':review.saved?'ร่างล่าสุดบันทึกแล้ว · รอการยืนยันอนุมัติ':'ร่างใหม่ยังไม่บันทึก · ข้อมูลไม่ครบสามารถบันทึกไว้ตรวจต่อได้'}</p>
    <div className="knowledge-review-actions">{dirty&&<button type="button" className="knowledge-button knowledge-button-tertiary" onClick={resetToSaved} disabled={busy||parentPending||reviewLocked}>ทิ้งการแก้ไขในเครื่อง</button>}
     <button type="button" className="knowledge-button knowledge-button-primary" onClick={()=>void save()} disabled={!dirty||disabled||versionSelectionPending}>{pending==='save'?'กำลังบันทึก…':'บันทึกร่างส่วนตัว'}</button>
    </div>
   </footer>
   <ApprovalPanel review={review} dirty={dirty} disabled={approvalDisabled||versionSelectionPending}
    onPendingChange={setPublicationPending} onReceiptChange={setPublicationReceipt}/>
  </>}
 </section>;
}
