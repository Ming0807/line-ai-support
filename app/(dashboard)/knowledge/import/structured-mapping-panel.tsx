'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import '../../../structured-mapping.css';
import {
 STRUCTURED_DATASETS,STRUCTURED_FIELD_REGISTRY,StructuredRequestGate,buildStructuredMappingFromDecisions,
 compatibleStructuredTransforms,parseStructuredMappingDraft,parseStructuredPreviewEnvelope,parseStructuredSourceEnvelope,
 structuredColumnLabel,structuredRowLabel,structuredTableLabel,validateStructuredPlanSnapshot,
 type StructuredClientPreview,type StructuredClientSource,type StructuredDataset,type StructuredExcludedRange,
 type StructuredFieldBinding,type StructuredFieldDefinition,type StructuredMapping,type StructuredMappingAcknowledgment,
 type StructuredFieldKind,
 type StructuredMappingChange,type StructuredTableDecision,
 type StructuredTransform,
} from './structured-client-contract';

export interface StructuredMappingPanelProps {
 jobId:string;
 /** The persisted review-v3 mapping and server acknowledgment, if one exists. */
 savedValue:StructuredMappingChange|null;
 suggestedDataset?:StructuredDataset|null;
 disabled?:boolean;
 onChange:(value:StructuredMappingChange)=>void;
 onVerifiedChange?:(verified:boolean)=>void;
}

type TableDraft=
 |{kind:'UNDECIDED';tableIndex:number}
 |{kind:'EXCLUDED';tableIndex:number;reason:'NOT_THIS_DATASET'|'NON_DATA'|null;note:string}
 |{kind:'MAPPED';tableIndex:number;fields:Record<string,StructuredFieldBinding|undefined>;excludedRanges:StructuredExcludedRange[]};
type LoadState='loading'|'verified'|'failed';
type Step=0|1|2;
type RangeDraft={tableIndex:number;start:number;end:number;reason:'HEADER'|'NON_DATA';note:string};
type LoadResult={key:string;state:'verified';source:StructuredClientSource;preview:StructuredClientPreview}|{key:string;state:'failed';error:string};

const datasetLabels:Record<StructuredDataset,string>={
 academic_calendar_events:'ปฏิทินการศึกษา',tuition_fees:'ค่าเล่าเรียน',transfer_courses:'เทียบโอนรายวิชา',
 university_services:'บริการมหาวิทยาลัย',university_systems:'ระบบมหาวิทยาลัย',service_forms:'แบบฟอร์มบริการ',announcements:'ประกาศ',
};
const flagLabels:Record<string,string>={
 OCR_REQUIRED:'อาจต้องใช้ OCR',LOW_TEXT_QUALITY:'ข้อความอ่านได้ไม่ชัด',UNSUPPORTED_TABLES:'มีตารางที่ระบบยังอ่านไม่ครบ',
 ENCRYPTED_SOURCE:'ไฟล์มีการเข้ารหัส',FORMULAS_PRESENT:'พบสูตรในตาราง',HIDDEN_DATA_REVIEW:'พบข้อมูลที่ซ่อนอยู่',
 EXTERNAL_LINKS_REVIEW:'พบลิงก์ภายนอก',PAGE_REVIEW_REQUIRED:'มีหน้าที่ต้องตรวจข้อความ',TABLE_SHAPE_REVIEW:'รูปแบบตารางต้องตรวจ',
};
const transformLabels:Record<StructuredTransform,string>={
 TEXT_V1:'ข้อความเดิม',INTEGER_V1:'จำนวนเต็ม',DECIMAL_V1:'ทศนิยม',DECIMAL_COMMA_V1:'ทศนิยมที่มีตัวคั่นหลักพัน',
 DATE_GREGORIAN_V1:'วันที่ ค.ศ. YYYY-MM-DD',DATE_BUDDHIST_V1:'วันที่ พ.ศ. YYYY-MM-DD',DATE_DMY_GREGORIAN_V1:'วันที่ ค.ศ. DD/MM/YYYY',
 DATE_DMY_BUDDHIST_V1:'วันที่ พ.ศ. DD/MM/YYYY',TIMESTAMP_UTC_V1:'วันและเวลา UTC',TIMESTAMP_PLUS07_V1:'วันและเวลาเขตเวลา +07:00',
 DATE_GREGORIAN_PLUS07_MIDNIGHT_V1:'วันที่ ค.ศ. เป็นเวลาเที่ยงคืน +07:00',DATE_BUDDHIST_PLUS07_MIDNIGHT_V1:'วันที่ พ.ศ. เป็นเวลาเที่ยงคืน +07:00',
};
const fieldKindLabels:Record<StructuredFieldKind,string>={
 TEXT:'ข้อความ',INTEGER:'จำนวนเต็ม',DATE:'วันที่',TIMESTAMP:'วันและเวลา',DECIMAL:'ตัวเลขทศนิยม',CURRENCY:'สกุลเงิน',EMAIL:'อีเมล',URL:'ลิงก์เว็บไซต์',
};
const exactHeaderAliases:Partial<Record<StructuredDataset,Record<string,string[]>>>= {
 academic_calendar_events:{academic_year:['year','academic year','ปีการศึกษา'],semester:['term','ภาคเรียน'],student_type:['student type','ประเภทนักศึกษา'],
  event_type:['event','event type','ประเภทกิจกรรม'],title:['activity','กิจกรรม'],start_date:['start','start date','วันเริ่มต้น'],end_date:['end','end date','วันสิ้นสุด'],description:['รายละเอียด']},
 tuition_fees:{academic_year:['year','academic year','ปีการศึกษา'],program_name:['program','program name','หลักสูตร'],major_name:['major','major name','สาขาวิชา'],
  student_group:['group','student group','กลุ่มนักศึกษา'],study_type:['study','study type','รูปแบบการศึกษา'],fee_amount:['fee','tuition','fee amount','ค่าธรรมเนียม'],
  currency:['currency','สกุลเงิน'],effective_from:['from','effective from','เริ่มมีผล'],effective_to:['to','effective to','สิ้นสุดผล']},
 transfer_courses:{source_program:['source program','หลักสูตรต้นทาง'],source_course_code:['source code','source course code','รหัสวิชาต้นทาง'],
  source_course_name:['source name','source course name','ชื่อวิชาต้นทาง'],source_credits:['source credits','หน่วยกิตต้นทาง'],target_program:['target program','หลักสูตรปลายทาง'],
  target_course_code:['target code','target course code','รหัสวิชาปลายทาง'],target_course_name:['target name','target course name','ชื่อวิชาปลายทาง'],
  target_credits:['target credits','หน่วยกิตปลายทาง'],conditions:['condition','เงื่อนไข']},
 university_services:{service_code:['code','service code','รหัสบริการ'],name:['service','service name','ชื่อบริการ'],description:['รายละเอียด'],
  location:['สถานที่'],opening_hours:['hours','opening hours','เวลาทำการ'],phone:['telephone','เบอร์โทรศัพท์'],email:['อีเมล'],url:['website','service url','ลิงก์บริการ']},
 university_systems:{code:['system code','รหัสระบบ'],name:['system','system name','ชื่อระบบ'],description:['รายละเอียด'],url:['system url','ลิงก์ระบบ'],support_url:['support url','help url','ลิงก์ช่วยเหลือ']},
 service_forms:{name:['form','form name','ชื่อแบบฟอร์ม'],description:['รายละเอียด'],form_url:['url','form url','ลิงก์แบบฟอร์ม'],requirements:['requirement','required documents','เอกสารที่ต้องใช้']},
 announcements:{title:['headline','หัวข้อประกาศ'],summary:['description','สรุปประกาศ'],publish_at:['published at','publish at','วันที่ประกาศ'],
  effective_from:['effective from','เริ่มมีผล'],effective_to:['effective to','สิ้นสุดผล'],priority:['rank','ลำดับความสำคัญ']},
};
const sourceBinding=(source:StructuredClientSource)=>({jobId:source.jobId,jobRevision:source.jobRevision,extractionRevision:source.extractionRevision,
 sourceChecksum:source.sourceChecksum,extractionDigest:source.extractionDigest});
