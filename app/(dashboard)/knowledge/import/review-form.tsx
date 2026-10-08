'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ImportReviewState} from '@/lib/imports/import-review';
import type {ImportPublicationReceipt} from '@/lib/imports/import-publication';
import {
  parseAssistanceEnvelope,
  requiredReviewFields,
  type ImportAssistance,
} from '@/lib/imports/assistance-contract';
import VersionPanel from './version-panel';
import ChunkPlanPanel from './chunk-plan-panel';
import ApprovalPanel from './approval-panel';
import StructuredMappingPanel from './structured-mapping-panel';
import type {ImportReviewDraft} from '@/lib/imports/review-schema';
import type {StructuredMappingChange} from './structured-client-contract';
import {changeReviewMode,acknowledgeReviewChunks,restartReviewDraft} from './review-state';
import type {VersionCandidate} from '@/lib/imports/version-candidates';

type ReviewStatus='UNRESOLVED'|'CORRECTED'|'FALSE_POSITIVE';
type ReviewProps={
  jobId:string;
  jobRevision:number;
  extractionRevision:number;
  refreshKey:number;
  parentPending:boolean;
  onDraftStateChange:(dirty:boolean,pending:boolean,completedJobId:string|null)=>void;
  onReloadPreview:()=>void;
};
type Result={response:Response;body:unknown};

const datasetTypes=['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'] as const;
const storageModes=['RAG','STRUCTURED','BOTH'] as const;
const actionLabels:Record<string,string>={
  NEW_FAMILY:'เริ่มกลุ่มเอกสารใหม่',ADD_ADDITIONAL:'เพิ่มเอกสารในกลุ่ม',REPLACE_CURRENT:'แทนฉบับปัจจุบัน',ADD_HISTORICAL:'เพิ่มฉบับย้อนหลัง',AMEND_EXISTING:'แก้ไขเอกสารเดิม',
};
const datasetLabels:Record<(typeof datasetTypes)[number],string>={
  academic_calendar_events:'ปฏิทินการศึกษา',tuition_fees:'ค่าเล่าเรียน',transfer_courses:'เทียบโอนรายวิชา',university_services:'บริการมหาวิทยาลัย',university_systems:'ระบบมหาวิทยาลัย',service_forms:'แบบฟอร์มบริการ',announcements:'ประกาศ',
};
const warningLabels:Record<string,string>={
  OCR_REQUIRED:'อาจต้องใช้ OCR',LOW_TEXT_QUALITY:'คุณภาพข้อความต่ำ',UNSUPPORTED_TABLES:'อ่านตารางได้ไม่ครบ',ENCRYPTED_SOURCE:'ไฟล์เข้ารหัส',FORMULAS_PRESENT:'พบสูตรในตาราง',HIDDEN_DATA_REVIEW:'พบข้อมูลซ่อน',EXTERNAL_LINKS_REVIEW:'พบลิงก์ภายนอก',PAGE_REVIEW_REQUIRED:'ต้องตรวจข้อความหรือหน้าเอกสาร',TABLE_SHAPE_REVIEW:'ต้องตรวจรูปแบบตาราง',SOURCE_REVIEW_REQUIRED:'ต้องตรวจแหล่งที่มา',SENSITIVE_DATA_REVIEW_REQUIRED:'อาจมีข้อมูลละเอียดอ่อน',ACADEMIC_YEAR_AMBIGUOUS:'ปีการศึกษาไม่ชัดเจน',FAMILY_AMBIGUOUS:'ประเภทเอกสารไม่ชัดเจน',STRUCTURED_SCHEMA_UNAVAILABLE:'ยังไม่มีตัวเชื่อมชุดข้อมูล',
};
const authorityPresets=[
  {value:100,label:'100 · สภามหาวิทยาลัย / อธิการบดี (อำนาจสูงสุด)'},
  {value:90,label:'90 · ข้อบังคับ / ระเบียบมหาวิทยาลัย'},
  {value:80,label:'80 · ประกาศมหาวิทยาลัย'},
  {value:70,label:'70 · ประกาศคณะ / สำนัก / สถาบัน'},
  {value:50,label:'50 · แนวปฏิบัติ / ข้อมูลทั่วไป'},
] as const;

function emptyDraft(warnings:ImportReviewState['warnings']):ImportReviewDraft{
  return {
    schemaVersion:1,
    metadata:{
      title:null,familyCode:null,newFamily:null,departmentCode:null,documentType:null,versionName:null,versionStream:null,academicYear:null,
      scope:{semester:null,audience:null,studentType:null,programCode:null,curriculumCode:null,cohort:null},
      publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:null,
      sourceUrl:null,sourcePageUrl:null,visibility:null,storageMode:null,datasetType:null,
    },
    action:null,target:null,relationship:null,
    attestations:{sourceAuthorityReviewed:false,extractionReviewed:false,applicabilityReviewed:false,sensitivityReviewed:false,versionReviewed:false},
    warningDispositions:warnings.map(warning=>({warningKey:warning.key,status:'UNRESOLVED',reason:null})),
  };
}

function cloneDraft(draft:ImportReviewDraft):ImportReviewDraft{
  return JSON.parse(JSON.stringify(draft)) as ImportReviewDraft;
}

function applyAssistanceToDraft(draft:ImportReviewDraft,a:ImportAssistance):ImportReviewDraft{
  const next=cloneDraft(draft);
  for(const field of ['title','familyCode','departmentCode','documentType','versionName','versionStream','academicYear','publishedAt','effectiveFrom','effectiveTo','authorityLevel','sourceUrl','sourcePageUrl','visibility','storageMode','datasetType'] as const){
    if(next.metadata[field]===null&&a.metadata[field]!==null){
      Object.assign(next.metadata,{[field]:a.metadata[field]});
    }
  }
  return next;
}

