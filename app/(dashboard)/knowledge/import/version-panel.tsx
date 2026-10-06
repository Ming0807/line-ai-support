'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ImportVersionResolution} from '@/lib/imports/version-resolver';
import type {VersionCandidate,VersionTargetAction} from '@/lib/imports/version-candidates';
import type {ImportReviewDraft} from '@/lib/imports/review-schema';

type Selection='NEW_FAMILY'|'ADD_ADDITIONAL'|'ADD_HISTORICAL'|'REPLACE_CURRENT'|'AMEND_EXISTING'|'CANCELS';
type VersionPanelProps={
 jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number;saved:boolean;
 metadata:ImportReviewDraft['metadata'];baselineMetadata:ImportReviewDraft['metadata'];
 action:ImportReviewDraft['action'];target:ImportReviewDraft['target'];relationship:ImportReviewDraft['relationship'];
 disabled:boolean;onSelect:(selection:Selection,target:VersionCandidate|null)=>void;onClear:()=>void;onReloadPreview:()=>void;
 onPendingChange:(pending:boolean)=>void;onSelectionPendingChange:(pending:boolean)=>void;
};
const actionNames:Record<Selection,string>={NEW_FAMILY:'เริ่มกลุ่มเอกสารใหม่',ADD_ADDITIONAL:'เพิ่มเอกสารเพิ่มเติม',ADD_HISTORICAL:'เพิ่มฉบับย้อนหลัง',REPLACE_CURRENT:'แทนฉบับปัจจุบัน',AMEND_EXISTING:'เอกสารแก้ไขเพิ่มเติม',CANCELS:'ยกเลิกเอกสารเดิม'};
const missingNames:Record<string,string>={familyCode:'รหัสกลุ่มเอกสาร',departmentCode:'หน่วยงาน',documentType:'ประเภทเอกสาร',versionStream:'สายฉบับ',audience:'กลุ่มผู้ใช้',studentType:'ประเภทนักศึกษา'};
const statusNames:Record<string,string>={ACTIVE:'ใช้งาน',SUPERSEDED:'มีฉบับใหม่กว่า',EXPIRED:'สิ้นผล'};
const documentStatuses=['DRAFT','PENDING_REVIEW','ACTIVE','SUPERSEDED','EXPIRED','ARCHIVED','REJECTED'] as const;
const targetActions:Record<Exclude<Selection,'NEW_FAMILY'|'ADD_ADDITIONAL'|'ADD_HISTORICAL'>,VersionTargetAction>={REPLACE_CURRENT:'REPLACE_CURRENT',AMEND_EXISTING:'AMEND_EXISTING',CANCELS:'CANCELS'};
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null;}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]){return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function isCandidate(value:unknown):value is VersionCandidate{
 if(!isRecord(value)||!isRecord(value.scope)||!exactKeys(value,['documentId','revision','title','departmentCode','documentType','versionName','versionStream','academicYear','scope','status','isCurrent','approved','isAmendment','isCancellation','effectiveFrom','effectiveTo','matchingScope','targetActions'])||!exactKeys(value.scope,['semester','audience','studentType','programCode','curriculumCode','cohort'])||typeof value.documentId!=='string'||typeof value.revision!=='number'||!Number.isInteger(value.revision)||typeof value.title!=='string'||typeof value.departmentCode!=='string'&&value.departmentCode!==null||typeof value.documentType!=='string'||typeof value.versionName!=='string'||typeof value.versionStream!=='string'||!documentStatuses.includes(value.status as typeof documentStatuses[number])||typeof value.isCurrent!=='boolean'||typeof value.approved!=='boolean'||typeof value.isAmendment!=='boolean'||typeof value.isCancellation!=='boolean'||typeof value.matchingScope!=='boolean'||!Array.isArray(value.targetActions))return false;
 const scope=value.scope;
 return value.targetActions.every(item=>item==='REPLACE_CURRENT'||item==='AMEND_EXISTING'||item==='CANCELS')&&
  (value.academicYear===null||typeof value.academicYear==='number')&&(value.effectiveFrom===null||typeof value.effectiveFrom==='string')&&(value.effectiveTo===null||typeof value.effectiveTo==='string')&&
  ['semester','programCode','curriculumCode'].every(key=>typeof scope[key]==='string'||scope[key]===null)&&
  (typeof scope.audience==='string'||scope.audience===null)&&(typeof scope.studentType==='string'||scope.studentType===null)&&
  (typeof scope.cohort==='number'||scope.cohort===null);
}
function isResolution(value:unknown):value is ImportVersionResolution{
 if(!isRecord(value)||!exactKeys(value,['jobId','jobRevision','extractionRevision','reviewRevision','family','missingMetadata','availableActions','candidates','limitExceeded','currentStreamOccupied'])||typeof value.jobId!=='string'||typeof value.jobRevision!=='number'||typeof value.extractionRevision!=='number'||typeof value.reviewRevision!=='number'||!Array.isArray(value.missingMetadata)||!Array.isArray(value.availableActions)||!Array.isArray(value.candidates)||typeof value.limitExceeded!=='boolean'||typeof value.currentStreamOccupied!=='boolean')return false;
 if(value.family!==null&&(!isRecord(value.family)||!exactKeys(value.family,['id','code','name','category'])||typeof value.family.id!=='string'||typeof value.family.code!=='string'||typeof value.family.name!=='string'||typeof value.family.category!=='string'))return false;
 return value.missingMetadata.every(item=>typeof item==='string')&&value.availableActions.every(item=>item==='NEW_FAMILY'||item==='ADD_ADDITIONAL'||item==='ADD_HISTORICAL')&&value.candidates.every(isCandidate);
}
function targetSummary(candidate:VersionCandidate){
 const scope=[candidate.scope.semester&&`ภาค ${candidate.scope.semester}`,candidate.scope.audience,candidate.scope.studentType,candidate.scope.programCode&&`หลักสูตร ${candidate.scope.programCode}`,candidate.scope.curriculumCode&&`แผน ${candidate.scope.curriculumCode}`,candidate.scope.cohort&&`รุ่น ${candidate.scope.cohort}`].filter(Boolean).join(' · ');
 return [candidate.title,candidate.versionName,candidate.academicYear===null?'ไม่ระบุปี':`ปี ${candidate.academicYear}`,scope||'ขอบเขตทั่วไป',candidate.effectiveFrom&&`เริ่ม ${candidate.effectiveFrom}`,candidate.effectiveTo&&`สิ้นสุด ${candidate.effectiveTo}`,statusNames[candidate.status]??candidate.status,candidate.isCurrent?'ฉบับปัจจุบัน':null].filter(Boolean).join(' · ');
}
function selectedIntent(action:ImportReviewDraft['action'],relationship:ImportReviewDraft['relationship']):Selection|null{
 if(relationship==='CANCELS')return 'CANCELS';return action;
}
function resolutionKeepsSelection(resolution:ImportVersionResolution,action:ImportReviewDraft['action'],target:ImportReviewDraft['target'],relationship:ImportReviewDraft['relationship']):boolean{
 const intent=selectedIntent(action,relationship);if(!intent)return true;
 if(intent==='REPLACE_CURRENT'||intent==='AMEND_EXISTING'||intent==='CANCELS'){
  const required=targetActions[intent];return target!==null&&resolution.candidates.some(candidate=>candidate.documentId===target.documentId&&candidate.revision===target.revision&&candidate.targetActions.includes(required));
 }
 if(intent==='NEW_FAMILY'||intent==='ADD_ADDITIONAL'||intent==='ADD_HISTORICAL')return resolution.availableActions.includes(intent)&&target===null&&relationship===null;
 return false;
}

export default function VersionPanel(props:VersionPanelProps){
 const {jobId,jobRevision,extractionRevision,reviewRevision,saved,metadata,baselineMetadata,action,target,relationship,disabled,onSelect,onClear,onReloadPreview,onPendingChange,onSelectionPendingChange}=props;
 const metadataStable=useMemo(()=>JSON.stringify(metadata)===JSON.stringify(baselineMetadata),[metadata,baselineMetadata]);
 const lookupAllowed=saved&&metadataStable&&!disabled;
 const tuple=`${jobId}:${jobRevision}:${extractionRevision}:${reviewRevision}`;
 const [resolution,setResolution]=useState<ImportVersionResolution|null>(null);
 const [intentOverride,setIntentOverride]=useState<Selection|null>(null);
 const [targetChoicePending,setTargetChoicePending]=useState(false);
 const [loadedTuple,setLoadedTuple]=useState<string|null>(null);
 const [pending,setPending]=useState(false);
 const [failure,setFailure]=useState('');
 const serial=useRef(0);const abort=useRef<AbortController|null>(null);const mounted=useRef(false);const keyRef=useRef(tuple);
 const busy=pending;

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();onPendingChange(false);onSelectionPendingChange(false);};},[onPendingChange,onSelectionPendingChange]);

 const lookup=useCallback(async()=>{
  if(!lookupAllowed)return;
  const requestSerial=++serial.current;const requestKey=tuple;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  setPending(true);onPendingChange(true);setFailure('');setResolution(null);setLoadedTuple(null);
  try{
   const query=new URLSearchParams({expectedJobRevision:String(jobRevision),expectedExtractionRevision:String(extractionRevision),expectedReviewRevision:String(reviewRevision)});
   const response=await fetch(`/api/knowledge/imports/${encodeURIComponent(jobId)}/versions?${query}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
   const body:unknown=await response.json().catch(()=>null);
   if(!mounted.current||controller.signal.aborted||requestSerial!==serial.current||keyRef.current!==requestKey)return;
   const next=isRecord(body)&&isResolution(body.resolution)?body.resolution:null;
   if(response.status===409){setResolution(null);setLoadedTuple(null);setFailure('ข้อมูลฉบับหรือร่างตรวจเปลี่ยนแล้ว ร่างในหน้านี้ยังอยู่ โหลดข้อมูลล่าสุดผ่านปุ่มด้านล่าง หรือจะลองตรวจอีกครั้งก็ได้');return;}
   if(response.status===401||response.status===403){setFailure('บัญชีนี้ไม่มีสิทธิ์ตรวจรุ่นเอกสาร หรือหมดเวลาใช้งาน กรุณาเข้าสู่ระบบใหม่');return;}
   if(!response.ok||!next){setFailure(response.status===404?'ไม่พบรายการตรวจนี้':'ตรวจรุ่นเอกสารไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง');return;}
   if(next.jobId!==jobId||next.jobRevision!==jobRevision||next.extractionRevision!==extractionRevision||next.reviewRevision!==reviewRevision){setFailure('ผลตรวจผูกกับฉบับตรวจอื่น จึงยังใช้เลือกการดำเนินการไม่ได้');return;}
   setResolution(next);setLoadedTuple(tuple);
   const locallyChoosingTarget=targetChoicePending&&intentOverride!==null;
   onSelectionPendingChange(locallyChoosingTarget||!resolutionKeepsSelection(next,action,target,relationship));
  }catch{if(!controller.signal.aborted&&mounted.current&&requestSerial===serial.current&&keyRef.current===requestKey)setFailure('ตรวจรุ่นเอกสารไม่สำเร็จ ร่างตรวจยังอยู่ ลองตรวจอีกครั้ง');}
  finally{if(mounted.current&&requestSerial===serial.current&&keyRef.current===requestKey){setPending(false);onPendingChange(false);}}
 },[action,extractionRevision,intentOverride,jobId,jobRevision,lookupAllowed,onPendingChange,onSelectionPendingChange,relationship,reviewRevision,target,targetChoicePending,tuple]);

 const current=loadedTuple===tuple&&resolution!==null&&metadataStable?resolution:null;
 const options=useMemo(()=>{
  if(!current)return [] as Selection[];
  const result:Selection[]=[...current.availableActions];
  for(const candidate of current.candidates)for(const kind of ['REPLACE_CURRENT','AMEND_EXISTING','CANCELS'] as const)if(candidate.targetActions.includes(kind)&&!result.includes(kind))result.push(kind);
  return result;
 },[current]);
 const intent=intentOverride??selectedIntent(action,relationship);
 const eligibleCandidates=useMemo(()=>intent==='CANCELS'?current?.candidates.filter(item=>item.targetActions.includes('CANCELS'))??[]:
  intent==='REPLACE_CURRENT'||intent==='AMEND_EXISTING'?current?.candidates.filter(item=>item.targetActions.includes(targetActions[intent]))??[]:[],[current,intent]);
 const selectedCandidate=targetChoicePending||!target||!current?null:current.candidates.find(item=>item.documentId===target.documentId&&item.revision===target.revision&&
  (intent==='REPLACE_CURRENT'||intent==='AMEND_EXISTING'||intent==='CANCELS'?item.targetActions.includes(targetActions[intent]):false))??null;
 const unavailable=Boolean(current&&intent&&!targetChoicePending&&(!options.includes(intent)||(target!==null&&!selectedCandidate)||(!['REPLACE_CURRENT','AMEND_EXISTING','CANCELS'].includes(intent)&&target!==null)));
 const lookupDisabled=disabled||busy||!saved||!metadataStable;
 return <section className="knowledge-version-panel" aria-labelledby="knowledge-version-title">
  <div className="knowledge-version-heading"><div><h3 id="knowledge-version-title">ตรวจรุ่นและการดำเนินการ</h3><p>ผลนี้อ่านจากร่างตรวจที่บันทึกแล้ว เป็นข้อมูลประกอบการเลือกเท่านั้น</p></div>
   <button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void lookup()} disabled={lookupDisabled}>{busy?'กำลังตรวจ…':current?'ตรวจอีกครั้ง':'ตรวจรุ่นเอกสาร'}</button>
  </div>
  {!saved&&<p className="knowledge-version-note">บันทึกร่างตรวจส่วนตัวก่อน จึงจะตรวจกลุ่มเอกสารและฉบับที่เกี่ยวข้องได้</p>}
  {saved&&!metadataStable&&<p className="knowledge-version-note" role="status">ข้อมูลเอกสารมีการแก้ไขแล้ว บันทึกร่างก่อนตรวจรุ่นอีกครั้ง ผลเดิมถูกพักไว้</p>}
  {failure&&<div className="knowledge-version-feedback" role="alert"><p>{failure}</p>{failure.startsWith('ข้อมูลฉบับ')&&<button type="button" className="knowledge-button knowledge-button-tertiary" onClick={onReloadPreview} disabled={disabled||busy}>โหลดข้อความและคำเตือนฉบับล่าสุด</button>}</div>}
  {(intent!==null||action!==null||target!==null||relationship!==null||targetChoicePending)&&<button type="button" className="knowledge-button knowledge-button-tertiary knowledge-version-clear" onClick={()=>{onSelectionPendingChange(false);setTargetChoicePending(false);setIntentOverride(null);onClear();}} disabled={disabled||busy}>ล้างการดำเนินการและเป้าหมาย</button>}
  {current&&<>
   {current.missingMetadata.length>0&&<p className="knowledge-version-warning" role="status">ยังตรวจตัวเลือกไม่ได้ เพราะยังไม่ระบุ{current.missingMetadata.map(field=>` ${missingNames[field]??field}`).join(' · ')} กรุณาเติมข้อมูลและบันทึกร่างก่อน</p>}
   {current.limitExceeded&&<p className="knowledge-version-warning" role="status">กลุ่มนี้มีเอกสารเกินขอบเขตที่แสดงได้ จึงยังเลือกการดำเนินการจากรายการบางส่วนไม่ได้</p>}
   {!current.limitExceeded&&current.missingMetadata.length===0&&current.currentStreamOccupied&&<p className="knowledge-version-note" role="status">มีฉบับปัจจุบันในสายนี้ จึงเพิ่มเป็นเอกสารเพิ่มเติมไม่ได้ {options.includes('REPLACE_CURRENT')?'หากต้องการแทน ให้เลือกเป้าหมายที่แสดงด้านล่าง': 'ใช้ได้เฉพาะตัวเลือกที่แสดงด้านล่าง หากต้องการใช้สายฉบับอื่น ให้แก้ข้อมูลและบันทึกร่างก่อนตรวจใหม่'}</p>}
   {current.family&&<p className="knowledge-version-family">กลุ่มเอกสาร: <strong>{current.family.name}</strong> <span>({current.family.code})</span></p>}
   {!current.limitExceeded&&current.missingMetadata.length===0&&options.length>0&&<fieldset className="knowledge-version-choices" disabled={disabled||busy}>
    <legend>เลือกการดำเนินการอย่างชัดเจน</legend>
    {options.map(option=><label key={option}><input type="radio" name={`version-action-${jobId}`} value={option} checked={intent===option} onChange={()=>{
      setIntentOverride(option);
      const requiresTarget=option==='REPLACE_CURRENT'||option==='AMEND_EXISTING'||option==='CANCELS';
      setTargetChoicePending(requiresTarget);onSelectionPendingChange(requiresTarget);if(!requiresTarget)onSelect(option,null);
     }}/><span><strong>{actionNames[option]}</strong>{option==='NEW_FAMILY'&&<small>ใช้เมื่อยังไม่มีครอบครัวเอกสารนี้</small>}{option==='ADD_ADDITIONAL'&&<small>เพิ่มเอกสารในกลุ่มเดิม โดยไม่แทนฉบับหลัก</small>}{option==='ADD_HISTORICAL'&&<small>เก็บฉบับย้อนหลังโดยไม่เปลี่ยนฉบับปัจจุบัน</small>}{option==='REPLACE_CURRENT'&&<small>ระบุฉบับปัจจุบันที่ต้องการแทน</small>}{option==='AMEND_EXISTING'&&<small>เพิ่มเอกสารแก้ไข โดยคงเอกสารหลักไว้</small>}{option==='CANCELS'&&<small>สร้างเอกสารยกเลิกทั้งฉบับและระบุเป้าหมายให้ตรง</small>}</span></label>)}
   </fieldset>}
   {(intent==='REPLACE_CURRENT'||intent==='AMEND_EXISTING'||intent==='CANCELS')&&current.missingMetadata.length===0&&!current.limitExceeded&&<label className="knowledge-field knowledge-version-target">เอกสารเป้าหมาย
     <select value={!targetChoicePending&&selectedCandidate?`${selectedCandidate.documentId}:${selectedCandidate.revision}`:''} disabled={disabled||busy||eligibleCandidates.length===0} onChange={event=>{const candidate=eligibleCandidates.find(item=>`${item.documentId}:${item.revision}`===event.target.value)??null;if(candidate){setTargetChoicePending(false);onSelectionPendingChange(false);onSelect(intent,candidate);}}}>
     <option value="">เลือกเอกสารเป้าหมาย</option>{eligibleCandidates.map(candidate=><option key={`${candidate.documentId}:${candidate.revision}`} value={`${candidate.documentId}:${candidate.revision}`}>{targetSummary(candidate)}</option>)}
    </select>{eligibleCandidates.length===0&&<span className="knowledge-hint">ไม่พบเอกสารที่เข้าเงื่อนไขสำหรับการดำเนินการนี้</span>}
   </label>}
   {intent&&['REPLACE_CURRENT','AMEND_EXISTING','CANCELS'].includes(intent)&&!selectedCandidate&&<p className="knowledge-version-warning" role="status">เลือกเอกสารเป้าหมายของการดำเนินการนี้ก่อน จึงจะบันทึกได้</p>}
   {intent==='CANCELS'&&selectedCandidate&&<p className="knowledge-version-note">จะบันทึกเป็นเอกสารเพิ่มที่มีความสัมพันธ์ยกเลิกเอกสารเป้าหมายนี้ ทั้งหมดต้องตรวจในขั้นอนุมัติแยกต่างหาก</p>}
   {selectedCandidate&&intent&&<div className="knowledge-version-selected"><strong>เป้าหมายที่เลือก · {actionNames[intent]}</strong><p>{targetSummary(selectedCandidate)}</p></div>}
   {unavailable&&<div className="knowledge-version-warning" role="alert"><p>ตัวเลือกที่บันทึกไว้ไม่มีอยู่ในผลตรวจล่าสุด หรือเป้าหมายเดิมไม่เข้าเงื่อนไขแล้ว ตรวจรายการใหม่และเลือกอีกครั้ง หรือล้างการดำเนินการที่เลือกไว้</p></div>}
   {!current.limitExceeded&&current.missingMetadata.length===0&&options.length===0&&<p className="knowledge-version-note">ยังไม่มีตัวเลือกที่ใช้ได้จากข้อมูลที่ตรวจ กรุณาทบทวนกลุ่ม สายฉบับ และขอบเขต</p>}
   <p className="knowledge-version-note">ผลตรวจเป็นเพียงภาพข้อมูล ณ เวลาที่อ่าน ระบบจะตรวจสิทธิ์และฉบับเป้าหมายซ้ำก่อนเผยแพร่ ไม่มีการอนุมัติหรือเผยแพร่จากส่วนนี้</p>
  </>}
  {!current&&!failure&&<p className="knowledge-version-note">ยังไม่มีผลตรวจรุ่นเอกสารสำหรับร่างฉบับนี้</p>}
 </section>;
}