const inventoryFor=(preview:StructuredClientPreview)=>preview.extraction.tables.map((table,tableIndex)=>({tableIndex,rowCount:table.rows.length,
 columnCount:Math.max(...table.rows.map(row=>row.length))}));
const undecided=(tableCount:number):TableDraft[]=>Array.from({length:tableCount},(_,tableIndex)=>({kind:'UNDECIDED',tableIndex}));
const signature=(value:StructuredMappingChange|null)=>JSON.stringify(value?.mapping?value:{mapping:null,acknowledgment:null});
function isHumanNote(value:string):boolean{return value.trim().length>0&&value.length<=500&&!/[\u0000-\u001f\u007f]/u.test(value);}
function sourceMatches(mapping:StructuredMapping,source:StructuredClientSource):boolean{
 return mapping.source.jobId.toLowerCase()===source.jobId.toLowerCase()&&mapping.source.jobRevision===source.jobRevision&&
  mapping.source.extractionRevision===source.extractionRevision&&mapping.source.sourceChecksum===source.sourceChecksum&&mapping.source.extractionDigest===source.extractionDigest;
}
function defaultsFor(dataset:StructuredDataset,table:StructuredClientPreview['extraction']['tables'][number]):Record<string,StructuredFieldBinding|undefined>{
 const definitions=STRUCTURED_FIELD_REGISTRY[dataset],firstRow=table.rows[0]??[];
 const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-./:()\[\]{}]+/gu,'').trim();
 const headers=firstRow.map(value=>normalize(value));
 const result:Record<string,StructuredFieldBinding|undefined>={};
 for(const definition of definitions){
 const expected=new Set([normalize(definition.name),normalize(definition.label),...(exactHeaderAliases[dataset]?.[definition.name]??[]).map(normalize)]);
  const columnIndex=headers.findIndex(header=>expected.has(header));
  if(columnIndex<0)continue;
  const transform:StructuredTransform=definition.kind==='INTEGER'?'INTEGER_V1':definition.kind==='DECIMAL'?'DECIMAL_V1':
   definition.kind==='DATE'?'DATE_GREGORIAN_V1':definition.kind==='TIMESTAMP'?'TIMESTAMP_UTC_V1':'TEXT_V1';
  result[definition.name]={kind:'COLUMN',columnIndex,transform,blank:definition.nullable?'NULL':'REJECT'};
 }
 return result;
}
function decisionState(mapping:StructuredMapping,tableCount:number):TableDraft[]|null{
 const state=undecided(tableCount),seen=new Set<number>();
 for(const selected of mapping.tables){
  if(selected.tableIndex<0||selected.tableIndex>=tableCount||seen.has(selected.tableIndex))return null;
  seen.add(selected.tableIndex);state[selected.tableIndex]={kind:'MAPPED',tableIndex:selected.tableIndex,fields:selected.fields,excludedRanges:selected.excludedRanges};
 }
 for(const excluded of mapping.excludedTables){
  if(excluded.tableIndex<0||excluded.tableIndex>=tableCount||seen.has(excluded.tableIndex))return null;
  seen.add(excluded.tableIndex);state[excluded.tableIndex]={kind:'EXCLUDED',tableIndex:excluded.tableIndex,reason:excluded.reason,note:excluded.note};
 }
 return state;
}
function buildMapping(dataset:StructuredDataset,decisions:TableDraft[],source:StructuredClientSource|null,preview:StructuredClientPreview|null):StructuredMapping|null{
 if(!source||!preview)return null;
 const tableDecisions:StructuredTableDecision[]=decisions.map(decision=>decision as StructuredTableDecision);
 return buildStructuredMappingFromDecisions({dataset,source:sourceBinding(source),tables:inventoryFor(preview),decisions:tableDecisions});
}
async function readJson(response:Response):Promise<unknown>{try{return await response.json();}catch{return null;}}
async function requestStructuredPlan(jobId:string,source:StructuredClientSource,preview:StructuredClientPreview,mapping:StructuredMapping,signal:AbortSignal){
 const response=await fetch(`/api/knowledge/imports/${encodeURIComponent(jobId)}/structured`,{
  method:'POST',cache:'no-store',credentials:'same-origin',signal,headers:{'content-type':'application/json'},
  body:JSON.stringify({expectedJobRevision:source.jobRevision,expectedExtractionRevision:source.extractionRevision,
   expectedReviewRevision:source.reviewRevision,mapping}),
 });
 const body=await readJson(response);
 if(!response.ok)return {snapshot:null,transient:response.status===408||response.status===429||response.status>=500,error:response.status===409?'แหล่งข้อมูลหรือฉบับตรวจเปลี่ยนไปแล้ว โปรดโหลดผลสกัดล่าสุดก่อนตรวจอีกครั้ง':
  response.status===403?'บัญชีนี้ไม่มีสิทธิ์ตรวจการกำหนดข้อมูล':'ระบบตรวจการกำหนดข้อมูลไม่ผ่าน โปรดตรวจช่องข้อมูลแล้วลองอีกครั้ง'};
 const snapshot=await validateStructuredPlanSnapshot(body,{source,preview,mapping});
 return snapshot?{snapshot,error:null}:{snapshot:null,error:'ผลตรวจไม่ตรงกับแหล่งข้อมูลและรายการที่กำหนด ระบบจึงไม่รับผลยืนยันนี้'};
}