function normalizeDraft(draft:ImportReviewDraft):ImportReviewDraft{
  const clean=(value:string|null)=>value===null||value.trim()===''?null:value.trim();
  const normalized:ImportReviewDraft={
    ...draft,
    metadata:{
      ...draft.metadata,
      title:clean(draft.metadata.title),
      familyCode:clean(draft.metadata.familyCode),
      newFamily:draft.metadata.newFamily?{name:clean(draft.metadata.newFamily.name),category:clean(draft.metadata.newFamily.category)}:null,
      departmentCode:clean(draft.metadata.departmentCode),
      documentType:clean(draft.metadata.documentType),
      versionName:clean(draft.metadata.versionName),
      versionStream:clean(draft.metadata.versionStream),
      scope:{
        semester:clean(draft.metadata.scope.semester),
        audience:clean(draft.metadata.scope.audience),
        studentType:clean(draft.metadata.scope.studentType),
        programCode:clean(draft.metadata.scope.programCode),
        curriculumCode:clean(draft.metadata.scope.curriculumCode),
        cohort:draft.metadata.scope.cohort,
      },
      sourceUrl:clean(draft.metadata.sourceUrl),
      sourcePageUrl:clean(draft.metadata.sourcePageUrl),
    },
    warningDispositions:draft.warningDispositions.map(item=>({...item,reason:clean(item.reason)})),
  };

  if(normalized.schemaVersion===3){
    if(normalized.metadata.storageMode==='STRUCTURED'){
      (normalized as {chunkPlan?:unknown}).chunkPlan=null;
    } else if(normalized.metadata.storageMode==='RAG'){
      (normalized as {structuredMapping?:unknown}).structuredMapping=null;
    }
  }

  return normalized;
}

function isRecord(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null;
}

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

function OriginTag({origin}:{origin?:{kind:'EXTRACTED'|'CLASSIFIED'|'DEFAULT';label:string}}){
  if(!origin)return null;
  const labelText=origin.kind==='EXTRACTED'?'สกัดจากต้นฉบับ':origin.kind==='CLASSIFIED'?'จำแนกอัตโนมัติ':'ค่าเริ่มต้น';
  return <span className={`knowledge-origin-tag knowledge-origin-${origin.kind.toLowerCase()}`} title={origin.label}>[{labelText}]</span>;
}

