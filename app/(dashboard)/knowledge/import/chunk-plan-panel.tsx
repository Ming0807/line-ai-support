'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {ExtractionWarning,SourceLocation} from '@/lib/imports/types';
import type {LocatedChunkPlan,LocatedChunkDraft,LocatedChunkCoverage} from '@/lib/knowledge/located-plan-types';
import type {ImportChunkPlanSnapshot} from '@/lib/imports/chunk-plan-types';

type ChunkPlanPanelProps={
 jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number;saved:boolean;disabled:boolean;
 acknowledgedDigest:string|null;onDigestChange:(digest:string|null)=>void;onPendingChange:(pending:boolean)=>void;
};
type UnknownRecord=Record<string,unknown>;
const LOCAL_MODEL='intfloat/multilingual-e5-small';
const LOCAL_MODEL_REVISION='614241f622f53c4eeff9890bdc4f31cfecc418b3';
const LOCAL_FINGERPRINT='42259817e85c6d44dc81af6b26fe209c9b744c6342eb4ac1c6bbd2bcdd032f82';
const chunkLimit=2_000;
const warningLimit=1_000;
const extractionWarningCodes=['OCR_REQUIRED','LOW_TEXT_QUALITY','UNSUPPORTED_TABLES','ENCRYPTED_SOURCE','FORMULAS_PRESENT','HIDDEN_DATA_REVIEW','EXTERNAL_LINKS_REVIEW','PAGE_REVIEW_REQUIRED','TABLE_SHAPE_REVIEW'] as const;
const warningLabels:Record<string,string>={OCR_REQUIRED:'ต้องตรวจข้อความจากภาพหรือ OCR',LOW_TEXT_QUALITY:'คุณภาพข้อความต่ำ',UNSUPPORTED_TABLES:'อ่านตารางได้ไม่ครบ',ENCRYPTED_SOURCE:'ต้นฉบับเข้ารหัส',FORMULAS_PRESENT:'พบสูตรในตาราง',HIDDEN_DATA_REVIEW:'พบข้อมูลซ่อน',EXTERNAL_LINKS_REVIEW:'พบลิงก์ภายนอก',PAGE_REVIEW_REQUIRED:'ต้องตรวจข้อความและตำแหน่ง',TABLE_SHAPE_REVIEW:'ต้องตรวจรูปแบบตาราง'};

