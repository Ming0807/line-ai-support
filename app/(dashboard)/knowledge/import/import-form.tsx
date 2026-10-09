'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {ChangeEvent,FormEvent} from 'react';
import type {ImportPreview} from '@/lib/imports/import-extraction';
import type {ImportJobView} from '@/lib/imports/import-staging';
import type {SourceLocation} from '@/lib/imports/types';
import {isReceiptEnvelope} from '@/lib/imports/publication-response';
import {getImportFlowSteps,type ImportFlowStage} from './import-flow';
import ReviewForm from './review-form';

type ApiResponse={response:Response;body:unknown};
type EditConflict={id:string;label:string;previousValue:string;latestValue:string|null;draftValue:string;location:string;targetExists:boolean;acknowledged:boolean};
type DraftSnapshot={preview:ImportPreview;titleDraft:string;pageDrafts:Record<number,string>;cellDrafts:Record<string,string>;reason:string};
const formatName:Record<ImportJobView['format'],string>={PDF:'PDF',DOCX:'Word',XLSX:'Excel',CSV:'CSV',HTML:'HTML'};
const errorLabels:Record<string,string>={
 UNAUTHENTICATED:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',FORBIDDEN:'บัญชีนี้ไม่มีสิทธิ์จัดการเอกสาร',NOT_FOUND:'ไม่พบรายการนำเข้านี้',
 CONFLICT:'มีการเปลี่ยนฉบับระหว่างทำรายการ กรุณาโหลดฉบับล่าสุดก่อนบันทึก',INVALID_REQUEST:'ข้อมูลไม่ครบหรือรูปแบบไม่รองรับ ตรวจไฟล์และช่องกรอกแล้วลองอีกครั้ง',
 INTERNAL_ERROR:'ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง',INVALID_ORIGIN:'คำขอไม่ผ่านการตรวจสอบแหล่งที่มา',IMPORT_BODY_TOO_LARGE:'ไฟล์มีขนาดเกิน 20 MB',
 IMPORT_BODY_TIMEOUT:'รับไฟล์ไม่ทันเวลา ลองใช้เครือข่ายที่เสถียรขึ้น',IMPORT_BODY_CANCELLED:'ยกเลิกการรับไฟล์แล้ว',IMPORT_URL_INVALID:'URL ต้องเป็น HTTPS ของเว็บไซต์มหาวิทยาลัยที่อนุญาต',
 IMPORT_URL_UNAVAILABLE:'อ่านเว็บไซต์ไม่สำเร็จ ตรวจ URL แล้วลองอีกครั้ง',IMPORT_URL_TIMEOUT:'เว็บไซต์ตอบกลับช้าเกินเวลาที่กำหนด',IMPORT_URL_TOO_LARGE:'เนื้อหาจากเว็บไซต์มีขนาดเกินขีดจำกัด',
 IMPORT_URL_CANCELLED:'ยกเลิกการอ่านเว็บไซต์แล้ว',IMPORT_PARSE_INVALID:'อ่านโครงสร้างไฟล์ไม่สำเร็จ ตรวจไฟล์ต้นฉบับแล้วลองอีกครั้ง',
 IMPORT_PARSER_UNAVAILABLE:'ตัวอ่านรูปแบบนี้ยังไม่พร้อมใช้งาน',IMPORT_PARSE_TIMEOUT:'ใช้เวลาอ่านไฟล์เกินกำหนด',
};
const warningLabels:Record<string,string>={
 OCR_REQUIRED:'เอกสารอาจต้องใช้ OCR',LOW_TEXT_QUALITY:'คุณภาพข้อความต่ำ',UNSUPPORTED_TABLES:'มีตารางที่อ่านได้ไม่ครบ',ENCRYPTED_SOURCE:'ไฟล์มีการเข้ารหัส',
 FORMULAS_PRESENT:'พบสูตรในตาราง',HIDDEN_DATA_REVIEW:'พบข้อมูลซ่อนที่ต้องตรวจ',EXTERNAL_LINKS_REVIEW:'พบลิงก์ภายนอกที่ต้องตรวจ',
 PAGE_REVIEW_REQUIRED:'ต้องตรวจข้อความหรือหน้าเอกสาร',TABLE_SHAPE_REVIEW:'รูปแบบตารางต้องตรวจ',SOURCE_REVIEW_REQUIRED:'แหล่งที่มาต้องตรวจ',
 ACADEMIC_YEAR_AMBIGUOUS:'ปีการศึกษาไม่ชัดเจน',FAMILY_AMBIGUOUS:'ประเภทเอกสารไม่ชัดเจน',STRUCTURED_SCHEMA_UNAVAILABLE:'ยังไม่มีชุดข้อมูลที่รองรับ',
 SENSITIVE_DATA_REVIEW_REQUIRED:'อาจมีข้อมูลละเอียดอ่อน',
};
const sensitiveLabels:Record<string,string>={STUDENT_RECORDS:'ข้อมูลนักศึกษา',PHONE:'หมายเลขโทรศัพท์',PERSONAL_EMAIL:'อีเมลส่วนบุคคล',GRADES:'ผลการเรียน',MEDICAL:'ข้อมูลสุขภาพ',PERSONAL_FINANCE:'ข้อมูลการเงินส่วนบุคคล'};