export default function StructuredMappingPanel({jobId,savedValue,suggestedDataset=null,disabled=false,onChange,onVerifiedChange}:StructuredMappingPanelProps){
 const [gate]=useState(()=>new StructuredRequestGate());
 const lastEmittedRef=useRef<string|null>(null),hydratedRef=useRef<string|null>(null),onChangeRef=useRef(onChange);
 const [reloadCount,setReloadCount]=useState(0),[loadResult,setLoadResult]=useState<LoadResult|null>(null);
 const [dataset,setDataset]=useState<StructuredDataset>(suggestedDataset??'tuition_fees');
 const [decisions,setDecisions]=useState<TableDraft[]>([]),[step,setStep]=useState<Step>(0),[activeTable,setActiveTable]=useState(0);
 const [rangeDraft,setRangeDraft]=useState<RangeDraft>({tableIndex:-1,start:0,end:0,reason:'HEADER',note:''});
 const [plan,setPlan]=useState<Record<string,unknown>|null>(null),[acknowledgment,setAcknowledgment]=useState<StructuredMappingAcknowledgment|null>(null);
 const [publicationAvailable,setPublicationAvailable]=useState<boolean|null>(null),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  onVerifiedChange?.(Boolean(plan&&acknowledgment&&publicationAvailable===true&&!pending));
  return()=>onVerifiedChange?.(false);
 },[plan,acknowledgment,publicationAvailable,pending,onVerifiedChange]);
 const savedSignature=signature(savedValue),normalizedSavedValue=useMemo(()=>JSON.parse(savedSignature) as StructuredMappingChange,[savedSignature]);

 useEffect(()=>{onChangeRef.current=onChange;},[onChange]);

 const emitChange=useCallback((value:StructuredMappingChange)=>{
  lastEmittedRef.current=signature(value);onChangeRef.current(value);
 },[]);
 const resourceKey=`${jobId}:${reloadCount}`;
 const currentLoad=loadResult?.key===resourceKey?loadResult:null;
 const loadState:LoadState=currentLoad?.state??'loading';
 const loadError=currentLoad?.state==='failed'?currentLoad.error:'';
 const source=currentLoad?.state==='verified'?currentLoad.source:null;
 const preview=currentLoad?.state==='verified'?currentLoad.preview:null;
 const currentMapping=useMemo(()=>buildMapping(dataset,decisions,source,preview),[dataset,decisions,source,preview]);

 useEffect(()=>{
  const lease=gate.begin();
  const base=`/api/knowledge/imports/${encodeURIComponent(jobId)}`;
  void Promise.all([
   fetch(`${base}/structured`,{cache:'no-store',credentials:'same-origin',signal:lease.signal}),
   fetch(`${base}/preview`,{cache:'no-store',credentials:'same-origin',signal:lease.signal}),
  ]).then(async([sourceResponse,previewResponse])=>{
   const [sourceBody,previewBody]=await Promise.all([readJson(sourceResponse),readJson(previewResponse)]);
   if(!lease.isCurrent())return;
   const parsedSource=sourceResponse.ok?parseStructuredSourceEnvelope(sourceBody,jobId):null;
   const parsedPreview=previewResponse.ok?parseStructuredPreviewEnvelope(previewBody,jobId):null;
   if(!parsedSource||!parsedPreview||parsedPreview.job.revision!==parsedSource.jobRevision||parsedPreview.extractionRevision!==parsedSource.extractionRevision){
    setLoadResult({key:resourceKey,state:'failed',error:'ตรวจสอบแหล่งข้อมูลไม่สำเร็จ โปรดลองโหลดผลสกัดล่าสุดอีกครั้ง'});return;
   }
   setLoadResult({key:resourceKey,state:'verified',source:parsedSource,preview:parsedPreview});
  }).catch(()=>{
   if(lease.isCurrent())setLoadResult({key:resourceKey,state:'failed',error:'อ่านแหล่งข้อมูลไม่สำเร็จ โปรดตรวจการเชื่อมต่อแล้วลองอีกครั้ง'});
  });
  return()=>gate.invalidate();
 },[gate,jobId,reloadCount,resourceKey]);

 useEffect(()=>{
  if(!source||!preview||loadState!=='verified')return;
  const key=`${jobId}:${savedSignature}`;
  if(hydratedRef.current===key)return;
  if(lastEmittedRef.current===savedSignature)return;
  let cancelled=false;
  queueMicrotask(()=>{
   if(cancelled)return;
   hydratedRef.current=key;
   setPlan(null);setAcknowledgment(null);setPublicationAvailable(null);setMessage('');
   const stored=normalizedSavedValue.mapping?parseStructuredMappingDraft(normalizedSavedValue.mapping):null;
   if(!stored){
    setDecisions(undecided(preview.extraction.tables.length));setDataset(suggestedDataset??preview.datasetCandidate??'tuition_fees');setStep(0);setActiveTable(0);
    if(normalizedSavedValue.mapping){setMessage('รายการที่บันทึกไว้ไม่ตรงกับผลสกัดนี้ โปรดเลือกการจัดการของแต่ละตารางใหม่ก่อนตรวจ');emitChange({mapping:null,acknowledgment:null});}
    return;
   }
   const restored=decisionState(stored,preview.extraction.tables.length);
   const rebound=restored?buildMapping(stored.dataset,restored,source,preview):null;
   if(!restored||!rebound){
    setDecisions(undecided(preview.extraction.tables.length));setDataset(suggestedDataset??preview.datasetCandidate??'tuition_fees');
    setMessage('ช่วงแถวที่บันทึกไว้ไม่ตรงกับผลสกัดนี้ โปรดตรวจทุกตารางและทุกแถวก่อนส่งตรวจใหม่');
    emitChange({mapping:null,acknowledgment:null});return;
   }
   setDecisions(restored);setDataset(stored.dataset);setStep(0);setActiveTable(stored.tables[0]?.tableIndex??0);
   if(!sourceMatches(stored,source)){
    setMessage('รายการที่บันทึกไว้มาจากแหล่งข้อมูลฉบับก่อน คุณยังแก้การเลือกช่องข้อมูลได้ โปรดตรวจทุกแถวก่อนส่งตรวจอีกครั้ง');
    emitChange({mapping:rebound,acknowledgment:null});return;
   }
   const savedAck=normalizedSavedValue.acknowledgment;
   if(!savedAck)return;
   const lease=gate.begin();setPending(true);setMessage('กำลังตรวจผลยืนยันที่บันทึกไว้กับแหล่งข้อมูลปัจจุบัน…');
   void requestStructuredPlan(jobId,source,preview,rebound,lease.signal).then(result=>{
    if(cancelled||!lease.isCurrent())return;
    const checked=result.snapshot;
    if(checked&&checked.acknowledgment.contentDigest===savedAck.contentDigest&&checked.acknowledgment.mapperVersion===savedAck.mapperVersion){
     setPlan(checked.plan);setAcknowledgment(checked.acknowledgment);setPublicationAvailable(checked.publicationAvailable);setMessage('ผลยืนยันที่บันทึกไว้ตรงกับแหล่งข้อมูลและฉบับตรวจปัจจุบันแล้ว');
    }else{
     setPlan(null);setAcknowledgment(null);setPublicationAvailable(null);setMessage(result.error??'ตรวจผลยืนยันที่บันทึกไว้ไม่สำเร็จ โปรดตรวจรายการนี้อีกครั้ง');
     if(!('transient' in result&&result.transient))emitChange({mapping:rebound,acknowledgment:null});
    }
   }).catch(()=>{
    if(!cancelled&&lease.isCurrent()){setPlan(null);setAcknowledgment(null);setPublicationAvailable(null);setMessage('ยังตรวจผลยืนยันไม่ได้ ร่างที่บันทึกไว้ยังอยู่ โปรดลองตรวจอีกครั้งเมื่อเชื่อมต่อได้');}
   }).finally(()=>{if(!cancelled&&lease.isCurrent())setPending(false);});
  });
  return()=>{cancelled=true;if(hydratedRef.current===key)hydratedRef.current=null;};
 },[jobId,source,preview,loadState,savedSignature,normalizedSavedValue,suggestedDataset,emitChange,gate]);

 const applyDecisions=(next:TableDraft[],nextDataset=dataset)=>{
  gate.invalidate();setDecisions(next);setDataset(nextDataset);setPlan(null);setAcknowledgment(null);setPublicationAvailable(null);setPending(false);setMessage('');
  emitChange({mapping:buildMapping(nextDataset,next,source,preview),acknowledgment:null});
 };
 const editRangeDraft=(next:RangeDraft)=>{
  if(disabled)return;
  gate.invalidate();setPlan(null);setAcknowledgment(null);setPublicationAvailable(null);setPending(false);setMessage('');setRangeDraft(next);
  emitChange({mapping:currentMapping,acknowledgment:null});
 };
 const changeDataset=(next:StructuredDataset)=>{
  if(disabled||next===dataset)return;
  const remapped=decisions.map((decision,tableIndex):TableDraft=>decision.kind==='MAPPED'&&preview
   ?{kind:'MAPPED',tableIndex,fields:defaultsFor(next,preview.extraction.tables[tableIndex]!),excludedRanges:decision.excludedRanges}
   :decision);
  applyDecisions(remapped,next);
 };
 const chooseMapped=(tableIndex:number)=>{
  if(disabled||!preview)return;
  setActiveTable(tableIndex);
  applyDecisions(decisions.map((decision,index)=>index===tableIndex?{kind:'MAPPED',tableIndex,fields:defaultsFor(dataset,preview.extraction.tables[index]!),excludedRanges:[]}:decision));
 };
 const chooseExcluded=(tableIndex:number)=>{
  if(disabled)return;
  applyDecisions(decisions.map((decision,index)=>index===tableIndex?{kind:'EXCLUDED',tableIndex,reason:null,note:''}:decision));
  if(activeTable===tableIndex)setActiveTable(mappedTables.find(decision=>decision.tableIndex!==tableIndex)?.tableIndex??0);
 };
 const updateTableDecision=(tableIndex:number,update:(decision:TableDraft)=>TableDraft)=>{
  if(disabled)return;
  applyDecisions(decisions.map((decision,index)=>index===tableIndex?update(decision):decision));
 };
 const setFieldBinding=(tableIndex:number,fieldName:string,binding:StructuredFieldBinding|undefined)=>{
  updateTableDecision(tableIndex,decision=>decision.kind==='MAPPED'?{...decision,fields:{...decision.fields,[fieldName]:binding}}:decision);
 };
 const updateExcludedRange=(tableIndex:number,index:number,update:(range:StructuredExcludedRange)=>StructuredExcludedRange)=>{
  updateTableDecision(tableIndex,decision=>decision.kind==='MAPPED'?{...decision,excludedRanges:decision.excludedRanges.map((range,rangeIndex)=>rangeIndex===index?update(range):range)}:decision);
 };

 const tableStepComplete=decisions.length>0&&decisions.every(decision=>decision.kind==='MAPPED'||decision.kind==='EXCLUDED'&&
  (decision.reason!==null&&isHumanNote(decision.note)));
 const fieldStepComplete=currentMapping!==null;
 const mappedTables=decisions.filter((decision):decision is Extract<TableDraft,{kind:'MAPPED'}>=>decision.kind==='MAPPED');
 const activeDecision=decisions[activeTable];
 const activeSourceTable=preview?.extraction.tables[activeTable];
 const activeRangeDraft=rangeDraft.tableIndex===activeTable?rangeDraft:{tableIndex:activeTable,start:activeSourceTable?.firstRow??1,
  end:activeSourceTable?.firstRow??1,reason:'HEADER' as const,note:''};
 const dataCount=(decision:Extract<TableDraft,{kind:'MAPPED'}>,rowCount:number)=>{
  const excluded=[...decision.excludedRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex);let rows=rowCount;
  for(const range of excluded)rows-=range.endRowIndex-range.startRowIndex+1;return rows;
 };
 const isSourceReady=loadState==='verified'&&source!==null&&preview!==null;
 const checkedRowCount=plan&&Array.isArray(plan.rows)?plan.rows.length:null;

 const beginPrepare=async()=>{
  if(disabled||!source||!preview||!currentMapping||pending)return;
  const lease=gate.begin();setPending(true);setPlan(null);setAcknowledgment(null);setPublicationAvailable(null);
  setMessage('กำลังตรวจรายการกับผลสกัดปัจจุบัน…');emitChange({mapping:currentMapping,acknowledgment:null});
  try{
   const result=await requestStructuredPlan(jobId,source,preview,currentMapping,lease.signal);
   if(!lease.isCurrent())return;
   if(!result.snapshot){setMessage(result.error??'ระบบตรวจรายการนี้ไม่ผ่าน');return;}
   setPlan(result.snapshot.plan);setAcknowledgment(result.snapshot.acknowledgment);setPublicationAvailable(result.snapshot.publicationAvailable);
   setMessage('ตรวจแถวข้อมูลแล้ว และระบบออกผลยืนยันสำหรับรายการนี้แล้ว');
   emitChange({mapping:currentMapping,acknowledgment:result.snapshot.acknowledgment});
  }catch{
   if(lease.isCurrent())setMessage('ระบบตรวจรายการนี้ไม่สำเร็จ โปรดตรวจการเชื่อมต่อแล้วลองอีกครั้ง');
  }finally{if(lease.isCurrent())setPending(false);}
 };

  const stepNames=['ตาราง','ช่องข้อมูล','ตรวจทาน'] as const;
 const openStep=(next:Step)=>{
  if(next===0||next===1&&tableStepComplete||next===2&&fieldStepComplete)setStep(next);
 };

 return <section className="structured-mapping" aria-labelledby="structured-mapping-title">
  <header className="structured-mapping__header">
   <div><p className="structured-mapping__eyebrow">ข้อมูลที่มีโครงสร้าง · กำหนดข้อมูล</p>
    <h2 id="structured-mapping-title">ตรวจตารางและกำหนดชุดข้อมูล</h2>
    <p className="structured-mapping__intro">เลือกว่าจะใช้ตารางใด จับคู่ช่องข้อมูลและรูปแบบค่า แล้วส่งให้ระบบตรวจ ก่อนบันทึกในร่างตรวจ</p>
   </div>
   <span className={`structured-mapping__source-status is-${loadState}`} role="status">
    {loadState==='loading'?'กำลังยืนยันแหล่งข้อมูล':loadState==='verified'?'ยืนยันแหล่งข้อมูลแล้ว':'ตรวจแหล่งข้อมูลไม่ผ่าน'}
   </span>
  </header>

  {loadState==='loading'&&<div className="structured-mapping__notice" role="status">กำลังอ่านข้อมูลจากเอกสารนี้…</div>}
  {loadState==='failed'&&<div className="structured-mapping__notice is-error" role="alert"><p>{loadError}</p>
   <button type="button" className="structured-mapping__button" onClick={()=>setReloadCount(value=>value+1)}>ลองอ่านแหล่งข้อมูลอีกครั้ง</button>
  </div>}
  {isSourceReady&&preview&&source&&<>
   <div className="structured-mapping__source-line">
    <span>{preview.job.filename ?? 'เอกสารนำเข้า'}</span>
    <span>{preview.job.format}</span>
    <span>ฉบับเอกสาร {source.jobRevision} · ผลอ่าน {source.extractionRevision}</span>
    <span>{preview.extraction.tables.length} ตาราง · {preview.extraction.tables.reduce((sum,table)=>sum+table.rows.length,0)} แถวที่อ่านได้</span>
   </div>
   {preview.extraction.flags.length>0&&<div className="structured-mapping__flags" aria-label="ข้อสังเกตจากการสกัด">
    <strong>ข้อสังเกตจากการสกัด</strong>{preview.extraction.flags.map(flag=><span key={flag}>{flagLabels[flag]??'ต้องตรวจข้อมูลสกัด'}</span>)}
   </div>}

   <nav className="structured-mapping__steps" aria-label="ขั้นตอนกำหนดข้อมูล">
    {stepNames.map((name,index)=><button type="button" key={name} className={step===index?'is-current':''} aria-current={step===index?'step':undefined}
     disabled={disabled||index>0&&!tableStepComplete||index>1&&!fieldStepComplete} onClick={()=>openStep(index as Step)}>
     <span className="structured-mapping__step-number">0{index+1}</span><span>{name}</span>
    </button>)}
   </nav>

   {step===0&&<div className="structured-mapping__step-panel">
    <div className="structured-mapping__section-heading"><div><p className="structured-mapping__eyebrow">ขั้นที่ 1 จาก 3</p><h3>เลือกการจัดการทีละตาราง</h3></div>
     <label className="structured-mapping__dataset">ชุดข้อมูลปลายทาง
      <select value={dataset} disabled={disabled} onChange={event=>changeDataset(event.target.value as StructuredDataset)}>
       {STRUCTURED_DATASETS.map(item=><option key={item} value={item}>{datasetLabels[item]}</option>)}
      </select>
     </label>
    </div>
    <p className="structured-mapping__hint">เลือกใช้หรือยกเว้นทุกตาราง ตารางที่ยังไม่ตัดสินใจจะไม่ถูกรวมโดยอัตโนมัติ</p>
    <div className="structured-mapping__table-list">
     {preview.extraction.tables.map((table,index)=>{
      const decision=decisions[index]??{kind:'UNDECIDED' as const,tableIndex:index};
      const width=Math.max(...table.rows.map(row=>row.length));
      return <article className={`structured-mapping__table-card is-${decision.kind.toLowerCase()}`} key={index}>
       <div className="structured-mapping__table-topline"><div><span className="structured-mapping__table-index">ตาราง {String(index+1).padStart(2,'0')}</span>
        <h4>{structuredTableLabel(table)}</h4><p>{table.rows.length} แถว · {width} คอลัมน์ · {table.location.kind==='XLSX'?`แถว ${table.location.rowStart}–${table.location.rowEnd}`:table.location.kind==='CSV'?`ระเบียน ${table.location.rowStart}–${table.location.rowEnd}`:'ตำแหน่งตามลำดับเนื้อหา'}</p>
       </div><div className="structured-mapping__table-actions">
        {decision.kind!=='MAPPED'&&<button type="button" className="structured-mapping__button is-primary" disabled={disabled} onClick={()=>chooseMapped(index)}>ใช้กับ{datasetLabels[dataset]}</button>}
        {decision.kind!=='EXCLUDED'&&<button type="button" className="structured-mapping__button" disabled={disabled} onClick={()=>chooseExcluded(index)}>ไม่ใช้ตารางนี้</button>}
        {decision.kind==='MAPPED'&&<span className="structured-mapping__decision is-mapped">เลือกใช้แล้ว</span>}
        {decision.kind==='EXCLUDED'&&<span className="structured-mapping__decision is-excluded">ต้องระบุเหตุผลยกเว้น</span>}
        {decision.kind==='UNDECIDED'&&<span className="structured-mapping__decision is-undecided">ยังไม่ได้เลือก</span>}
       </div></div>
       <div className="structured-mapping__sample" role="region" aria-label={`ตัวอย่างข้อมูล ${structuredTableLabel(table)}`}>
        <div className="structured-mapping__sample-label">ตัวอย่างแถวต้นทาง</div>
        {table.rows.slice(0,4).map((row,rowIndex)=><div className="structured-mapping__sample-row" key={rowIndex}>
         <span className="structured-mapping__row-coordinate">{structuredRowLabel(table,rowIndex)}</span>
         <span>{row.slice(0,4).map((cell,columnIndex)=><b key={columnIndex} title={cell}>{cell||'—'}</b>)}{row.length>4&&<i>+{row.length-4} คอลัมน์</i>}</span>
        </div>)}
        {table.rows.length>4&&<p className="structured-mapping__more">แสดง 4 จาก {table.rows.length} แถว</p>}
       </div>
       {decision.kind==='EXCLUDED'&&<div className="structured-mapping__exclude-form">
        <label>เหตุผล
         <select value={decision.reason??''} disabled={disabled} onChange={event=>updateTableDecision(index,current=>current.kind==='EXCLUDED'?{...current,reason:event.target.value as 'NOT_THIS_DATASET'|'NON_DATA'|null}:current)}>
          <option value="">เลือกเหตุผล</option><option value="NOT_THIS_DATASET">เป็นข้อมูลคนละชุด</option><option value="NON_DATA">ไม่ใช่ตารางข้อมูล</option>
         </select>
        </label>
        <label>หมายเหตุที่เขียนเอง
         <textarea value={decision.note} maxLength={500} disabled={disabled} placeholder="อธิบายเหตุผลเฉพาะของตารางนี้" onChange={event=>updateTableDecision(index,current=>current.kind==='EXCLUDED'?{...current,note:event.target.value}:current)}/>
        </label><span className="structured-mapping__field-help">ต้องมีเหตุผลและหมายเหตุสั้น ๆ ก่อนตรวจต่อ</span>
       </div>}
       {decision.kind==='MAPPED'&&<div className="structured-mapping__table-summary">
        <span>{dataCount(decision,table.rows.length)} แถวเป็นข้อมูล</span><span>{decision.excludedRanges.length} ช่วงที่ยกเว้น</span>
       </div>}
      </article>;
     })}
    </div>
    <div className="structured-mapping__footer"><span>เลือกแล้ว {decisions.filter(decision=>decision.kind!=='UNDECIDED').length} จาก {decisions.length} ตาราง</span>
     <button type="button" className="structured-mapping__button is-primary" disabled={disabled||!tableStepComplete||mappedTables.length===0} onClick={()=>setStep(1)}>ต่อไป: ช่องข้อมูล</button>
    </div>
   </div>}

   {step===1&&<div className="structured-mapping__step-panel">
    <div className="structured-mapping__section-heading"><div><p className="structured-mapping__eyebrow">ขั้นที่ 2 จาก 3</p><h3>จับคู่ช่องข้อมูลและเลือกแถว</h3></div>
     <span className="structured-mapping__dataset-badge">{datasetLabels[dataset]}</span>
    </div>
    <p className="structured-mapping__hint">ระบบเสนอคอลัมน์เริ่มต้นเมื่อรู้จักหัวตาราง โปรดตรวจคอลัมน์และรูปแบบค่าของทุกช่อง</p>
    {mappedTables.length===0&&<div className="structured-mapping__notice is-error">ต้องเลือกใช้อย่างน้อยหนึ่งตาราง</div>}
    {mappedTables.length>0&&<div className="structured-mapping__field-workspace">
      <aside className="structured-mapping__table-rail" aria-label="ตารางที่กำลังจับคู่ข้อมูล">
      {mappedTables.map(decision=>{const table=preview.extraction.tables[decision.tableIndex]!;return <button type="button" key={decision.tableIndex} className={activeTable===decision.tableIndex?'is-current':''} disabled={disabled} onClick={()=>setActiveTable(decision.tableIndex)}>
       <strong>{structuredTableLabel(table)}</strong><span>{dataCount(decision,table.rows.length)} แถวข้อมูล</span>
      </button>;})}
     </aside>
     {activeDecision?.kind==='MAPPED'&&activeSourceTable&&<div className="structured-mapping__field-editor">
      <header><div><h4>{structuredTableLabel(activeSourceTable)}</h4><p>ช่องข้อมูลปลายทางและแหล่งค่าของตารางนี้</p></div>
       <span>{dataCount(activeDecision,activeSourceTable.rows.length)} แถวที่จะใช้</span></header>
      <div className="structured-mapping__field-list">
       {STRUCTURED_FIELD_REGISTRY[dataset].map(definition=><FieldEditor key={definition.name} definition={definition}
        binding={activeDecision.fields[definition.name]} table={activeSourceTable} disabled={disabled}
        onBindingChange={binding=>setFieldBinding(activeTable,definition.name,binding)}/>) }
      </div>
      <section className="structured-mapping__ranges" aria-labelledby="structured-mapping-ranges-title">
       <div className="structured-mapping__range-heading"><div><h5 id="structured-mapping-ranges-title">แยกแถวที่ไม่ใช่ข้อมูล</h5>
        <p>ระบุทุกแถวเป็นข้อมูล หรือยกเว้นพร้อมเหตุผลและหมายเหตุ</p></div>
        <span>ใช้เป็นข้อมูล {dataCount(activeDecision,activeSourceTable.rows.length)} จาก {activeSourceTable.rows.length} แถว</span>
       </div>
       {activeDecision.excludedRanges.length>0&&<ul className="structured-mapping__range-list">
        {activeDecision.excludedRanges.map((range,rangeIndex)=><li key={`${range.startRowIndex}-${range.endRowIndex}`}>
         <span>{structuredRowLabel(activeSourceTable,range.startRowIndex)}{range.endRowIndex!==range.startRowIndex?` – ${structuredRowLabel(activeSourceTable,range.endRowIndex)}`:''}</span>
         <select value={range.reason} disabled={disabled} aria-label="เหตุผลยกเว้นแถว" onChange={event=>updateExcludedRange(activeTable,rangeIndex,current=>({...current,reason:event.target.value as 'HEADER'|'NON_DATA'}))}>
          <option value="HEADER">หัวตาราง</option><option value="NON_DATA">ไม่ใช่ข้อมูล</option>
         </select>
         <input value={range.note} maxLength={500} disabled={disabled} aria-label="หมายเหตุยกเว้นแถว" onChange={event=>updateExcludedRange(activeTable,rangeIndex,current=>({...current,note:event.target.value}))}/>
         <button type="button" className="structured-mapping__text-button" disabled={disabled} onClick={()=>updateTableDecision(activeTable,current=>current.kind==='MAPPED'?{...current,excludedRanges:current.excludedRanges.filter((_,index)=>index!==rangeIndex)}:current)}>นำช่วงนี้ออก</button>
        </li>)}
       </ul>}
       <div className="structured-mapping__range-add">
        <label>แถวเริ่มต้น <input type="number" min={activeSourceTable.firstRow} max={activeSourceTable.firstRow+activeSourceTable.rows.length-1} value={activeRangeDraft.start} disabled={disabled}
         onChange={event=>editRangeDraft({...activeRangeDraft,start:Number(event.target.value)})}/></label>
        <label>แถวสิ้นสุด <input type="number" min={activeSourceTable.firstRow} max={activeSourceTable.firstRow+activeSourceTable.rows.length-1} value={activeRangeDraft.end} disabled={disabled}
         onChange={event=>editRangeDraft({...activeRangeDraft,end:Number(event.target.value)})}/></label>
        <label>เหตุผล <select value={activeRangeDraft.reason} disabled={disabled} onChange={event=>editRangeDraft({...activeRangeDraft,reason:event.target.value as 'HEADER'|'NON_DATA'})}>
         <option value="HEADER">หัวตาราง</option><option value="NON_DATA">ไม่ใช่ข้อมูล</option>
        </select></label>
        <label className="structured-mapping__range-note">หมายเหตุที่เขียนเอง <input value={activeRangeDraft.note} maxLength={500} disabled={disabled} placeholder="เหตุผลเฉพาะช่วงแถวนี้"
         onChange={event=>editRangeDraft({...activeRangeDraft,note:event.target.value})}/></label>
        <button type="button" className="structured-mapping__button" disabled={disabled||!isHumanNote(activeRangeDraft.note)||activeRangeDraft.start>activeRangeDraft.end||
         activeRangeDraft.start<activeSourceTable.firstRow||activeRangeDraft.end>=activeSourceTable.firstRow+activeSourceTable.rows.length}
         onClick={()=>{
          const range:StructuredExcludedRange={startRowIndex:activeRangeDraft.start-activeSourceTable.firstRow,endRowIndex:activeRangeDraft.end-activeSourceTable.firstRow,
           reason:activeRangeDraft.reason,note:activeRangeDraft.note};
          updateTableDecision(activeTable,current=>current.kind==='MAPPED'?{...current,excludedRanges:[...current.excludedRanges,range]}:current);
          setRangeDraft({...activeRangeDraft,start:activeSourceTable.firstRow,end:activeSourceTable.firstRow,note:''});
        }}>เพิ่มช่วงแถวที่ยกเว้น</button>
       </div>
       {dataCount(activeDecision,activeSourceTable.rows.length)<1&&<p className="structured-mapping__inline-error">ต้องเหลืออย่างน้อยหนึ่งแถวข้อมูล หรือเปลี่ยนทั้งตารางเป็นตารางยกเว้น</p>}
      </section>
     </div>}
    </div>}
    <div className="structured-mapping__footer"><button type="button" className="structured-mapping__button" disabled={disabled} onClick={()=>setStep(0)}>ย้อนกลับ: ตาราง</button>
     <span>{currentMapping?'ตรวจช่องข้อมูลและการแบ่งแถวเบื้องต้นแล้ว':'กำหนดทุกช่องและเพิ่มหมายเหตุให้ครบก่อนตรวจต่อ'}</span>
     <button type="button" className="structured-mapping__button is-primary" disabled={disabled||!fieldStepComplete} onClick={()=>setStep(2)}>ต่อไป: ตรวจทาน</button>
    </div>
   </div>}

   {step===2&&currentMapping&&<div className="structured-mapping__step-panel">
    <div className="structured-mapping__section-heading"><div><p className="structured-mapping__eyebrow">ขั้นที่ 3 จาก 3</p><h3>ตรวจทานก่อนส่งตรวจ</h3></div>
     <span className="structured-mapping__dataset-badge">{datasetLabels[currentMapping.dataset]}</span>
    </div>
    <p className="structured-mapping__hint">ระบบจะตรวจรายการที่กำหนดและส่งผลยืนยันกลับมา ขั้นตอนนี้ยังไม่ใช่การอนุมัติหรือเผยแพร่ข้อมูล</p>
    <div className="structured-mapping__review-grid">
     <article><span className="structured-mapping__review-number">{currentMapping.tables.length}</span><span>ตารางที่เลือกใช้</span></article>
     <article><span className="structured-mapping__review-number">{currentMapping.tables.reduce((sum,table)=>sum+table.dataRanges.reduce((count,range)=>count+range.endRowIndex-range.startRowIndex+1,0),0)}</span><span>แถวข้อมูล</span></article>
     <article><span className="structured-mapping__review-number">{currentMapping.excludedTables.length+currentMapping.tables.reduce((sum,table)=>sum+table.excludedRanges.length,0)}</span><span>ตารางหรือช่วงที่ยกเว้น</span></article>
     <article><span className="structured-mapping__review-number">{STRUCTURED_FIELD_REGISTRY[dataset].length*mappedTables.length}</span><span>ช่องข้อมูลที่ตรวจ</span></article>
    </div>
    <div className="structured-mapping__review-list">
     {preview.extraction.tables.map((table,index)=>{
      const decision=decisions[index];
      if(decision?.kind==='EXCLUDED')return <article key={index} className="is-excluded"><div><strong>{structuredTableLabel(table)}</strong><span>ยกเว้น · {decision.reason==='NOT_THIS_DATASET'?'คนละชุดข้อมูล':'ไม่ใช่ตารางข้อมูล'}</span></div><p>{decision.note}</p></article>;
      if(decision?.kind!=='MAPPED')return <article key={index} className="is-undecided"><strong>{structuredTableLabel(table)}</strong><span>ยังไม่ตัดสินใจ</span></article>;
      return <article key={index}><div><strong>{structuredTableLabel(table)}</strong><span>{dataCount(decision,table.rows.length)} แถวข้อมูล</span></div>
       <ul>{STRUCTURED_FIELD_REGISTRY[dataset].map(definition=>{const binding=decision.fields[definition.name];return <li key={definition.name}>
        <span>{definition.label}</span>{binding?.kind==='COLUMN'?<span>{structuredColumnLabel(table.location,binding.columnIndex)} · {transformLabels[binding.transform]}</span>:
         binding?.kind==='CONSTANT'?<span>ค่าคงที่: {binding.value===null?'ค่าว่าง':String(binding.value)} · {binding.note}</span>:<span>ยังไม่กำหนด</span>}
       </li>;})}</ul>
       {decision.excludedRanges.length>0&&<p>ยกเว้น {decision.excludedRanges.map(range=>`${structuredRowLabel(table,range.startRowIndex)}–${structuredRowLabel(table,range.endRowIndex)} (${range.note})`).join(' · ')}</p>}
      </article>;
     })}
    </div>
    {message&&<div className={`structured-mapping__notice ${acknowledgment?'is-confirmed':''}`} role="status">{message}</div>}
    {acknowledgment&&<div className="structured-mapping__ack-card"><div><strong>ระบบตรวจและยืนยันรายการนี้แล้ว</strong></div>
     {checkedRowCount!==null&&<p>จำนวนแถวที่ตรวจแล้ว: <strong>{checkedRowCount}</strong></p>}
     {publicationAvailable!==null&&<p>{publicationAvailable?'รายการนี้ส่งต่อไปขั้นตอนเผยแพร่ได้':'ระบบยังไม่เปิดให้เผยแพร่รายการนี้'}</p>}
    </div>}
    <p className="structured-mapping__fine-print">การเผยแพร่ยังต้องผ่านขั้นตอนตรวจทานและอนุมัติแยกต่างหาก</p>
    <div className="structured-mapping__footer"><button type="button" className="structured-mapping__button" disabled={disabled||pending} onClick={()=>setStep(1)}>ย้อนกลับ: ช่องข้อมูล</button>
     <button type="button" className="structured-mapping__button is-primary" disabled={disabled||pending||!currentMapping} onClick={()=>void beginPrepare()}>
      {pending?'กำลังตรวจ…':acknowledgment?'ตรวจอีกครั้ง':'ส่งให้ระบบตรวจ'}
     </button>
    </div>
   </div>}
   {step===2&&!currentMapping&&<div className="structured-mapping__notice is-error" role="alert">รายการยังไม่สมบูรณ์ โปรดเลือกทุกตารางและกำหนดช่องข้อมูลให้ครบ</div>}
  </>}
 </section>;
}