function isRecord(value:unknown):value is UnknownRecord{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function hasKeys(value:UnknownRecord,keys:readonly string[]):boolean{return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function isInteger(value:unknown,min:number,max:number):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;}
function isNullableString(value:unknown,max:number):value is string|null{return value===null||typeof value==='string'&&value.length<=max;}
function isStringArray(value:unknown,maxItems:number,maxLength:number):value is string[]{return Array.isArray(value)&&value.length<=maxItems&&value.every(item=>typeof item==='string'&&item.length<=maxLength);}
function isSafeHttpsUrl(value:unknown):value is string|null{
 if(value===null)return true;
 if(typeof value!=='string'||value.length>2048)return false;
 try{const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.username===''&&parsed.password==='';}catch{return false;}
}

function isLocation(value:unknown):value is SourceLocation{
 if(!isRecord(value)||typeof value.kind!=='string')return false;
 switch(value.kind){
  case 'PDF':return hasKeys(value,['kind','pageNumber','blockStart','blockEnd','tableIndex'])&&isInteger(value.pageNumber,1,1000)&&isInteger(value.blockStart,1,100_000)&&isInteger(value.blockEnd,value.blockStart,100_000)&&(value.tableIndex===null||isInteger(value.tableIndex,1,1000));
  case 'DOCX':return hasKeys(value,['kind','blockStart','blockEnd','headingPath','tableIndex'])&&isInteger(value.blockStart,1,100_000)&&isInteger(value.blockEnd,value.blockStart,100_000)&&isStringArray(value.headingPath,20,200)&&(value.tableIndex===null||isInteger(value.tableIndex,1,1000));
  case 'XLSX':return hasKeys(value,['kind','sheetName','sheetIndex','rowStart','rowEnd','columnStart','columnEnd','tableIndex'])&&typeof value.sheetName==='string'&&value.sheetName.length>0&&value.sheetName.length<=100&&isInteger(value.sheetIndex,1,1000)&&isInteger(value.rowStart,1,1_048_576)&&isInteger(value.rowEnd,value.rowStart,1_048_576)&&isInteger(value.columnStart,1,16_384)&&isInteger(value.columnEnd,value.columnStart,16_384)&&(value.tableIndex===null||isInteger(value.tableIndex,1,1000));
  case 'CSV':return hasKeys(value,['kind','rowStart','rowEnd','columnStart','columnEnd','tableIndex'])&&isInteger(value.rowStart,1,10_000)&&isInteger(value.rowEnd,value.rowStart,10_000)&&isInteger(value.columnStart,1,256)&&isInteger(value.columnEnd,value.columnStart,256)&&(value.tableIndex===null||isInteger(value.tableIndex,1,1000));
  case 'HTML':return hasKeys(value,['kind','sourceUrl','blockStart','blockEnd','headingPath','tableIndex'])&&isSafeHttpsUrl(value.sourceUrl)&&isInteger(value.blockStart,1,100_000)&&isInteger(value.blockEnd,value.blockStart,100_000)&&isStringArray(value.headingPath,20,200)&&(value.tableIndex===null||isInteger(value.tableIndex,1,1000));
  default:return false;
 }
}
function isCoverage(value:unknown):value is LocatedChunkCoverage{
 if(!isRecord(value)||typeof value.kind!=='string')return false;
 if(value.kind==='PAGE')return hasKeys(value,['kind','index','start','end','overlapPrefixLength'])&&isInteger(value.index,0,999)&&isInteger(value.start,0,5_000_000)&&isInteger(value.end,value.start,5_000_000)&&isInteger(value.overlapPrefixLength,0,value.end-value.start);
 if(value.kind==='TABLE')return hasKeys(value,['kind','index','rowStartIndex','rowEndIndex'])&&isInteger(value.index,0,999)&&isInteger(value.rowStartIndex,0,9999)&&isInteger(value.rowEndIndex,value.rowStartIndex,9999);
 return false;
}
function isChunk(value:unknown,index:number):value is LocatedChunkDraft{
 if(!isRecord(value)||!hasKeys(value,['index','pageNumber','sectionTitle','content','requiresReview','sourceLocations','passageTokenCount','coverage'])||value.index!==index||
  !(value.pageNumber===null||isInteger(value.pageNumber,1,1000))||!isNullableString(value.sectionTitle,180)||typeof value.content!=='string'||value.content.length===0||new TextEncoder().encode(value.content).length>6000||typeof value.requiresReview!=='boolean'||
  !Array.isArray(value.sourceLocations)||value.sourceLocations.length<1||value.sourceLocations.length>16||!value.sourceLocations.every(isLocation)||!isInteger(value.passageTokenCount,1,512)||!isCoverage(value.coverage))return false;
 return true;
}
function isWarning(value:unknown):value is ExtractionWarning{
 return isRecord(value)&&hasKeys(value,['code','severity','location','count','disposition'])&&typeof value.code==='string'&&(extractionWarningCodes as readonly string[]).includes(value.code)&&
  (value.severity==='BLOCKING'||value.severity==='REVIEW')&&(value.location===null||isLocation(value.location))&&isInteger(value.count,1,5_000_000)&&value.disposition==='UNRESOLVED';
}
function isPlan(value:unknown,jobId:string,extractionRevision:number):value is LocatedChunkPlan{
 if(!isRecord(value)||!hasKeys(value,['schemaVersion','chunkerVersion','binding','sourceChecksum','model','modelRevision','embeddingFingerprint','chunks','warnings','digest'])||value.schemaVersion!==1||value.chunkerVersion!=='located-e5-v1'||
  !isRecord(value.binding)||!hasKeys(value.binding,['jobId','extractionRevision'])||value.binding.jobId!==jobId||value.binding.extractionRevision!==extractionRevision||
  typeof value.sourceChecksum!=='string'||!/^([0-9a-f]{64})$/iu.test(value.sourceChecksum)||value.model!==LOCAL_MODEL||value.modelRevision!==LOCAL_MODEL_REVISION||value.embeddingFingerprint!==LOCAL_FINGERPRINT||
  typeof value.digest!=='string'||!/^([0-9a-f]{64})$/iu.test(value.digest)||!Array.isArray(value.chunks)||value.chunks.length<1||value.chunks.length>chunkLimit||!value.chunks.every((item,index)=>isChunk(item,index))||
  !Array.isArray(value.warnings)||value.warnings.length>warningLimit||!value.warnings.every(isWarning))return false;
 return true;
}
function isSnapshot(value:unknown,props:ChunkPlanPanelProps):value is ImportChunkPlanSnapshot{
 return isRecord(value)&&hasKeys(value,['jobId','jobRevision','extractionRevision','reviewRevision','plan'])&&value.jobId===props.jobId&&value.jobRevision===props.jobRevision&&
  value.extractionRevision===props.extractionRevision&&value.reviewRevision===props.reviewRevision&&isPlan(value.plan,props.jobId,props.extractionRevision);
}
function chunkPlanFailureMessage(status:number,body:unknown):string{
 const code=isRecord(body)&&typeof body.error==='string'?body.error:null;
 if(status===503&&code==='CHUNK_PLAN_UNAVAILABLE')return 'ระบบเตรียมแผนแบ่งข้อความยังไม่พร้อม ร่างตรวจยังอยู่ ลองอีกครั้งภายหลัง';
 if(status===408&&code==='CHUNK_PLAN_TIMEOUT')return 'ใช้เวลาเตรียมแผนนานเกินกำหนด ร่างตรวจยังอยู่ ลองเตรียมแผนอีกครั้ง';
 if(status===413&&code==='CHUNK_PLAN_TOO_LARGE')return 'เอกสารมีข้อความเกินขอบเขตที่เตรียมแผนได้ ร่างตรวจยังอยู่ ตรวจต้นฉบับและลองอีกครั้ง';
 if(status===422&&code==='CHUNK_PLAN_TABLE_ROW_TOO_LARGE')return 'มีแถวตารางที่แบ่งต่อไม่ได้ภายในขอบเขตที่รองรับ ร่างตรวจยังอยู่ กรุณาตรวจต้นฉบับก่อนลองอีกครั้ง';
 if(status===422&&code==='CHUNK_PLAN_GRAPHEME_TOO_LARGE')return 'มีข้อความหนึ่งหน่วยที่แบ่งต่อไม่ได้ภายในขอบเขตที่รองรับ ร่างตรวจยังอยู่ กรุณาตรวจต้นฉบับก่อนลองอีกครั้ง';
 return 'โหลดแผนแบ่งข้อความไม่สำเร็จ ผลตอบกลับไม่ตรงกับร่างนี้ ลองตรวจอีกครั้ง';
}
function locationLabel(location:SourceLocation):string{
 switch(location.kind){
  case 'PDF':return `PDF · หน้า ${location.pageNumber} · ช่วง ${location.blockStart}–${location.blockEnd}`;
  case 'DOCX':return `DOCX · ${location.headingPath.length?location.headingPath.join(' / '):'เนื้อหา'} · ช่วง ${location.blockStart}–${location.blockEnd}`;
  case 'XLSX':return `XLSX · ${location.sheetName} · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}`;
  case 'CSV':return `CSV · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}`;
  case 'HTML':return `HTML · ${location.headingPath.length?location.headingPath.join(' / '):'เนื้อหา'} · ช่วง ${location.blockStart}–${location.blockEnd}`;
 }
}

export default function ChunkPlanPanel(props:ChunkPlanPanelProps){
 const {jobId,jobRevision,extractionRevision,reviewRevision,saved,disabled,acknowledgedDigest,onDigestChange,onPendingChange}=props;
 const tuple=`${jobId}:${jobRevision}:${extractionRevision}:${reviewRevision}`;
 const [snapshot,setSnapshot]=useState<ImportChunkPlanSnapshot|null>(null);
 const [loadedTuple,setLoadedTuple]=useState<string|null>(null);
 const [chunkIndex,setChunkIndex]=useState(0);
 const [pending,setPending]=useState(false);
 const [failure,setFailure]=useState('');
 const serial=useRef(0);const abort=useRef<AbortController|null>(null);const mounted=useRef(false);const keyRef=useRef(tuple);
 const callbacks=useRef({onDigestChange,onPendingChange});

 useEffect(()=>{callbacks.current={onDigestChange,onPendingChange};},[onDigestChange,onPendingChange]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();callbacks.current.onPendingChange(false);};},[]);
 useEffect(()=>{
  if(keyRef.current===tuple)return;
  keyRef.current=tuple;serial.current++;abort.current?.abort();abort.current=null;
  setSnapshot(null);setLoadedTuple(null);setChunkIndex(0);setFailure('');setPending(false);callbacks.current.onPendingChange(false);
 },[tuple]);

 const lookup=useCallback(async()=>{
  if(!saved||disabled||pending)return;
  const requestSerial=++serial.current;const requestKey=tuple;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  setPending(true);onPendingChange(true);setFailure('');setSnapshot(null);setLoadedTuple(null);setChunkIndex(0);
  try{
   const query=new URLSearchParams({expectedJobRevision:String(jobRevision),expectedExtractionRevision:String(extractionRevision),expectedReviewRevision:String(reviewRevision)});
   const response=await fetch(`/api/knowledge/imports/${encodeURIComponent(jobId)}/chunks?${query}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
   const body:unknown=await response.json().catch(()=>null);
   if(!mounted.current||controller.signal.aborted||requestSerial!==serial.current||keyRef.current!==requestKey)return;
   if(response.status===409){setFailure('ข้อมูลเอกสารหรือร่างตรวจเปลี่ยนแล้ว ร่างในหน้านี้ยังอยู่ ตรวจแผนอีกครั้งหลังโหลดข้อมูลล่าสุด');return;}
   if(response.status===401||response.status===403){setFailure('บัญชีนี้ไม่มีสิทธิ์ดูแผนส่วนตัว หรือหมดเวลาใช้งาน กรุณาเข้าสู่ระบบใหม่');return;}
   const next=isRecord(body)&&hasKeys(body,['snapshot'])&&isSnapshot(body.snapshot,props)?body.snapshot:null;
   if(!response.ok||!next){setFailure(response.status===404?'ไม่พบร่างตรวจที่บันทึกไว้':chunkPlanFailureMessage(response.status,body));return;}
   setSnapshot(next);setLoadedTuple(tuple);
  }catch{
   if(!controller.signal.aborted&&mounted.current&&requestSerial===serial.current&&keyRef.current===requestKey)setFailure('โหลดแผนแบ่งข้อความไม่สำเร็จ ร่างตรวจยังอยู่ ลองตรวจอีกครั้ง');
  }finally{
   if(mounted.current&&requestSerial===serial.current&&keyRef.current===requestKey){setPending(false);onPendingChange(false);}
  }
 },[disabled,extractionRevision,jobId,jobRevision,onPendingChange,pending,props,reviewRevision,saved,tuple]);

 const current=loadedTuple===tuple?snapshot:null;
 const plan=current?.plan??null;
 const activeChunk=plan?.chunks[chunkIndex]??null;
 const checked=Boolean(plan&&acknowledgedDigest===plan.digest);
 const warningCount=plan?.warnings.reduce((total,item)=>total+item.count,0)??0;
 const clearAcknowledgement=()=>onDigestChange(null);

 return <section className="knowledge-review knowledge-chunk-plan" aria-labelledby={`chunk-plan-title-${jobId}`}>
  <header className="knowledge-review-heading"><div><h3 id={`chunk-plan-title-${jobId}`}>ตรวจแผนแบ่งข้อความ</h3><p>แผนส่วนตัวจากข้อความและตำแหน่งต้นฉบับที่บันทึกไว้ · ไม่อนุมัติและไม่เผยแพร่</p></div>
   <button type="button" className="knowledge-button knowledge-button-secondary" onClick={()=>void lookup()} disabled={!saved||disabled||pending}>{pending?'กำลังเตรียมแผน…':plan?'ตรวจแผนอีกครั้ง':'เตรียมตัวอย่างแผน'}</button>
  </header>
  {!saved&&<p className="knowledge-review-state">บันทึกร่างตรวจปัจจุบันก่อน จึงจะเตรียมแผนส่วนตัวได้</p>}
  {failure&&<div className="knowledge-review-conflict" role="alert"><p>{failure}</p><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>void lookup()} disabled={!saved||disabled||pending}>ลองอีกครั้ง</button></div>}
  {plan&&activeChunk&&<>
   <p className="knowledge-review-state" role="status">{plan.chunks.length.toLocaleString('th-TH')} ข้อความ · คำเตือน {plan.warnings.length.toLocaleString('th-TH')} รายการ รวม {warningCount.toLocaleString('th-TH')} จุด{plan.warnings.some(item=>item.severity==='BLOCKING')?' · มีรายการที่ต้องแก้ก่อนอนุมัติ':plan.warnings.length?' · มีรายการที่ต้องตรวจ':''}</p>
   <div className="knowledge-chunk-plan-preview" aria-live="polite">
    <div className="knowledge-chunk-plan-heading"><strong>ข้อความ {activeChunk.index+1} จาก {plan.chunks.length}</strong><span>{activeChunk.passageTokenCount} / 512 tokens</span></div>
    <div className="knowledge-chunk-plan-locations"><strong>ตำแหน่งต้นฉบับ</strong>{activeChunk.sourceLocations.map((location,index)=><span key={`${location.kind}-${index}`}>{locationLabel(location)}</span>)}</div>
    {activeChunk.sectionTitle&&<p className="knowledge-review-state">หัวข้อ: {activeChunk.sectionTitle}</p>}
    <pre className="knowledge-chunk-plan-content" tabIndex={0} role="region" aria-label={`ข้อความ ${activeChunk.index+1} ในแผน`}>{activeChunk.content}</pre>
    {activeChunk.requiresReview&&<p className="knowledge-review-conflict" role="status">ข้อความนี้มีเครื่องหมายให้ตรวจจากต้นฉบับ</p>}
   </div>
   <nav className="knowledge-chunk-plan-pagination" aria-label="เลือกข้อความในแผน">
    <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setChunkIndex(index=>Math.max(0,index-1))} disabled={chunkIndex===0}>ข้อความก่อนหน้า</button>
    <span>ข้อความ {chunkIndex+1} / {plan.chunks.length}</span>
    <button type="button" className="knowledge-button knowledge-button-tertiary" onClick={()=>setChunkIndex(index=>Math.min(plan.chunks.length-1,index+1))} disabled={chunkIndex>=plan.chunks.length-1}>ข้อความถัดไป</button>
   </nav>
   {plan.warnings.length>0&&<details className="knowledge-chunk-plan-warnings"><summary>ดูคำเตือนจากแผน ({plan.warnings.length})</summary><ul>{plan.warnings.map((warning,index)=><li key={`${warning.code}-${index}`}><strong>{warningLabels[warning.code]??'คำเตือนจากต้นฉบับ'}</strong><span>{warning.severity==='BLOCKING'?'ต้องแก้ก่อนอนุมัติ':'ต้องตรวจ'} · {warning.count} จุด · {warning.disposition==='UNRESOLVED'?'ยังไม่คลี่คลาย':warning.disposition==='CORRECTED'?'มีการแก้ไข':'มีการระบุผลตรวจ'}</span>{warning.location&&<small>{locationLabel(warning.location)}</small>}</li>)}</ul></details>}
   <fieldset className="knowledge-chunk-plan-ack" disabled={disabled||pending}>
    <label><input type="checkbox" checked={checked} onChange={event=>onDigestChange(event.target.checked?plan.digest:null)}/>ฉันตรวจตัวอย่างการแบ่งข้อความนี้แล้ว และยืนยันแผนฉบับนี้</label>
    <p className="knowledge-review-state">คำยืนยันครอบคลุมตัวอย่างแผนนี้เท่านั้น ยังต้องตรวจข้อมูลส่วนอื่นก่อนอนุมัติ</p>
   </fieldset>
  </>}
  {!plan&&!pending&&!failure&&<p className="knowledge-review-state">ยังไม่มีตัวอย่างแผนสำหรับร่างตรวจฉบับนี้</p>}
  {acknowledgedDigest&&!checked&&<div className="knowledge-chunk-plan-clear" role="status"><p>ยังไม่ได้เทียบคำยืนยันเดิมกับตัวอย่างปัจจุบัน กรุณาตรวจตัวอย่างอีกครั้ง หรือถอนคำยืนยันเดิม</p><button type="button" className="knowledge-button knowledge-button-tertiary" onClick={clearAcknowledgement} disabled={disabled||pending}>ถอนคำยืนยันเดิม</button></div>}
 </section>;
}