export default function ReviewForm({
  jobId,
  jobRevision,
  extractionRevision,
  refreshKey,
  parentPending,
  onDraftStateChange,
  onReloadPreview,
}:ReviewProps){
  const [review,setReview]=useState<ImportReviewState|null>(null);
  const [draft,setDraft]=useState<ImportReviewDraft|null>(null);
  const [baseline,setBaseline]=useState<ImportReviewDraft|null>(null);
  const [assistance,setAssistance]=useState<ImportAssistance|null>(null);
  const [assistanceError,setAssistanceError]=useState(false);
  const [assistanceLoading,setAssistanceLoading]=useState(false);
  const [pending,setPending]=useState<'load'|'save'|null>(null);
  const [versionPending,setVersionPending]=useState(false);
  const [chunkPending,setChunkPending]=useState(false);
  const [structuredVerified,setStructuredVerified]=useState(false);
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
  const [customAuthority,setCustomAuthority]=useState(false);
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
    setMutation(current=>{
      if(key==='storageMode'&&(value==='RAG'||value==='STRUCTURED'||value==='BOTH'))return changeReviewMode(current,value);
      if(key==='datasetType'&&current.schemaVersion===3)return {...current,metadata:{...current.metadata,[key]:value},structuredMapping:null};
      return {...current,metadata:{...current.metadata,[key]:value}};
    });
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
    setMutation(current=>acknowledgeReviewChunks(current,digest));
  },[setMutation]);

  const onStructuredDraftChange=useCallback((value:StructuredMappingChange)=>{
    setMutation(current=>{
      if(current.metadata.storageMode!=='STRUCTURED'&&current.metadata.storageMode!=='BOTH')return current;
      const chunkPlan=current.metadata.storageMode==='STRUCTURED'
        ?null
        :('chunkPlan' in current?current.chunkPlan:null);
      return {
        ...current,
        schemaVersion:3,
        chunkPlan,
        metadata:{...current.metadata,datasetType:value.mapping?.dataset??current.metadata.datasetType},
        structuredMapping:value.mapping?{mapping:value.mapping,acknowledgment:value.acknowledgment}:null,
      };
    });
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

      // Safe browser assistance load with explicit failure tracking
      let loadedAssistance:ImportAssistance|null=null;
      let hadAssistanceError=false;
      try{
        const asstResult=await request(`/api/knowledge/imports/${encodeURIComponent(jobId)}/assistance`,{signal:activeSignal});
        if(asstResult.response.ok){
          loadedAssistance=parseAssistanceEnvelope(asstResult.body,{jobId,jobRevision,extractionRevision});
          if(!loadedAssistance){
            hadAssistanceError=true;
          }
        }else{
          hadAssistanceError=true;
        }
      }catch{
        hadAssistanceError=true;
      }
      setAssistance(loadedAssistance);
      setAssistanceError(hadAssistanceError);

      setReview(next);
      if(next.saved){
        const nextDraft=draftFromState(next);
        setDraft(nextDraft);
        setBaseline(cloneDraft(nextDraft));
      }else{
        // Unsaved new draft: apply assistance proposals, keeping a separate empty baseline so proposals can be saved
        const rawEmpty=emptyDraft(next.warnings);
        const assistedDraft=loadedAssistance?applyAssistanceToDraft(rawEmpty,loadedAssistance):rawEmpty;
        setDraft(assistedDraft);
        setBaseline(cloneDraft(rawEmpty));
      }

      setLoadedKey(currentKey);setConflicted(false);setReloadConfirm(false);
      setVersionResetEpoch(value=>value+1);setVersionSelectionPending(false);setVersionPending(false);
      setStartedCurrent(!next.stale);setRevisionMismatch(false);
      return true;
    }catch{if(activeSignal?.aborted)return false;setFailure('เชื่อมต่อข้อมูลตรวจไม่ได้ ลองโหลดรายการอีกครั้ง');return false;}
    finally{if(serial===requestSerial.current)setPending(null);}
  },[currentKey,jobId,jobRevision,extractionRevision]);

  const retryAssistance=useCallback(async()=>{
    setAssistanceLoading(true);
    try{
      const asstResult=await request(`/api/knowledge/imports/${encodeURIComponent(jobId)}/assistance`);
      if(asstResult.response.ok){
        const parsed=parseAssistanceEnvelope(asstResult.body,{jobId,jobRevision,extractionRevision});
        if(parsed){
          setAssistance(parsed);
          setAssistanceError(false);
          if(!review?.saved){
            setDraft(current=>current?applyAssistanceToDraft(current,parsed):current);
          }
        }else{
          setAssistanceError(true);
        }
      }else{
        setAssistanceError(true);
      }
    }catch{
      setAssistanceError(true);
    }finally{
      setAssistanceLoading(false);
    }
  },[jobId,jobRevision,extractionRevision,review]);

  useEffect(()=>{
    const controller=new AbortController();
    resourceKeyRef.current=currentKey;
    const launch=setTimeout(()=>{void load(controller.signal);},0);
    mountedRef.current=true;
    return()=>{clearTimeout(launch);controller.abort();abortRef.current?.abort();mountedRef.current=false;};
  },[currentKey,jobId,jobRevision,extractionRevision,refreshKey,load]);

  useEffect(()=>{
    onDraftStateChange(dirty,activityPending,publicationReceipt?.jobId??null);
  },[dirty,activityPending,publicationReceipt,onDraftStateChange]);

  function handleStartCurrent(){
    if(!review||reviewLocked)return;
    if(dirty&&!window.confirm('เริ่มตรวจจากฉบับปัจจุบันและทิ้งร่างในเครื่องหรือไม่? ใบตรวจที่บันทึกไว้จะยังคงอยู่ในประวัติ'))return;
    const rawEmpty = emptyDraft(review.warnings);
    const next=restartReviewDraft(assistance?applyAssistanceToDraft(rawEmpty,assistance):rawEmpty,review.saved?.draft??null);

    if(review.saved){
      next.action=review.saved.draft.action;
      next.target=review.saved.draft.target;
      next.relationship=review.saved.draft.relationship;
      Object.assign(next.metadata,review.saved.draft.metadata);
    }
    next.attestations = {
      sourceAuthorityReviewed: false,
      extractionReviewed: false,
      applicabilityReviewed: false,
      sensitivityReviewed: false,
      versionReviewed: false,
    };
    setDraft(next);
    setBaseline(cloneDraft(review.saved?.draft??rawEmpty));
    setStartedCurrent(true);setConflicted(false);setFailure('');
    setNotice('เริ่มร่างตรวจสำหรับฉบับปัจจุบันแล้ว ทุกคำยืนยันและคำเตือนกลับเป็นสถานะที่ยังไม่ตรวจ');
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
      const result=await request(`/api/knowledge/imports/${encodeURIComponent(jobId)}/review`,{
        method:'PUT',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          expectedJobRevision:review.jobRevision,
          expectedExtractionRevision:review.extractionRevision,
          expectedReviewRevision:review.reviewRevision,
          draft:prepared,
        }),
      });
      if(!mountedRef.current||serial!==requestSerial.current||resourceKeyRef.current!==saveKey)return;
      const next=isRecord(result.body)&&isReviewState(result.body.review)?result.body.review:null;
      if(next&&(next.jobId!==jobId||next.jobRevision!==jobRevision||next.extractionRevision!==extractionRevision)){
        setConflicted(false);setRevisionMismatch(true);setFailure('ข้อมูลตรวจล่าสุดผูกกับฉบับเอกสารอื่น ร่างของคุณยังอยู่ โหลดข้อความและคำเตือนฉบับล่าสุดก่อนทำต่อ');return;
      }
      if(!result.response.ok||!next){if(result.response.status===409)setConflicted(true);setFailure(apiError(result));return;}
      setReview(next);
      const nextDraft=draftFromState(next);
      setDraft(nextDraft);
      setBaseline(cloneDraft(nextDraft));
      setLoadedKey(currentKey);setConflicted(false);setRevisionMismatch(false);setStartedCurrent(!next.stale);
      setVersionResetEpoch(value=>value+1);setVersionSelectionPending(false);setVersionPending(false);
      setNotice('บันทึกร่างตรวจส่วนตัวแล้ว ยังไม่อนุมัติและยังไม่เผยแพร่');
    }catch{
      if(mountedRef.current&&serial===requestSerial.current&&resourceKeyRef.current!==saveKey)setFailure('เชื่อมต่อระบบไม่ได้ ร่างตรวจยังอยู่ครบ ลองบันทึกอีกครั้ง');
    }finally{
      if(mountedRef.current&&serial===requestSerial.current&&resourceKeyRef.current!==saveKey)setPending(null);
    }
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

  const missingFields=draft?requiredReviewFields(draft.metadata):[];
  const families=assistance?.families??[];
  const departments=assistance?.departments??[];
  const origins=assistance?.origins??{};

  return (
    <section className="knowledge-review" aria-labelledby="review-draft-title">
      <header className="knowledge-review-heading">
        <div>
          <h3 id="review-draft-title">ทบทวนข้อมูลเอกสาร</h3>
          <p>{publicationReceipt?'อนุมัติฉบับตรวจที่ระบุในใบรับรองแล้ว ข้อมูลที่แสดงเปิดให้อ่านเพื่อตรวจสอบย้อนหลัง':'ระบบจัดเตรียมข้อเสนอจากต้นฉบับ ตรวจสอบสรุปและแก้ไขเฉพาะข้อมูลที่ไม่ชัดเจน'}</p>
        </div>
        {review&&<span className="knowledge-review-counter">ฉบับตรวจ {review.reviewRevision}</span>}
      </header>

      {(!readyForKey||pending==='load')&&<p className="knowledge-loading" role="status" aria-live="polite">กำลังโหลดข้อมูลตรวจและข้อเสนอช่วยเตรียมความพร้อม…</p>}
      {failure&&!readyForKey&&!revisionMismatch&&<div className="knowledge-review-conflict" role="alert"><p>{failure}</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void load()} disabled={busy||parentPending}>โหลดข้อมูลตรวจอีกครั้ง</button></div>}
      {revisionMismatch&&<div className="knowledge-review-conflict" role="alert"><p>{failure||'ข้อมูลตรวจผูกกับฉบับเอกสารอื่น โหลดตัวอย่างฉบับล่าสุดก่อนทำต่อ'}</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={onReloadPreview} disabled={busy||parentPending}>โหลดข้อความและคำเตือนฉบับล่าสุด</button></div>}
      {readyForKey&&review?.stale&&<div className="knowledge-review-stale" role="status"><strong>ร่างที่บันทึกไว้ผูกกับฉบับก่อนหน้า</strong><p>ข้อมูลเดิมยังเก็บในประวัติ แต่คำยืนยันและคำเตือนไม่ได้ย้ายมาใช้กับฉบับนี้</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={handleStartCurrent} disabled={busy||parentPending}>เริ่มตรวจฉบับปัจจุบัน</button></div>}
      {readyForKey&&conflicted&&<div className="knowledge-review-conflict" role="alert"><p>มีร่างอื่นบันทึกไว้หลังจากเปิดหน้านี้ ร่างของคุณยังอยู่และบันทึกต่อไม่ได้</p>
        <div className="knowledge-review-actions">
          <button type="button" className="knowledge-button knowledge-button-secondary" onClick={resetToSaved} disabled={busy||parentPending}>ทิ้งร่างในเครื่องและใช้ฉบับที่บันทึกแล้ว</button>
          <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>void reloadLatest(false)} disabled={busy||parentPending}>โหลดฉบับล่าสุด</button>
        </div>
      </div>}
      {readyForKey&&reloadConfirm&&<div className="knowledge-review-confirm" role="alert"><p>โหลดฉบับล่าสุดจะทิ้งร่างในเครื่องที่ยังไม่ได้บันทึก</p><div className="knowledge-review-actions">
        <button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void reloadLatest(true)} disabled={busy||parentPending}>ยืนยันโหลดและทิ้งร่าง</button>
        <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setReloadConfirm(false)} disabled={busy||parentPending}>กลับไปเก็บร่างนี้</button></div></div>}

      {readyForKey&&review&&draft&&<>
        {/* Assistance Alert / Retry */}
        {assistanceError&&(
          <div className="knowledge-assisted-alert" role="alert">
            <div className="knowledge-assisted-alert-content">
              <span className="knowledge-alert-icon" aria-hidden="true">⚠️</span>
              <div>
                <strong>ไม่สามารถดึงข้อเสนอแนะช่วยเตรียมความพร้อมอัตโนมัติได้</strong>
                <p>ระบบไม่สามารถเชื่อมต่อบริการข้อเสนอแนะอัตโนมัติได้ในขณะนี้ ข้อมูลร่างเดิมของคุณยังคงถูกรักษาไว้ และคุณสามารถเลือกหรือแก้ไขข้อมูลที่มีอยู่ หรือกดปุ่มลองโหลดข้อเสนอแนะใหม่อีกครั้ง</p>
              </div>
            </div>
            <button
              type="button"
              className="knowledge-button knowledge-button-secondary knowledge-button-sm"
              onClick={()=>void retryAssistance()}
              disabled={assistanceLoading}
            >
              {assistanceLoading?'กำลังเชื่อมต่อ…':'ลองโหลดข้อเสนอแนะใหม่'}
            </button>
          </div>
        )}

        {/* Step Indicator & Prepared Summary */}
        <div className="knowledge-assisted-summary-card" aria-label="สรุปข้อเสนอช่วยเตรียมความพร้อม">
          <div className="knowledge-assisted-header">
            <div>
              <p className="knowledge-assisted-badge">ข้อเสนอช่วยเตรียมความพร้อม</p>
              <h4>สรุปข้อมูลที่อ่านได้จากเอกสาร</h4>
            </div>
            <span className="knowledge-review-state">{review.saved?`ร่างฉบับที่ ${review.saved.reviewRevision} (บันทึกแล้ว)`:'ร่างใหม่จากระบบ'}</span>
          </div>
          <p className="knowledge-hint">ข้อมูลด้านล่างถูกดึงและจำแนกอัตโนมัติจากเนื้อหา กรุณาตรวจความถูกต้องก่อนบันทึกหรืออนุมัติ</p>

          <div className="knowledge-assisted-facts">
            <div className="knowledge-assisted-fact">
              <span className="knowledge-fact-label">ชื่อเอกสาร <OriginTag origin={origins.title}/></span>
              <strong>{draft.metadata.title??'ยังไม่ระบุ'}</strong>
            </div>
            <div className="knowledge-assisted-fact">
              <span className="knowledge-fact-label">กลุ่มเอกสาร <OriginTag origin={origins.familyCode}/></span>
              <strong>{families.find(f=>f.code===draft.metadata.familyCode)?.name??draft.metadata.familyCode??'ยังไม่ระบุ'}</strong>
            </div>
            <div className="knowledge-assisted-fact">
              <span className="knowledge-fact-label">หน่วยงาน <OriginTag origin={origins.departmentCode}/></span>
              <strong>{departments.find(d=>d.code===draft.metadata.departmentCode)?.name??draft.metadata.departmentCode??'ยังไม่ระบุ'}</strong>
            </div>
            <div className="knowledge-assisted-fact">
              <span className="knowledge-fact-label">ระดับการมองเห็น <OriginTag origin={origins.visibility}/></span>
              <strong>{draft.metadata.visibility==='PUBLIC'?'สาธารณะ (ตอบนักศึกษา)':draft.metadata.visibility==='RESTRICTED'?'จำกัดสิทธิ์':'ภายใน (INTERNAL)'}</strong>
            </div>
            <div className="knowledge-assisted-fact">
              <span className="knowledge-fact-label">วิธีใช้เอกสาร <OriginTag origin={origins.storageMode}/></span>
              <strong>{draft.metadata.storageMode??'RAG (ค้นหาข้อความ)'}</strong>
            </div>
            <div className="knowledge-assisted-fact">
              <span className="knowledge-fact-label">แหล่งอำนาจเอกสาร <OriginTag origin={origins.authorityLevel}/></span>
              <strong>{draft.metadata.authorityLevel!==null?`ระดับ ${draft.metadata.authorityLevel}`:'ยังไม่ได้ตรวจ'}</strong>
            </div>
          </div>

          {missingFields.length>0?(
            <div className="knowledge-missing-banner" role="status">
              <div className="knowledge-missing-heading">
                <span className="knowledge-missing-icon" aria-hidden="true">⚠️</span>
                <strong>ข้อมูลจำเป็นที่ต้องระบุเพิ่ม ({missingFields.length} รายการ):</strong>
              </div>
              <ul className="knowledge-missing-list">
                {missingFields.map(f=><li key={f.key}>{f.label}</li>)}
              </ul>
            </div>
          ):(
            <div className="knowledge-missing-complete" role="status">
              <span aria-hidden="true">✓</span>
              <strong>ข้อมูลจำเป็นเบื้องต้นครบถ้วนแล้ว</strong> ตรวจสอบคำยืนยันและการดำเนินการฉบับเพื่อเตรียมอนุมัติ
            </div>
          )}
        </div>

        {/* Action and Relationship Status */}
        <p className="knowledge-review-pending">
          {versionSelectionPending?'กำลังตรวจยืนยันตัวเลือกฉบับ เลือกเป้าหมายหรือยกเลิกตัวเลือกก่อนบันทึก':(
            <>การดำเนินการฉบับ: <strong>{draft.action?actionLabels[draft.action]??draft.action:'ยังไม่ได้เลือกการดำเนินการ'}</strong>
            {draft.target?` · มีเป้าหมายที่บันทึกไว้สำหรับตรวจยืนยัน`:draft.action==='REPLACE_CURRENT'||draft.action==='AMEND_EXISTING'||draft.relationship==='CANCELS'?' · ยังไม่ได้เลือกเป้าหมาย':' · ไม่มีเป้าหมายที่เลือก'}
            {draft.relationship==='CANCELS'?' · ยกเลิกเอกสารเดิม':''}</>
          )}
          {publicationReceipt?' · ดูผลที่ใบรับรองด้านล่าง':' · บันทึกตัวเลือกและตรวจหลักฐานให้ครบก่อนอนุมัติ'}
        </p>

        {/* Step 1: Core Fields Editing */}
        <fieldset className="knowledge-review-fields" disabled={disabled}>
          <legend>แก้ไขข้อมูลเอกสาร</legend>

          <div className="knowledge-review-section">
            <h4>1. ข้อมูลหลักของเอกสาร</h4>
            <div className="knowledge-review-grid">
              <label className="knowledge-field">
                ชื่อเอกสาร *
                {nullableText(draft.metadata.title,value=>updateMetadata('title',value),{maxLength:500,disabled,placeholder:'ระบุชื่อเอกสารตามประกาศ'})}
                <span className="knowledge-hint">ชื่อตามต้นฉบับทางการ <OriginTag origin={origins.title}/></span>
              </label>

              <label className="knowledge-field">
                กลุ่มเอกสาร *
                <select
                  value={draft.metadata.familyCode??''}
                  disabled={disabled}
                  onChange={e=>updateMetadata('familyCode',e.target.value===''?null:e.target.value)}
                >
                  <option value="">{families.length===0?(assistanceError?'ไม่พบข้อมูลกลุ่มเอกสารจากระบบ (การเชื่อมต่อขัดข้อง)':'กำลังโหลดกลุ่มเอกสาร…'):'เลือกกลุ่มเอกสาร'}</option>
                  {families.map(f=><option key={f.code} value={f.code}>{f.name} ({f.code})</option>)}
                  {draft.metadata.familyCode&&!families.some(f=>f.code===draft.metadata.familyCode)&&(
                    <option value={draft.metadata.familyCode}>{draft.metadata.familyCode} (จากฉบับร่างปัจจุบัน)</option>
                  )}
                </select>
                <span className="knowledge-hint">เลือกกลุ่มที่ตรงกับเนื้อหา หรือสร้างใหม่ในส่วนจัดการฉบับ <OriginTag origin={origins.familyCode}/></span>
              </label>

              <label className="knowledge-field">
                หน่วยงานที่ออกเอกสาร *
                <select
                  value={draft.metadata.departmentCode??''}
                  disabled={disabled}
                  onChange={e=>updateMetadata('departmentCode',e.target.value===''?null:e.target.value)}
                >
                  <option value="">{departments.length===0?(assistanceError?'ไม่พบข้อมูลหน่วยงานจากระบบ (การเชื่อมต่อขัดข้อง)':'กำลังโหลดหน่วยงาน…'):'เลือกหน่วยงาน'}</option>
                  {departments.map(d=><option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
                  {draft.metadata.departmentCode&&!departments.some(d=>d.code===draft.metadata.departmentCode)&&(
                    <option value={draft.metadata.departmentCode}>{draft.metadata.departmentCode} (จากฉบับร่างปัจจุบัน)</option>
                  )}
                </select>
                <span className="knowledge-hint">หน่วยงานเจ้าของเรื่อง <OriginTag origin={origins.departmentCode}/></span>
              </label>

              <label className="knowledge-field">
                ประเภทเอกสาร *
                {nullableText(draft.metadata.documentType,value=>updateMetadata('documentType',value),{maxLength:80,disabled,placeholder:'เช่น ประกาศ, ข้อบังคับ, ระเบียบ'})}
                <span className="knowledge-hint">ประเภทตามระเบียบสารบรรณ <OriginTag origin={origins.documentType}/></span>
              </label>

              <label className="knowledge-field">
                ชื่อฉบับ *
                {nullableText(draft.metadata.versionName,value=>updateMetadata('versionName',value),{maxLength:200,disabled,placeholder:'เช่น ฉบับที่ 1, ปีการศึกษา 2569'})}
                <span className="knowledge-hint">ชื่อฉบับเพื่อแยกความแตกต่าง <OriginTag origin={origins.versionName}/></span>
              </label>

              <label className="knowledge-field">
                สายฉบับ *
                {nullableText(draft.metadata.versionStream,value=>updateMetadata('versionStream',value),{maxLength:120,disabled,placeholder:'เช่น main'})}
                <span className="knowledge-hint">ค่าเริ่มต้นคือ main <OriginTag origin={origins.versionStream}/></span>
              </label>

              <label className="knowledge-field">
                แหล่งอำนาจเอกสาร *
                <select
                  value={
                    draft.metadata.authorityLevel===null
                      ?'':authorityPresets.some(o=>o.value===draft.metadata.authorityLevel)&&!customAuthority
                        ?String(draft.metadata.authorityLevel):'CUSTOM'
                  }
                  disabled={disabled}
                  onChange={e=>{
                    const val=e.target.value;
                    if(val===''){updateMetadata('authorityLevel',null);setCustomAuthority(false);}
                    else if(val==='CUSTOM'){setCustomAuthority(true);if(draft.metadata.authorityLevel===null)updateMetadata('authorityLevel',50);}
                    else{updateMetadata('authorityLevel',Number(val));setCustomAuthority(false);}
                  }}
                >
                  <option value="">ยังไม่ระบุ (ยังไม่ได้ตรวจ)</option>
                  {authorityPresets.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  <option value="CUSTOM">กำหนดระดับตัวเลขเอง (0–100)</option>
                </select>
                {(customAuthority||(draft.metadata.authorityLevel!==null&&!authorityPresets.some(o=>o.value===draft.metadata.authorityLevel)))&&(
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.metadata.authorityLevel??''}
                    disabled={disabled}
                    placeholder="0–100"
                    onChange={e=>updateMetadata('authorityLevel',e.target.value===''?null:Number(e.target.value))}
                  />
                )}
                <span className="knowledge-hint">กำหนดตามระดับอำนาจที่ออกเอกสารจริง ห้ามเดา <OriginTag origin={origins.authorityLevel}/></span>
              </label>

              <label className="knowledge-field">
                วันที่ประกาศ *
                <input
                  type="date"
                  value={draft.metadata.publishedAt??''}
                  disabled={disabled}
                  onChange={e=>updateMetadata('publishedAt',e.target.value||null)}
                />
                <span className="knowledge-hint">ระบุตามวันที่ลงนามในประกาศเท่านั้น <OriginTag origin={origins.publishedAt}/></span>
              </label>

              <label className="knowledge-field">
                วันที่มีผลบังคับใช้ *
                <input
                  type="date"
                  value={draft.metadata.effectiveFrom??''}
                  disabled={disabled}
                  onChange={e=>updateMetadata('effectiveFrom',e.target.value||null)}
                />
                <span className="knowledge-hint">วันที่เริ่มมีผลบังคับใช้ <OriginTag origin={origins.effectiveFrom}/></span>
              </label>

              <label className="knowledge-field">
                ผู้ที่ใช้ข้อมูลนี้ได้ *
                {nullableSelect(
                  draft.metadata.visibility,
                  ['INTERNAL','PUBLIC','RESTRICTED'] as const,
                  v=>v==='INTERNAL'?'ภายในมหาวิทยาลัย (INTERNAL - ค่าเริ่มต้น)':v==='PUBLIC'?'สาธารณะ / ตอบนักศึกษา (PUBLIC)':'จำกัดการเข้าถึง (RESTRICTED)',
                  v=>updateMetadata('visibility',v),
                  disabled,
                )}
                <span className="knowledge-hint">สาธารณะต้องมี URL ทางการของมหาวิทยาลัย <OriginTag origin={origins.visibility}/></span>
              </label>

              <label className="knowledge-field">
                วิธีใช้เอกสาร *
                {nullableSelect(
                  draft.metadata.storageMode,
                  storageModes,
                  v=>v==='RAG'?'RAG · ค้นหาข้อความ (ค่าเริ่มต้น)':v==='STRUCTURED'?'STRUCTURED · ข้อมูลตาราง':v,
                  v=>updateMetadata('storageMode',v),
                  disabled,
                )}
                <span className="knowledge-hint">รูปแบบการนำข้อความไปค้นหา <OriginTag origin={origins.storageMode}/></span>
              </label>
            </div>
          </div>

          {/* Step 2: Progressive disclosure for Optional / Scope / Advanced Settings */}
          <details className="knowledge-review-details">
            <summary>2. ข้อมูลขอบเขตและรายละเอียดเพิ่มเติม (ไม่บังคับ)</summary>
            <div className="knowledge-review-grid">
              <label className="knowledge-field">
                ปีการศึกษา
                <input
                  type="number"
                  min="2400"
                  max="3000"
                  step="1"
                  value={draft.metadata.academicYear??''}
                  disabled={disabled}
                  placeholder="เช่น 2569"
                  onChange={e=>updateMetadata('academicYear',e.target.value===''?null:Number(e.target.value))}
                />
                <span className="knowledge-hint"><OriginTag origin={origins.academicYear}/></span>
              </label>

              <label className="knowledge-field">
                วันสิ้นผล (ถ้ามี)
                <input
                  type="date"
                  value={draft.metadata.effectiveTo??''}
                  disabled={disabled}
                  onChange={e=>updateMetadata('effectiveTo',e.target.value||null)}
                />
                <span className="knowledge-hint"><OriginTag origin={origins.effectiveTo}/></span>
              </label>

              <label className="knowledge-field">
                URL แหล่งที่มาทางการ
                {nullableText(draft.metadata.sourceUrl,v=>updateMetadata('sourceUrl',v),{type:'url',maxLength:2000,placeholder:'https://www.yru.ac.th/…',disabled})}
                <span className="knowledge-hint">จำเป็นเมื่อตั้งเป็น PUBLIC สำหรับตอบนักศึกษา <OriginTag origin={origins.sourceUrl}/></span>
              </label>

              <label className="knowledge-field">
                URL หน้าต้นฉบับ
                {nullableText(draft.metadata.sourcePageUrl,v=>updateMetadata('sourcePageUrl',v),{type:'url',maxLength:2000,placeholder:'https://www.yru.ac.th/…',disabled})}
              </label>

              <label className="knowledge-field">
                ภาคเรียน
                {nullableText(draft.metadata.scope.semester,v=>updateScopeText('semester',v),{maxLength:40,disabled,placeholder:'เช่น ภาคเรียนที่ 1'})}
              </label>

              <label className="knowledge-field">
                กลุ่มผู้ใช้
                {nullableText(draft.metadata.scope.audience,v=>updateScopeText('audience',v),{maxLength:80,disabled,placeholder:'เช่น นักศึกษาทุกชั้นปี, บุคลากร'})}
              </label>

              <label className="knowledge-field">
                ประเภทนักศึกษา
                {nullableText(draft.metadata.scope.studentType,v=>updateScopeText('studentType',v),{maxLength:80,disabled,placeholder:'เช่น ภาคปกติ, กศ.บป.'})}
              </label>

              <label className="knowledge-field">
                รหัสสาขาวิชา/หลักสูตร
                {nullableText(draft.metadata.scope.programCode,v=>updateScopeText('programCode',v),{maxLength:80,disabled})}
              </label>

              <label className="knowledge-field">
                รหัสหลักสูตร/แผน
                {nullableText(draft.metadata.scope.curriculumCode,v=>updateScopeText('curriculumCode',v),{maxLength:80,disabled})}
              </label>

              <label className="knowledge-field">
                รุ่นปีนักศึกษา
                <input
                  type="number"
                  min="2400"
                  max="3000"
                  step="1"
                  value={draft.metadata.scope.cohort??''}
                  disabled={disabled}
                  placeholder="เช่น 2568"
                  onChange={e=>updateCohort(e.target.value===''?null:Number(e.target.value))}
                />
              </label>

              <label className="knowledge-field">
                ชุดข้อมูล
                {nullableSelect(draft.metadata.datasetType,datasetTypes,v=>datasetLabels[v],v=>updateMetadata('datasetType',v),disabled)}
                <span className="knowledge-hint">สำหรับข้อมูลแบบโครงสร้าง <OriginTag origin={origins.datasetType}/></span>
              </label>
            </div>

            {draft.action==='NEW_FAMILY'&&(
              <div className="knowledge-review-section">
                <h4>ข้อมูลกลุ่มเอกสารใหม่</h4>
                <div className="knowledge-review-grid">
                  <label className="knowledge-field">ชื่อกลุ่มใหม่{nullableText(draft.metadata.newFamily?.name??null,v=>updateMetadata('newFamily',v===null&&draft.metadata.newFamily===null?null:{name:v,category:draft.metadata.newFamily?.category??null}),{maxLength:200,disabled})}</label>
                  <label className="knowledge-field">หมวดหมู่กลุ่มใหม่{nullableText(draft.metadata.newFamily?.category??null,v=>updateMetadata('newFamily',v===null&&draft.metadata.newFamily===null?null:{name:draft.metadata.newFamily?.name??null,category:v}),{maxLength:80,disabled})}</label>
                </div>
              </div>
            )}
          </details>

          {/* Step 3: Version Plan Panel */}
          <div className="knowledge-review-section">
            <h4>3. การดำเนินการฉบับและความสัมพันธ์</h4>
            <VersionPanel
              key={`${jobId}:${jobRevision}:${extractionRevision}:${review.reviewRevision}:${versionResetEpoch}:${JSON.stringify(draft.metadata)}`}
              jobId={jobId}
              jobRevision={jobRevision}
              extractionRevision={extractionRevision}
              reviewRevision={review.reviewRevision}
              saved={Boolean(review.saved&&!review.stale)}
              metadata={draft.metadata}
              baselineMetadata={baseline?.metadata??draft.metadata}
              action={draft.action}
              target={draft.target}
              relationship={draft.relationship}
              disabled={disabled}
              onSelect={onVersionSelection}
              onClear={clearVersionSelection}
              onReloadPreview={onReloadPreview}
              onPendingChange={onVersionPendingChange}
              onSelectionPendingChange={setVersionSelectionPending}
            />
          </div>

          {/* Step 4: Chunk Plan Panel (when RAG or BOTH) */}
          {(draft.metadata.storageMode === 'RAG' || draft.metadata.storageMode === 'BOTH') && (
            <div className="knowledge-review-section">
              <h4>4. แผนการแบ่งข้อความ (Chunk Plan)</h4>
              <ChunkPlanPanel
                key={`chunks:${jobId}:${jobRevision}:${extractionRevision}:${review.reviewRevision}:${versionResetEpoch}`}
                jobId={jobId}
                jobRevision={jobRevision}
                extractionRevision={extractionRevision}
                reviewRevision={review.reviewRevision}
                saved={Boolean(review.saved&&!review.stale&&!dirty)}
                disabled={disabled||versionSelectionPending}
                acknowledgedDigest={draft.schemaVersion>=2&&'chunkPlan' in draft?draft.chunkPlan?.digest??null:null}
                onDigestChange={onChunkDigestChange}
                onPendingChange={onChunkPendingChange}
              />
            </div>
          )}

          {/* Step 4.5: Structured Mapping Panel (when STRUCTURED or BOTH) */}
          {(draft.metadata.storageMode === 'STRUCTURED' || draft.metadata.storageMode === 'BOTH') && (
            <StructuredMappingPanel
              key={`mapping:${jobId}:${jobRevision}:${extractionRevision}:${review.reviewRevision}:${draft.metadata.storageMode}`}
              jobId={jobId}
              disabled={disabled || versionSelectionPending}
              suggestedDataset={draft.metadata.datasetType}
              savedValue={draft.schemaVersion===3?draft.structuredMapping:null}
              onChange={onStructuredDraftChange}
              onVerifiedChange={setStructuredVerified}
            />
          )}

          {/* Step 5: Warnings & Dispositions */}
          <details className="knowledge-review-details" open={review.warnings.length>0}>
            <summary>5. คำเตือนที่ต้องพิจารณา ({review.warnings.length} รายการ)</summary>
            {review.warnings.length===0?<p className="knowledge-hint">ไม่มีคำเตือนที่ผูกกับฉบับนี้</p>:(
              <ul className="knowledge-review-warnings">
                {review.warnings.map(warning=>{
                  const disposition=draft.warningDispositions.find(item=>item.warningKey===warning.key);
                  if(!disposition)return null;
                  const title=warningLabels[warning.code]??'คำเตือนจากตัวอ่าน';
                  return (
                    <li key={warning.key}>
                      <div className="knowledge-review-warning-heading">
                        <strong>{title}</strong>
                        <span className={`knowledge-severity-${warning.severity.toLowerCase()}`}>
                          {warning.severity==='BLOCKING'?'ต้องแก้ก่อนอนุมัติ':'ต้องตรวจ'} · {warning.source==='PARSER'?'ตัวอ่าน':'ตัววิเคราะห์'} · {warning.count} จุด
                        </span>
                      </div>
                      {warningLocation(warning.location)&&<p className="knowledge-review-warning-location">{warningLocation(warning.location)}</p>}
                      <label className="knowledge-field">
                        ผลการพิจารณา
                        <select
                          value={disposition.status}
                          disabled={disabled}
                          onChange={e=>setWarning(warning.key,e.target.value as ReviewStatus)}
                        >
                          <option value="UNRESOLVED">ยังไม่ตัดสินใจ</option>
                          <option value="CORRECTED">แก้ไขแล้ว</option>
                          <option value="FALSE_POSITIVE">ผลบวกลวง (ข้อมูลถูกต้องแล้ว)</option>
                        </select>
                      </label>
                      {disposition.status!=='UNRESOLVED'&&(
                        <label className="knowledge-field">
                          เหตุผลประกอบการตัดสินใจ *
                          {nullableText(disposition.reason,v=>setWarningReason(warning.key,v),{maxLength:500,placeholder:'ระบุหลักฐานหรือสิ่งที่แก้ไข',disabled})}
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </details>

          {/* Step 6: 5 Review Attestations */}
          <div className="knowledge-review-section">
            <h4>6. คำยืนยันการตรวจสอบ (ต้องยืนยันทั้ง 5 ข้อก่อนอนุมัติ)</h4>
            <p className="knowledge-hint">ทุกข้อเริ่มต้นเป็น “ยังไม่ยืนยัน” และต้องเลือกยืนยันจากการตรวจสอบหลักฐานจริง</p>
            <div className="knowledge-review-attestations">
              <label>
                <input type="checkbox" checked={draft.attestations.sourceAuthorityReviewed} disabled={disabled} onChange={e=>setAttestation('sourceAuthorityReviewed',e.target.checked)}/>
                <span>ตรวจสอบหน่วยงานและแหล่งอำนาจเอกสารจากหลักฐานแล้ว</span>
              </label>
              <label>
                <input type="checkbox" checked={draft.attestations.extractionReviewed} disabled={disabled} onChange={e=>setAttestation('extractionReviewed',e.target.checked)}/>
                <span>ตรวจข้อความและตำแหน่งที่อ่านได้จากเอกสารแล้ว</span>
              </label>
              <label>
                <input type="checkbox" checked={draft.attestations.applicabilityReviewed} disabled={disabled} onChange={e=>setAttestation('applicabilityReviewed',e.target.checked)}/>
                <span>ตรวจขอบเขตผู้ใช้และการมีผลบังคับใช้แล้ว</span>
              </label>
              <label>
                <input type="checkbox" checked={draft.attestations.sensitivityReviewed} disabled={disabled} onChange={e=>setAttestation('sensitivityReviewed',e.target.checked)}/>
                <span>ตรวจความละเอียดอ่อนและความเป็นส่วนตัวของข้อมูลแล้ว</span>
              </label>
              <label>
                <input type="checkbox" checked={draft.attestations.versionReviewed} disabled={disabled} onChange={e=>setAttestation('versionReviewed',e.target.checked)}/>
                <span>ตรวจความสัมพันธ์และสายฉบับเอกสารแล้ว</span>
              </label>
            </div>
          </div>
        </fieldset>

        {failure&&<p className="knowledge-message knowledge-message-error" role="alert">{failure}</p>}
        {notice&&<p className="knowledge-message knowledge-message-success" role="status" aria-live="polite">{notice}</p>}

        <footer className="knowledge-review-footer">
          <p>{publicationReceipt?'ฉบับที่อนุมัติและต้นฉบับเก็บไว้ตรวจสอบย้อนหลังแล้ว':review.saved?'ร่างล่าสุดบันทึกแล้ว · คุณสามารถปรับปรุงและบันทึกใหม่ได้':'มีข้อเสนอจากระบบที่ยังไม่ได้บันทึก · บันทึกร่างส่วนตัวเพื่อเก็บข้อมูล'}</p>
          <div className="knowledge-review-actions">
            {dirty&&<button type="button" className="knowledge-button knowledge-button-tertiary" onClick={resetToSaved} disabled={busy||parentPending||reviewLocked}>ทิ้งการแก้ไขในเครื่อง</button>}
            <button type="button" className="knowledge-button knowledge-button-primary" onClick={()=>void save()} disabled={!dirty||disabled||versionSelectionPending}>
              {pending==='save'?'กำลังบันทึก…':'บันทึกร่างส่วนตัว'}
            </button>
          </div>
        </footer>

        {/* Step 7: Final Approval Panel */}
        <ApprovalPanel
          review={review}
          dirty={dirty}
          disabled={approvalDisabled||versionSelectionPending||((draft.metadata.storageMode==='STRUCTURED'||draft.metadata.storageMode==='BOTH')&&!structuredVerified)}
          onPendingChange={setPublicationPending}
          onReceiptChange={setPublicationReceipt}
        />
      </>}
    </section>
  );
}