function FieldEditor({definition,binding,table,disabled,onBindingChange}:{definition:StructuredFieldDefinition;binding:StructuredFieldBinding|undefined;
 table:StructuredClientPreview['extraction']['tables'][number];disabled:boolean;onBindingChange:(value:StructuredFieldBinding|undefined)=>void}){
 const width=Math.max(...table.rows.map(row=>row.length)),sample=table.rows.slice(0,3).map(row=>row[binding?.kind==='COLUMN'?binding.columnIndex:0]??'').filter(Boolean);
 const chooseKind=(kind:string)=>{
  if(kind==='COLUMN')onBindingChange({kind:'COLUMN',columnIndex:-1 as unknown as number,transform:compatibleStructuredTransforms(definition.kind)[0]!,blank:definition.nullable?'NULL':'REJECT'});
  else if(kind==='CONSTANT')onBindingChange({kind:'CONSTANT',value:definition.nullable?null:'',note:''});
  else onBindingChange(undefined);
 };
 return <article className={`structured-mapping__field ${binding?'is-bound':'is-missing'}`}>
  <div className="structured-mapping__field-title"><div><strong>{definition.label}</strong><span>{fieldKindLabels[definition.kind]} · {definition.nullable?'ไม่บังคับ':'ต้องระบุ'}</span></div>
   <select aria-label={`${definition.label}: เลือกแหล่งข้อมูล`} value={binding?.kind??''} disabled={disabled} onChange={event=>chooseKind(event.target.value)}>
    <option value="">เลือกแหล่งค่า</option><option value="COLUMN">คอลัมน์จากเอกสาร</option><option value="CONSTANT">ค่าคงที่</option>
   </select>
  </div>
  {binding?.kind==='COLUMN'&&<div className="structured-mapping__binding-controls">
   <label>คอลัมน์ต้นทาง
    <select value={binding.columnIndex<0?'':String(binding.columnIndex)} disabled={disabled} onChange={event=>onBindingChange({...binding,columnIndex:event.target.value===''?-1:Number(event.target.value)})}>
     <option value="">เลือกคอลัมน์</option>{Array.from({length:width},(_,columnIndex)=><option key={columnIndex} value={columnIndex}>
      {structuredColumnLabel(table.location,columnIndex)} · แถวแรก “{table.rows[0]?.[columnIndex]||'ว่าง'}”
     </option>)}
    </select>
   </label>
   <label>รูปแบบค่า
    <select value={binding.transform} disabled={disabled} onChange={event=>onBindingChange({...binding,transform:event.target.value as StructuredTransform})}>
     {compatibleStructuredTransforms(definition.kind).map(transform=><option key={transform} value={transform}>{transformLabels[transform]}</option>)}
    </select>
   </label>
   <label>เซลล์ว่าง
    <select value={binding.blank} disabled={disabled||!definition.nullable} onChange={event=>onBindingChange({...binding,blank:event.target.value as 'REJECT'|'NULL'})}>
     <option value="REJECT">ให้ตรวจไม่ผ่าน</option>{definition.nullable&&<option value="NULL">แปลงเป็นไม่มีค่า</option>}
    </select>
   </label>
   <p className="structured-mapping__field-help">คอลัมน์อ้างอิงตำแหน่งจริงจากต้นทาง · ตัวอย่างค่า: {sample.length?sample.join(' / '):'ยังไม่มีตัวอย่าง'}</p>
  </div>}
  {binding?.kind==='CONSTANT'&&<div className="structured-mapping__constant-controls">
   <label>ค่าคงที่ {definition.nullable&&<select aria-label={`${definition.label}: ประเภทค่าคงที่`} value={binding.value===null?'NULL':typeof binding.value==='number'?'NUMBER':'TEXT'} disabled={disabled}
    onChange={event=>onBindingChange({...binding,value:event.target.value==='NULL'?null:event.target.value==='NUMBER'?0:''})}>
     <option value="TEXT">ข้อความ</option><option value="NUMBER">ตัวเลข</option><option value="NULL">ไม่มีค่า</option>
    </select>}
    {binding.value===null?<span className="structured-mapping__null-value">ไม่มีค่า</span>:typeof binding.value==='number'?<input type="number" step={definition.kind==='INTEGER'?'1':'any'} value={binding.value} disabled={disabled} onChange={event=>onBindingChange({...binding,value:event.target.value===''?Number.NaN:Number(event.target.value)})}/>:
     <input value={binding.value} maxLength={definition.maxLength??5000} disabled={disabled} onChange={event=>onBindingChange({...binding,value:event.target.value})}/>}</label>
   <label>เหตุผลของค่าคงที่ที่เขียนเอง<textarea value={binding.note} maxLength={500} disabled={disabled} placeholder="ระบุแหล่งหรือเหตุผลจริงของค่าคงที่" onChange={event=>onBindingChange({...binding,note:event.target.value})}/></label>
   <p className="structured-mapping__field-help">ค่าคงที่ต้องมีเหตุผลที่ผู้ตรวจเขียนเอง</p>
  </div>}
  {!binding&&<p className="structured-mapping__field-help">เลือกคอลัมน์จากต้นทางหรือระบุค่าคงที่พร้อมเหตุผล</p>}
 </article>;
}