function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null;}
function isJob(value:unknown):value is ImportJobView{
 return isRecord(value)&&typeof value.id==='string'&&(value.status==='READY'||value.status==='FAILED')&&typeof value.revision==='number'&&
  typeof value.filename==='string'&&['PDF','DOCX','XLSX','CSV','HTML'].includes(String(value.format))&&typeof value.byteLength==='number'&&typeof value.createdAt==='string';
}
function isPreview(value:unknown):value is ImportPreview{
 return isRecord(value)&&isJob(value.job)&&typeof value.extractionRevision==='number'&&
  (value.kind==='PARSED'||value.kind==='EDITED')&&isRecord(value.extraction)&&Array.isArray(value.extraction.pages)&&Array.isArray(value.extraction.tables)&&
  isRecord(value.analysis)&&Array.isArray(value.analysis.flags);
}
async function requestJson(url:string,init?:RequestInit):Promise<ApiResponse>{
 const response=await fetch(url,{...init,cache:'no-store',credentials:'same-origin'});
 const body:unknown=await response.json().catch(()=>null);
 return {response,body};
}
function errorMessage(result:ApiResponse,fallback='ระบบทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง'){
 const code=isRecord(result.body)&&typeof result.body.error==='string'?result.body.error:'';
 return errorLabels[code]??(result.response.status===409?errorLabels.CONFLICT:fallback);
}
function getPreview(result:ApiResponse):ImportPreview|null{
 return result.response.ok&&isRecord(result.body)&&isPreview(result.body.preview)?result.body.preview:null;
}
function getJob(result:ApiResponse):ImportJobView|null{
 return result.response.ok&&isRecord(result.body)&&isJob(result.body.job)?result.body.job:null;
}
function formatLocation(location:SourceLocation|undefined){
 if(!location)return 'ไม่พบตำแหน่งต้นทาง';
 switch(location.kind){
  case 'PDF':return `PDF หน้า ${location.pageNumber} · ช่วงข้อความ ${location.blockStart}–${location.blockEnd}`;
  case 'DOCX':return `Word · ${location.headingPath.length?location.headingPath.join(' / '):'เนื้อหา'} · ช่วง ${location.blockStart}–${location.blockEnd}`;
  case 'XLSX':return `Excel ${location.sheetName} · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}`;
  case 'CSV':return `CSV · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}`;
  case 'HTML':return `HTML · ${location.headingPath.length?location.headingPath.join(' / '):'เนื้อหา'} · ช่วง ${location.blockStart}–${location.blockEnd}`;
 }
}
function tableSourceSignature(preview:ImportPreview,index:number){
 const table=preview.extraction.tables[index];
 return JSON.stringify({location:preview.extraction.locations.tables[index]??null,pageNumber:table?.pageNumber??null,sectionTitle:table?.sectionTitle??null,
  sheetName:table?.sheetName??null,firstRow:table?.firstRow??null});
}
function rebaseDrafts(snapshot:DraftSnapshot,next:ImportPreview){
 const pages:Record<number,string>={},cells:Record<string,string>={},conflicts:EditConflict[]=[];
 const old=snapshot.preview.extraction,current=next.extraction;
 for(const [rawIndex,draftValue] of Object.entries(snapshot.pageDrafts)){
  const index=Number(rawIndex),oldPage=old.pages[index],newPage=current.pages[index];
  if(!oldPage||draftValue===oldPage.text)continue;
  if(newPage&&draftValue===newPage.text)continue;
  pages[index]=draftValue;
  const locationChanged=JSON.stringify(snapshot.preview.extraction.locations.pages[index]??null)!==JSON.stringify(current.locations.pages[index]??null);
  if(!newPage||oldPage.text!==newPage.text||locationChanged)conflicts.push({id:`page:${index}`,label:`หน้า ${index+1}`,previousValue:oldPage.text,latestValue:newPage?.text??null,draftValue,
   location:newPage?formatLocation(current.locations.pages[index]):'ไม่มีตำแหน่งหน้านี้ในฉบับล่าสุด',targetExists:Boolean(newPage),acknowledged:false});
 }
 const oldTitle=old.title??'',newTitle=current.title??'';
 if(snapshot.titleDraft!==oldTitle&&snapshot.titleDraft!==newTitle&&oldTitle!==newTitle){
  conflicts.push({id:'title',label:'ชื่อเรื่อง',previousValue:oldTitle,latestValue:current.title,draftValue:snapshot.titleDraft,location:'ชื่อเอกสาร',targetExists:true,acknowledged:false});
 }
 for(const [key,draftValue] of Object.entries(snapshot.cellDrafts)){
  const [tableIndex,rowIndex,columnIndex]=key.split(':').map(Number);
  const oldTable=old.tables[tableIndex],newTable=current.tables[tableIndex];
  const oldValue=oldTable?.rows[rowIndex]?.[columnIndex],newValue=newTable?.rows[rowIndex]?.[columnIndex];
  if(oldValue===undefined||draftValue===oldValue)continue;
  if(newValue!==undefined&&draftValue===newValue)continue;
  cells[key]=draftValue;
  const targetExists=newValue!==undefined;
  const locationChanged=tableSourceSignature(snapshot.preview,tableIndex)!==tableSourceSignature(next,tableIndex)||
   JSON.stringify(oldTable?.rows[rowIndex]?.length??null)!==JSON.stringify(newTable?.rows[rowIndex]?.length??null);
  if(!targetExists||oldValue!==newValue||locationChanged){
   const rowLabel=(newTable?.firstRow??oldTable?.firstRow??1)+rowIndex;
   const source=`${newTable?.sheetName?`ชีต ${newTable.sheetName} · `:''}ตาราง ${tableIndex+1} · แถว ${rowLabel} · คอลัมน์ ${columnIndex+1}`;
   conflicts.push({id:`cell:${key}`,label:`ตาราง ${tableIndex+1} แถว ${rowLabel} คอลัมน์ ${columnIndex+1}`,previousValue:oldValue,latestValue:newValue??null,draftValue,
    location:targetExists?`${source} · ${formatLocation(current.locations.tables[tableIndex])}`:`${source} · ไม่มีช่องนี้ในฉบับล่าสุด`,targetExists,acknowledged:false});
  }
 }
 const titleDraft=snapshot.titleDraft!==oldTitle&&snapshot.titleDraft!==newTitle?snapshot.titleDraft:newTitle;
 const hasEdits=titleDraft!==newTitle||Object.keys(pages).length>0||Object.keys(cells).length>0;
 return {titleDraft,pages,cells,conflicts,reason:hasEdits?snapshot.reason:''};
}

export default function ImportForm({initialJobs,initialJobId,initialListError}:{initialJobs:ImportJobView[];initialJobId:string|null;initialListError:boolean}){
 const [jobs,setJobs]=useState(initialJobs);
 const [listError,setListError]=useState(initialListError);
 const [mode,setMode]=useState<'FILE'|'URL'>('FILE');
 const [stage,setStage]=useState<ImportFlowStage>('upload');
 const [file,setFile]=useState<File|null>(null);
 const [sourceUrl,setSourceUrl]=useState('');
 const [provenanceUrl,setProvenanceUrl]=useState('');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [preview,setPreview]=useState<ImportPreview|null>(null);
 const [pageIndex,setPageIndex]=useState(0);
 const [tableIndex,setTableIndex]=useState(0);
 const [rowWindow,setRowWindow]=useState(0);
 const [columnWindow,setColumnWindow]=useState(0);
 const [titleDraft,setTitleDraft]=useState('');
 const [pageDrafts,setPageDrafts]=useState<Record<number,string>>({});
 const [cellDrafts,setCellDrafts]=useState<Record<string,string>>({});
 const [reason,setReason]=useState('');
 const [pending,setPending]=useState<string|null>(null);
 const [notice,setNotice]=useState('');
 const [failure,setFailure]=useState('');
 const [conflict,setConflict]=useState(false);
 const [editConflicts,setEditConflicts]=useState<EditConflict[]>([]);
 const [conflictIndex,setConflictIndex]=useState(0);
 const [reviewDirty,setReviewDirty]=useState(false);
 const [publishedJobId,setPublishedJobId]=useState<string|null>(null);
 const knownPublished=useRef(new Set<string>());
 const [receiptRefresh,setReceiptRefresh]=useState(0);
 const [sourceReceipt,setSourceReceipt]=useState<{jobId:string;refresh:number;state:'ready'|'error';completed:boolean}|null>(null);
 const [reviewRefreshKey,setReviewRefreshKey]=useState(0);
 const initialLoad=useRef<string|null>(null);

 const onReviewStateChange=useCallback((dirty:boolean,reviewPending:boolean,completedJobId:string|null)=>{
  setReviewDirty(dirty);
  if(completedJobId){knownPublished.current.add(completedJobId);setPublishedJobId(completedJobId);}
  setPending(current=>reviewPending?(current??'review'):(current==='review'?null:current));
 },[]);

 const loadPreview=useCallback(async(id:string,draftSnapshot:DraftSnapshot|null):Promise<boolean>=>{
  setPending('open');setFailure('');setNotice('');setConflict(false);
  try{
   const result=await requestJson(`/api/knowledge/imports/${encodeURIComponent(id)}/preview`);
   const next=getPreview(result);
   if(!next){
    if(result.response.status===409)setConflict(true);
    setFailure(errorMessage(result,'ยังไม่มีผลวิเคราะห์สำหรับรายการนี้ กด “วิเคราะห์เอกสาร” เพื่อเริ่มอ่านไฟล์'));
    return false;
   }
   setPreview(next);setSelectedId(next.job.id);setStage('prepare');
   setJobs(current=>[next.job,...current.filter(job=>job.id!==next.job.id)].slice(0,50));
   setReviewRefreshKey(value=>value+1);
   setPageIndex(0);setTableIndex(0);setRowWindow(0);setColumnWindow(0);
   if(draftSnapshot){
    const rebased=rebaseDrafts(draftSnapshot,next);
    setTitleDraft(rebased.titleDraft);setPageDrafts(rebased.pages);setCellDrafts(rebased.cells);setReason(rebased.reason);
    setEditConflicts(rebased.conflicts);setConflictIndex(0);
   }else{
    setTitleDraft(next.extraction.title??'');setPageDrafts({});setCellDrafts({});setReason('');setEditConflicts([]);setConflictIndex(0);
   }
   return true;
  }catch{setFailure('เชื่อมต่อระบบไม่ได้ ตรวจเครือข่ายแล้วลองใหม่');return false;}
  finally{setPending(null);}
 },[]);

 useEffect(()=>{
  if(initialJobId&&initialLoad.current!==initialJobId){initialLoad.current=initialJobId;setSelectedId(initialJobId);setStage('prepare');void loadPreview(initialJobId,null);}
 },[initialJobId,loadPreview]);

 const selectedJob=jobs.find(job=>job.id===selectedId)??preview?.job??null;
 const receiptJobId=selectedJob?.id??null;
 const sourceReceiptState=sourceReceipt?.jobId===receiptJobId&&sourceReceipt.refresh===receiptRefresh?sourceReceipt.state:'loading';
 const publicationComplete=receiptJobId!==null&&(receiptJobId===publishedJobId||sourceReceipt?.jobId===receiptJobId&&sourceReceipt.completed);
 const sourceMutationLocked=receiptJobId!==null&&(sourceReceiptState!=='ready'||publicationComplete);
 useEffect(()=>{
  if(!receiptJobId)return;
  const controller=new AbortController();let active=true;
  void requestJson(`/api/knowledge/imports/${encodeURIComponent(receiptJobId)}/publication`,{signal:controller.signal})
   .then(result=>{
    if(!active||controller.signal.aborted)return;
    if(!result.response.ok||!isReceiptEnvelope(result.body,receiptJobId)||
     result.body.publication.receipt===null&&knownPublished.current.has(receiptJobId)){
     setSourceReceipt({jobId:receiptJobId,refresh:receiptRefresh,state:'error',completed:knownPublished.current.has(receiptJobId)});return;
    }
    const completed=result.body.publication.receipt!==null;
    if(completed){knownPublished.current.add(receiptJobId);setPublishedJobId(receiptJobId);}
    setSourceReceipt({jobId:receiptJobId,refresh:receiptRefresh,state:'ready',completed});
   }).catch(()=>{if(active&&!controller.signal.aborted)setSourceReceipt({jobId:receiptJobId,refresh:receiptRefresh,state:'error',completed:knownPublished.current.has(receiptJobId)});});
  return()=>{active=false;controller.abort();};
 },[receiptJobId,receiptRefresh]);
 const hasDrafts=Boolean(preview&&titleDraft!==(preview.extraction.title??''))||
  Boolean(preview&&Object.entries(pageDrafts).some(([index,text])=>text!==preview.extraction.pages[Number(index)]?.text))||
  Boolean(preview&&Object.entries(cellDrafts).some(([key,text])=>{
   const [table,row,column]=key.split(':').map(Number);return text!==preview.extraction.tables[table]?.rows[row]?.[column];
  }))||reviewDirty;

 async function refreshJobs(){
  try{
   const result=await requestJson('/api/knowledge/imports');
   if(result.response.ok&&isRecord(result.body)&&Array.isArray(result.body.jobs)){
    setJobs(result.body.jobs.filter(isJob));setListError(false);
   }else setListError(true);
  }catch{setListError(true);}
 }
 function acceptPreview(next:ImportPreview,clearDrafts:boolean){
  setPreview(next);setSelectedId(next.job.id);setStage('prepare');setJobs(current=>[next.job,...current.filter(job=>job.id!==next.job.id)].slice(0,50));
  if(clearDrafts){setTitleDraft(next.extraction.title??'');setPageDrafts({});setCellDrafts({});setReason('');setEditConflicts([]);setConflictIndex(0);setReviewDirty(false);}
  setFailure('');setConflict(false);
 }
 async function selectJob(id:string){
  if(hasDrafts&&!window.confirm(id===selectedId?'มีข้อความแก้หรือร่างตรวจที่ยังไม่บันทึก การเปิดรายการซ้ำจะทิ้งข้อมูลในเครื่อง ต้องการเปิดใหม่หรือไม่':'มีข้อความแก้หรือร่างตรวจที่ยังไม่บันทึก หากเปลี่ยนเอกสาร ข้อมูลในเครื่องจะหาย ต้องการเปลี่ยนหรือไม่'))return;
  setSelectedId(id);setPreview(null);setStage('prepare');setTitleDraft('');setPageDrafts({});setCellDrafts({});setReason('');setEditConflicts([]);setConflictIndex(0);setReviewDirty(false);
  await loadPreview(id,null);
 }
 async function stageSource(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setFailure('');setNotice('');setConflict(false);
  if(hasDrafts&&!window.confirm('มีข้อความแก้หรือร่างตรวจที่ยังไม่บันทึก หากรับต้นฉบับใหม่ ข้อมูลในเครื่องอาจหาย ต้องการดำเนินการต่อหรือไม่'))return;
  if(mode==='FILE'&&(!file||file.size===0||file.size>20*1024*1024)){setFailure(file?'ไฟล์ต้องมีขนาดไม่เกิน 20 MB':'เลือกไฟล์ที่ต้องการนำเข้าก่อน');return;}
  if(mode==='URL'&&!sourceUrl.trim()){setFailure('กรอก URL ของเว็บไซต์มหาวิทยาลัยก่อน');return;}
  setPending('stage');
  try{
   let result:ApiResponse;
   if(mode==='URL')result=await requestJson('/api/knowledge/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:sourceUrl.trim()})});
   else{
    const form=new FormData();form.set('file',file as File);
    if(provenanceUrl.trim())form.set('sourceUrl',provenanceUrl.trim());
    result=await requestJson('/api/knowledge/import',{method:'POST',body:form});
   }
   const job=getJob(result);
   if(!job){setFailure(errorMessage(result,mode==='URL'?'นำเข้า URL ไม่สำเร็จ ตรวจที่อยู่เว็บไซต์แล้วลองใหม่':'อัปโหลดไม่สำเร็จ ตรวจชนิดและขนาดไฟล์แล้วลองใหม่'));return;}
   setJobs(current=>[job,...current.filter(item=>item.id!==job.id)].slice(0,50));
   setSelectedId(job.id);setPreview(null);setStage('prepare');setTitleDraft('');setPageDrafts({});setCellDrafts({});setReason('');setEditConflicts([]);setConflictIndex(0);setReviewDirty(false);
   setPageIndex(0);setTableIndex(0);setRowWindow(0);setColumnWindow(0);
   setNotice(result.response.status===200?'พบไฟล์เดิมในระบบ เปิดผลอ่านที่บันทึกไว้โดยไม่เริ่มการวิเคราะห์ใหม่':'รับต้นฉบับแล้ว กำลังเตรียมวิเคราะห์…');
   if(mode==='FILE'){setFile(null);setProvenanceUrl('');}
   else setSourceUrl('');
   await refreshJobs();
   if(result.response.status===200){
    await loadPreview(job.id,null);
   }else if(result.response.status===201){
    setPending('analyze');
    setNotice('รับต้นฉบับแล้ว กำลังวิเคราะห์โครงสร้างเอกสารอัตโนมัติ…');
    try{
     const pubCheck=await requestJson(`/api/knowledge/imports/${encodeURIComponent(job.id)}/publication`);
     if(pubCheck.response.ok&&isReceiptEnvelope(pubCheck.body,job.id)&&pubCheck.body.publication.receipt===null){
      const analyzeResult=await requestJson('/api/knowledge/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:job.id,revision:job.revision})});
      const next=getPreview(analyzeResult);
      if(next){
       acceptPreview(next,true);
       setNotice('นำเข้าและวิเคราะห์เสร็จสมบูรณ์ ตรวจสอบสรุปและข้อมูลที่ระบบจัดเตรียมด้านล่าง');
      }else{
       setFailure(errorMessage(analyzeResult,'วิเคราะห์เอกสารไม่สำเร็จ กด “วิเคราะห์เอกสาร” เพื่อลองใหม่'));
      }
     }else{
      setNotice('รับต้นฉบับแล้ว กด “วิเคราะห์เอกสาร” เพื่อเริ่มอ่านไฟล์');
     }
    }catch{
     setFailure('เชื่อมต่อระบบเพื่อวิเคราะห์อัตโนมัติไม่ได้ กด “วิเคราะห์เอกสาร” เพื่อลองใหม่');
    }
   }
  }catch{setFailure('เชื่อมต่อระบบไม่ได้ ตรวจเครือข่ายแล้วลองอัปโหลดอีกครั้ง');}
  finally{setPending(null);}
 }
 async function analyze(){
  if(!selectedJob||pending!==null||sourceMutationLocked)return;
  if(hasDrafts&&!window.confirm('การวิเคราะห์ใหม่จะสร้างผลอ่านชุดใหม่ ทำให้ร่างตรวจเดิมล้าสมัย และล้างข้อมูลร่างในเครื่อง ต้องการดำเนินการต่อหรือไม่'))return;
  setPending('analyze');setFailure('');setNotice('');setConflict(false);
  try{
   const result=await requestJson('/api/knowledge/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:selectedJob.id,revision:selectedJob.revision})});
   const next=getPreview(result);
   if(!next){if(result.response.status===409)setConflict(true);setFailure(errorMessage(result,'วิเคราะห์เอกสารไม่สำเร็จ รายการยังไม่เผยแพร่ คุณสามารถลองใหม่ได้'));await refreshJobs();return;}
   acceptPreview(next,true);setNotice('วิเคราะห์เสร็จแล้ว ตรวจข้อความและคำเตือนก่อนแก้ไข รายการยังไม่เผยแพร่');
  }catch{setFailure('เชื่อมต่อระบบไม่ได้ รายการยังไม่เผยแพร่ ลองวิเคราะห์อีกครั้ง');}
  finally{setPending(null);}
 }
 async function saveEdit(){
  if(!preview||pending!==null||sourceMutationLocked)return;
  if(reviewDirty&&!window.confirm('บันทึกการแก้ข้อความจะทำให้ร่างตรวจผูกกับฉบับเดิม คุณบันทึกข้อความแล้วเริ่มตรวจฉบับใหม่ได้ ต้องการดำเนินการต่อหรือไม่'))return;
  if(editConflicts.some(item=>!item.acknowledged||!item.targetExists)){setFailure('เปรียบเทียบฉบับล่าสุดและเลือกค่าที่จะเก็บก่อนบันทึก');return;}
  const pages=Object.entries(pageDrafts).flatMap(([index,text])=>text!==preview.extraction.pages[Number(index)]?.text?[{index:Number(index),text}]:[]);
  const cells=Object.entries(cellDrafts).flatMap(([key,text])=>{
   const [table,row,column]=key.split(':').map(Number);
   return text!==preview.extraction.tables[table]?.rows[row]?.[column]?[{table,row,column,text}]:[];
  });
  const title=titleDraft!==(preview.extraction.title??'')?titleDraft:undefined;
  if(!reason.trim()){setFailure('ระบุเหตุผลการแก้ไข 1–500 ตัวอักษร');return;}
  if(pages.length===0&&cells.length===0&&title===undefined){setFailure('แก้ข้อความหรือชื่อเรื่องก่อนบันทึก');return;}
  setPending('edit');setFailure('');setNotice('');setConflict(false);
  const edit={reason:reason.trim(),...(pages.length?{pages}:{}),...(cells.length?{cells}:{}),...(title!==undefined?{title}:{})};
  try{
   const result=await requestJson(`/api/knowledge/imports/${encodeURIComponent(preview.job.id)}/edit`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({revision:preview.job.revision,edit})});
   const next=getPreview(result);
   if(!next){if(result.response.status===409)setConflict(true);setFailure(errorMessage(result,'บันทึกฉบับแก้ไขไม่สำเร็จ ข้อความร่างยังอยู่ครบ'));return;}
   acceptPreview(next,true);setPageIndex(Math.min(pageIndex,next.extraction.pages.length-1));setTableIndex(Math.min(tableIndex,next.extraction.tables.length-1));
   setNotice('บันทึกข้อความแก้ไขเป็นฉบับใหม่แล้ว คำเตือนยังต้องตรวจและเอกสารยังไม่เผยแพร่');
  }catch{setFailure('เชื่อมต่อระบบไม่ได้ ข้อความร่างยังอยู่ครบ ลองบันทึกอีกครั้ง');}
  finally{setPending(null);}
 }
 async function reloadAfterConflict(){
  if(!selectedId)return;
  if(hasDrafts&&!window.confirm('โหลดฉบับล่าสุดและเก็บข้อความร่างไว้เพื่อตรวจเทียบหรือไม่'))return;
  const draftSnapshot:DraftSnapshot|null=preview?{preview,titleDraft,pageDrafts:{...pageDrafts},cellDrafts:{...cellDrafts},reason}:null;
  const loaded=await loadPreview(selectedId,draftSnapshot);
  if(loaded)setNotice('โหลดฉบับล่าสุดแล้ว ข้อความร่างเดิมยังอยู่ ตรวจความต่างก่อนบันทึก');
 }
 function resolveEditConflict(item:EditConflict,choice:'LATEST'|'DRAFT'){
  if(pending!==null||sourceMutationLocked)return;
  if(choice==='DRAFT'&&!item.targetExists)return;
  if(choice==='LATEST'){
   if(item.id==='title')setTitleDraft(preview?.extraction.title??'');
   else if(item.id.startsWith('page:')){
    const index=Number(item.id.slice('page:'.length));setPageDrafts(current=>{const next={...current};delete next[index];return next;});
   }else if(item.id.startsWith('cell:')){
    const key=item.id.slice('cell:'.length);setCellDrafts(current=>{const next={...current};delete next[key];return next;});
   }
   setEditConflicts(current=>current.filter(conflictItem=>conflictItem.id!==item.id));
   setConflictIndex(current=>Math.max(0,Math.min(current,editConflicts.length-2)));
  }else{
   setEditConflicts(current=>current.map(conflictItem=>conflictItem.id===item.id?{...conflictItem,acknowledged:true}:conflictItem));
  }
 }
 function changeDraftValue(conflictId:string,update:()=>void){
  if(pending!==null||sourceMutationLocked)return;
  update();
  setEditConflicts(current=>current.map(item=>item.id===conflictId&&item.acknowledged?{...item,acknowledged:false}:item));
 }
 function onFileChange(event:ChangeEvent<HTMLInputElement>){
  const next=event.target.files?.[0]??null;setFailure('');
  if(next&&next.size>20*1024*1024){setFile(null);setFailure('ไฟล์มีขนาดเกิน 20 MB');event.target.value='';return;}
  setFile(next);
 }

 const extraction=preview?.extraction;
 const extractionFlags=new Set<string>(extraction?.flags??[]);
 const analysisOnlyFlags=preview?preview.analysis.flags.filter(flag=>!extractionFlags.has(flag)):[];
 const hasSensitiveWarning=Boolean(preview&&preview.analysis.sensitiveCategories.length>0&&!extraction?.report.warnings.some(warning=>warning.code==='SENSITIVE_DATA_REVIEW_REQUIRED')&&!analysisOnlyFlags.includes('SENSITIVE_DATA_REVIEW_REQUIRED'));
 const preparationWarningCount=(extraction?.report.warnings.length??0)+analysisOnlyFlags.length+(hasSensitiveWarning?1:0);
 const page=extraction?.pages[pageIndex];
 const table=extraction?.tables[tableIndex];
 const pageText=page?pageDrafts[pageIndex]??page.text:'';
 const tableLocation=extraction?.locations.tables[tableIndex];
 const maxColumns=table?Math.max(0,...table.rows.map(row=>row.length)):0;
 const rowStart=rowWindow*20,columnStart=columnWindow*8;
 const visibleRows=table?.rows.slice(rowStart,rowStart+20)??[];
 const visibleColumns=Math.min(8,Math.max(0,maxColumns-columnStart));
 const conflictEntry=editConflicts[conflictIndex];
 const activeEditConflict=conflictEntry?{...conflictEntry,draftValue:conflictEntry.id==='title'?titleDraft:
  conflictEntry.id.startsWith('page:')?pageDrafts[Number(conflictEntry.id.slice(5))]??conflictEntry.draftValue:
  cellDrafts[conflictEntry.id.slice(5)]??conflictEntry.draftValue}:undefined;
 const unresolvedEditConflict=editConflicts.some(item=>!item.acknowledged||!item.targetExists);
 const canSave=Boolean(preview&&reason.trim()&&hasDrafts&&!unresolvedEditConflict&&pending===null&&!sourceMutationLocked);
 const flowSteps=getImportFlowSteps(stage,Boolean(selectedJob),Boolean(preview));

 return <div className="knowledge-workspace">
  <nav className="knowledge-import-flow" aria-label="ขั้นตอนนำเข้าและตรวจเอกสาร">
   <ol className="knowledge-import-steps">{flowSteps.map((step,index)=><li key={step.id}>
    <button type="button" className="knowledge-import-step" data-state={step.state} aria-current={step.state==='current'?'step':undefined} disabled={step.disabled||pending!==null} onClick={()=>setStage(step.id)}>
     <span className="knowledge-import-step-number" aria-hidden="true">{index+1}</span>
     <span className="knowledge-import-step-copy"><strong>{step.label}</strong><span>{step.state==='current'?'กำลังทำ':step.state==='complete'?'เสร็จแล้ว':step.state==='available'?'ไปต่อได้':'รอขั้นก่อน'}</span></span>
    </button>
   </li>)}</ol>
  </nav>

  {stage==='upload'&&<section className="knowledge-source-panel" aria-labelledby="source-title">
   <div className="knowledge-section-heading"><div><h2 id="source-title">เพิ่มต้นฉบับ</h2><p>ไฟล์ส่วนตัวจะถูกเก็บเข้ารหัสเพื่อการตรวจสอบ</p></div></div>
   <div className="knowledge-mode-tabs" aria-label="วิธีเพิ่มต้นฉบับ">
    <button type="button" aria-pressed={mode==='FILE'} onClick={()=>setMode('FILE')} disabled={pending!==null}>อัปโหลดไฟล์</button>
    <button type="button" aria-pressed={mode==='URL'} onClick={()=>setMode('URL')} disabled={pending!==null}>URL เว็บไซต์</button>
   </div>
   <form className="knowledge-source-form" onSubmit={stageSource}>
    {mode==='FILE'?<>
     <label className="knowledge-field">เลือกไฟล์ PDF, Word, Excel, CSV หรือ HTML
      <input type="file" accept=".pdf,.docx,.xlsx,.csv,.html,.htm,application/pdf,text/csv,text/html" onChange={onFileChange} disabled={pending!==null}/>
      <span className="knowledge-hint">ไม่เกิน 20 MB · ไฟล์เดิมจะไม่ถูกแก้ไข</span>
     </label>
     {file&&<p className="knowledge-file-choice">{file.name} · {Math.ceil(file.size/1024)} KB</p>}
     <details className="knowledge-source-details"><summary>เพิ่ม URL แหล่งที่มาทางการ (ถ้ามี)</summary>
      <label className="knowledge-field">URL แหล่งที่มาทางการ
       <input type="url" value={provenanceUrl} onChange={event=>setProvenanceUrl(event.target.value)} placeholder="https://www.yru.ac.th/…" disabled={pending!==null}/>
       <span className="knowledge-hint">ระบบจะใช้ตรวจสอบแหล่งที่มาเมื่อผู้ดูแลทบทวนเอกสาร</span>
      </label>
     </details>
    </>:<label className="knowledge-field">URL เว็บไซต์มหาวิทยาลัย
     <input type="url" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)} placeholder="https://www.yru.ac.th/…" required disabled={pending!==null}/>
     <span className="knowledge-hint">ระบบจะตรวจโดเมนและอ่านหน้าเว็บที่เข้าถึงได้โดยไม่ใช้บัญชีผู้ใช้</span>
    </label>}
    <button className="knowledge-button knowledge-button-primary" type="submit" disabled={pending!==null}>{pending==='stage'?'กำลังนำเข้าและประมวลผล…':pending==='analyze'?'กำลังวิเคราะห์เอกสาร…':mode==='FILE'?'นำเข้าเอกสาร':'นำเข้าจาก URL'}</button>
   </form>
  </section>}

  {stage==='upload'&&<details className="knowledge-previous-imports">
   <summary>รายการนำเข้าก่อนหน้า ({jobs.length})</summary>
   <section className="knowledge-import-list" aria-labelledby="import-list-title">
    <div className="knowledge-section-heading"><div><h2 id="import-list-title">รายการนำเข้า</h2><p>เปิดรายการเดิมเพื่อตรวจต่อหรือเริ่มวิเคราะห์อีกครั้ง</p></div><button className="knowledge-button knowledge-button-tertiary" type="button" onClick={()=>void refreshJobs()} disabled={pending!==null}>โหลดรายการใหม่</button></div>
    {listError&&<p className="knowledge-message knowledge-message-error" role="status">โหลดรายการล่าสุดไม่สำเร็จ รายการเดิมยังแสดงอยู่</p>}
    {jobs.length===0?<p className="knowledge-list-empty">ยังไม่มีรายการก่อนหน้า</p>:<ul className="knowledge-job-list">{jobs.map(job=><li key={job.id}>
     <button className={`knowledge-job-open${job.id===selectedId?' is-selected':''}`} type="button" onClick={()=>void selectJob(job.id)} disabled={pending!==null} aria-current={job.id===selectedId?'true':undefined}>
      <span className="knowledge-job-main"><strong>{job.filename}</strong><span>{formatName[job.format]} · {job.acquiredFrom==='URL'?'URL ทางการ':'อัปโหลด'}</span></span>
      <span className={`knowledge-status knowledge-status-${job.status.toLowerCase()}`}>{job.status==='READY'?'รับต้นฉบับแล้ว':'ต้องตรวจการวิเคราะห์'}</span>
      <span className="knowledge-job-meta">ฉบับ {job.revision} · {Math.ceil(job.byteLength/1024)} KB</span>
     </button>
    </li>)}</ul>}
    {pending==='open'&&<p className="knowledge-loading" role="status" aria-live="polite">กำลังเปิดรายการส่วนตัว…</p>}
   </section>
  </details>}

  {stage!=='upload'&&selectedJob&&<section className="knowledge-receipt" aria-labelledby="receipt-title">
   <div className="knowledge-receipt-main"><h2 id="receipt-title">ต้นฉบับที่เลือก</h2><strong>{selectedJob.filename}</strong>
    <p>{formatName[selectedJob.format]} · ฉบับ {selectedJob.revision} · {Math.ceil(selectedJob.byteLength/1024)} KB · {selectedJob.status==='FAILED'?'วิเคราะห์ไม่สำเร็จ':preview?.job.id===selectedJob.id?'วิเคราะห์แล้ว':'พร้อมวิเคราะห์'}</p>
    <p className="knowledge-unpublished">{publicationComplete?'อนุมัติแล้ว · เปิดอ่านข้อมูลตรวจและใบรับรองด้านล่าง':preview?'ยังไม่อนุมัติ · ตรวจข้อมูลให้ครบก่อนส่ง':'ยังไม่เผยแพร่ · วิเคราะห์ต้นฉบับเพื่อเตรียมตรวจ'}</p>
    {sourceReceiptState==='loading'&&<p role="status">กำลังตรวจสถานะอนุมัติก่อนเปิดการแก้ไขต้นฉบับ…</p>}
    {sourceReceiptState==='error'&&<div className="knowledge-review-conflict" role="alert"><p>ยังตรวจสถานะอนุมัติไม่ได้ การวิเคราะห์และแก้ข้อความถูกปิดไว้จนตรวจใบรับรองสำเร็จ</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>setReceiptRefresh(value=>value+1)} disabled={pending!==null}>ตรวจสถานะต้นฉบับอีกครั้ง</button></div>}
   </div>
   <div className="knowledge-receipt-actions"><a className="knowledge-button knowledge-button-secondary" href={`/api/knowledge/imports/${encodeURIComponent(selectedJob.id)}/original`} download>ดาวน์โหลดต้นฉบับ</a>
    {!preview&&stage==='prepare'&&<button className="knowledge-button knowledge-button-primary" type="button" onClick={()=>void analyze()} disabled={pending!==null||sourceMutationLocked}>{pending==='analyze'?'กำลังวิเคราะห์…':'วิเคราะห์เอกสาร'}</button>}</div>
  </section>}

  {preview&&extraction?<section className="knowledge-preview" aria-labelledby="preview-title" hidden={stage==='upload'}>
   <header className="knowledge-preview-heading"><div><h2 id="preview-title">{stage==='prepare'?'ตรวจสรุปที่เตรียมไว้':'ตรวจรายละเอียดก่อนอนุมัติ'}</h2><p>ต้นฉบับ {selectedJob?.filename??preview.job.filename} · ข้อความฉบับ {preview.extractionRevision} · {publicationComplete?'อนุมัติแล้ว เปิดอ่านเพื่อตรวจย้อนหลัง':'ยังไม่เผยแพร่'}</p></div>
    <a className="knowledge-button knowledge-button-tertiary" href={`/api/knowledge/imports/${encodeURIComponent(preview.job.id)}/original`} download>เปิดต้นฉบับ</a>
   </header>
   {activeEditConflict&&<section className="knowledge-draft-conflicts" aria-labelledby="draft-conflicts-title">
    <div className="knowledge-section-heading"><div><h3 id="draft-conflicts-title">เปรียบเทียบข้อความร่างกับฉบับล่าสุด</h3><p>ฉบับล่าสุดเปลี่ยนข้อมูลในช่องนี้ โปรดเลือกค่าที่จะเก็บก่อนบันทึก</p></div>
     <div className="knowledge-window-actions"><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setConflictIndex(value=>Math.max(0,value-1))} disabled={pending!==null||conflictIndex===0}>รายการก่อน</button><span>รายการ {conflictIndex+1} / {editConflicts.length}</span><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setConflictIndex(value=>Math.min(editConflicts.length-1,value+1))} disabled={pending!==null||conflictIndex>=editConflicts.length-1}>รายการถัดไป</button></div>
    </div>
    <p className="knowledge-conflict-location"><strong>{activeEditConflict.label}</strong> · {activeEditConflict.location}</p>
    <div className="knowledge-conflict-values">
     <div><h4>ค่าจากฉบับล่าสุด</h4><pre>{activeEditConflict.latestValue??(activeEditConflict.targetExists?'ไม่มีชื่อเรื่อง':'ไม่มีช่องนี้ในฉบับล่าสุด')}</pre></div>
     <div><h4>ข้อความร่างของคุณ</h4><pre>{activeEditConflict.draftValue}</pre></div>
    </div>
    <details className="knowledge-conflict-previous"><summary>ดูค่าจากฉบับที่เปิดก่อนหน้า</summary><pre>{activeEditConflict.previousValue||'ไม่มีข้อความ'}</pre></details>
    {activeEditConflict.acknowledged&&<p className="knowledge-conflict-acknowledged" role="status">เลือกเก็บข้อความร่างนี้แล้ว</p>}
    <div className="knowledge-conflict-actions"><button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>resolveEditConflict(activeEditConflict,'LATEST')} disabled={pending!==null||sourceMutationLocked}>
     {activeEditConflict.targetExists?'ใช้ค่าจากฉบับล่าสุด':'ทิ้งร่างที่ไม่มีช่องในฉบับล่าสุด'}
    </button>
     {activeEditConflict.targetExists&&<button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>resolveEditConflict(activeEditConflict,'DRAFT')} disabled={pending!==null||sourceMutationLocked||activeEditConflict.acknowledged}>{activeEditConflict.acknowledged?'เลือกเก็บข้อความร่างแล้ว':'คงข้อความร่างนี้'}</button>}
    </div>
   </section>}
   {stage==='prepare'&&<section className="knowledge-warning-section" aria-labelledby="warning-title"><div className="knowledge-section-heading"><h3 id="warning-title">ข้อที่ควรตรวจจากต้นฉบับ</h3><span>{preparationWarningCount} รายการ</span></div>
    {preview.analysis.sensitiveCategories.length>0&&<p className="knowledge-sensitive">อาจมีข้อมูลละเอียดอ่อน: {preview.analysis.sensitiveCategories.map(value=>sensitiveLabels[value]??'ข้อมูลต้องตรวจ').join('、')}</p>}
    {preparationWarningCount===0?<p className="knowledge-no-warnings">ตัวอ่านและตัววิเคราะห์ไม่พบคำเตือนในรอบนี้ แต่เอกสารยังต้องผ่านการตรวจและอนุมัติในขั้นตอนถัดไป</p>:
     <ul className="knowledge-warning-list">{extraction.report.warnings.map((warning,index)=><li key={`${warning.code}-${index}`}><strong>{warningLabels[warning.code]??'พบข้อควรตรวจ'}</strong><span>{warning.severity==='BLOCKING'?'ต้องแก้ก่อนอนุมัติ':'ต้องตรวจด้วยผู้รับผิดชอบ'} · {warning.count} จุด · ยังไม่ยืนยัน</span>{warning.location&&<small>{formatLocation(warning.location)}</small>}</li>)}
      {analysisOnlyFlags.map(flag=><li key={`analysis-${flag}`}><strong>{warningLabels[flag]??'พบข้อเสนอที่ต้องตรวจ'}</strong><span>ตัววิเคราะห์เสนอให้ตรวจ · ยังไม่ยืนยัน</span></li>)}
     </ul>}
   </section>}

   {stage==='review'&&<details className="knowledge-extraction-details" id="review-extraction" open={extraction.report.warnings.some(warning=>warning.severity==='BLOCKING')}>
    <summary>ตรวจข้อความที่อ่านได้และแก้เฉพาะส่วนที่คลาดเคลื่อน ({extraction.report.pages} หน้า · {extraction.report.tables} ตาราง)</summary>
   <section className="knowledge-extraction-editor" aria-labelledby="edit-title"><div className="knowledge-section-heading"><div><h3 id="edit-title">ข้อความที่อ่านได้</h3><p>{extraction.report.pages} หน้า · {extraction.report.tables} ตาราง · {extraction.report.cells} ช่อง · {extraction.report.textCharacters.toLocaleString('th-TH')} ตัวอักษร</p></div></div>
     <div className="knowledge-page-controls"><div><h4>หน้าเอกสาร</h4><p>{formatLocation(extraction.locations.pages[pageIndex])}</p></div>
     <div className="knowledge-window-actions"><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setPageIndex(value=>Math.max(0,value-1))} disabled={pending!==null||pageIndex<=0}>หน้าก่อน</button><span aria-live="polite">หน้า {pageIndex+1} / {extraction.pages.length}</span><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setPageIndex(value=>Math.min(extraction.pages.length-1,value+1))} disabled={pending!==null||pageIndex>=extraction.pages.length-1}>หน้าถัดไป</button></div>
    </div>
    {page&&<label className="knowledge-field knowledge-page-editor">ข้อความในหน้า {pageIndex+1}
     <textarea value={pageText} onChange={event=>changeDraftValue(`page:${pageIndex}`,()=>setPageDrafts(current=>({...current,[pageIndex]:event.target.value})))} maxLength={5_000_000} rows={10} disabled={pending!==null||sourceMutationLocked}/>
     <span className="knowledge-hint">ตำแหน่งต้นทางคงเดิม · การแก้จะเพิ่มคำเตือนให้ตรวจซ้ำ</span>
    </label>}

    {extraction.tables.length>0&&<div className="knowledge-table-editor">
     <div className="knowledge-table-heading"><label className="knowledge-field">เลือกตาราง
      <select value={tableIndex} onChange={event=>{setTableIndex(Number(event.target.value));setRowWindow(0);setColumnWindow(0);}} disabled={pending!==null}>{extraction.tables.map((item,index)=><option key={index} value={index}>ตาราง {index+1}{item.sheetName?` · ${item.sheetName}`:''}</option>)}</select>
     </label><p>{formatLocation(tableLocation)}</p></div>
     {table&&<>
      <div className="knowledge-window-actions knowledge-table-window-controls"><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setRowWindow(value=>Math.max(0,value-1))} disabled={pending!==null||rowWindow===0}>แถวก่อน</button><span>แถว {Math.min(rowStart+1,table.rows.length)}–{Math.min(rowStart+visibleRows.length,table.rows.length)} / {table.rows.length}</span><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setRowWindow(value=>Math.min(Math.ceil(table.rows.length/20)-1,value+1))} disabled={pending!==null||rowStart+20>=table.rows.length}>แถวถัดไป</button>
       <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setColumnWindow(value=>Math.max(0,value-1))} disabled={pending!==null||columnWindow===0}>คอลัมน์ก่อน</button><span>คอลัมน์ {columnStart+1}–{Math.min(columnStart+visibleColumns,maxColumns)} / {maxColumns}</span><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setColumnWindow(value=>Math.min(Math.ceil(maxColumns/8)-1,value+1))} disabled={pending!==null||columnStart+8>=maxColumns}>คอลัมน์ถัดไป</button></div>
      <div className="knowledge-table-scroll" tabIndex={0} role="region" aria-label={`ตาราง ${tableIndex+1} หน้าต่างแถว ${rowStart+1} ถึง ${Math.min(rowStart+20,table.rows.length)}`}>
       <table className="knowledge-data-table"><thead><tr><th scope="col">แถวต้นทาง</th>{Array.from({length:visibleColumns},(_,offset)=><th key={columnStart+offset} scope="col">คอลัมน์ {columnStart+offset+1}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row,visibleIndex)=>{const rowIndex=rowStart+visibleIndex;return <tr key={rowIndex}><th scope="row">{table.firstRow+rowIndex}</th>{Array.from({length:visibleColumns},(_,offset)=>{const column=columnStart+offset;const original=row[column];if(original===undefined)return <td key={column}><span className="knowledge-empty-cell">—</span></td>;
          const key=`${tableIndex}:${rowIndex}:${column}`;return <td key={column}><label className="knowledge-cell-label"><span className="knowledge-visually-hidden">ตาราง {tableIndex+1} แถว {table.firstRow+rowIndex} คอลัมน์ {column+1}</span><input value={cellDrafts[key]??original} maxLength={10_000} onChange={event=>changeDraftValue(`cell:${key}`,()=>setCellDrafts(current=>({...current,[key]:event.target.value})))} disabled={pending!==null||sourceMutationLocked}/></label></td>;
         })}</tr>;})}</tbody>
       </table>
      </div>
      <p className="knowledge-hint">แสดงทีละ 20 แถวและ 8 คอลัมน์เพื่อให้ใช้งานบนจอเล็กได้ ข้อความในช่องจะเก็บตำแหน่งเดิม</p>
     </>}
    </div>}

    <label className="knowledge-field knowledge-title-editor">ชื่อเรื่องที่อ่านได้
     <input value={titleDraft} maxLength={500} onChange={event=>changeDraftValue('title',()=>setTitleDraft(event.target.value))} disabled={pending!==null||sourceMutationLocked}/>
    </label>
    <label className="knowledge-field knowledge-reason-field">เหตุผลการแก้ไข
     <textarea value={reason} minLength={1} maxLength={500} rows={3} onChange={event=>setReason(event.target.value)} placeholder="ระบุว่าข้อความส่วนใดอ่านคลาดเคลื่อนและแก้ตามอะไร" disabled={pending!==null||sourceMutationLocked}/>
     <span className="knowledge-hint">1–500 ตัวอักษร · ต้องมีข้อความที่เปลี่ยนจริงก่อนบันทึก</span>
    </label>
    <div className="knowledge-edit-actions"><p>{unresolvedEditConflict?'เลือกฉบับล่าสุดหรือยืนยันเก็บข้อความร่างที่เปลี่ยนก่อน แล้วจึงบันทึก':'การแก้จะสร้างฉบับใหม่และวิเคราะห์ความเสี่ยงอีกครั้ง คำเตือนเดิมยังคงอยู่'}</p><button className="knowledge-button knowledge-button-primary" type="button" onClick={()=>void saveEdit()} disabled={!canSave}>{pending==='edit'?'กำลังบันทึก…':'บันทึกข้อความแก้ไข'}</button></div>
   </section>
   </details>}
   <ReviewForm key={`${preview.job.id}:${preview.job.revision}:${preview.extractionRevision}:${reviewRefreshKey}`} jobId={preview.job.id} jobRevision={preview.job.revision} extractionRevision={preview.extractionRevision} refreshKey={reviewRefreshKey}
    mode={stage==='review'?'review':'prepare'} onContinue={()=>setStage('review')}
    parentPending={pending!==null&&pending!=='review'||sourceReceiptState!=='ready'} onDraftStateChange={onReviewStateChange} onReloadPreview={()=>void selectJob(preview.job.id)}/>
  </section>:stage==='prepare'&&selectedJob&&!preview&&<div className="knowledge-analyze-prompt"><h2>ยังไม่มีผลอ่าน</h2><p>ต้นฉบับได้รับแล้ว กด “วิเคราะห์เอกสาร” เพื่อเตรียมสรุปและจุดที่ควรตรวจ</p></div>}

  {conflict&&<div className="knowledge-conflict" role="alert"><p>รายการเปลี่ยนฉบับแล้ว ข้อความร่างในหน้านี้ยังเก็บไว้</p><button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void reloadAfterConflict()} disabled={pending!==null}>{pending==='open'?'กำลังโหลด…':'โหลดฉบับล่าสุดและเก็บข้อความร่าง'}</button></div>}
  {notice&&<p className="knowledge-message knowledge-message-success" role="status" aria-live="polite">{notice}</p>}
  {failure&&<p className="knowledge-message knowledge-message-error" role="alert">{failure}</p>}
 </div>;
}
