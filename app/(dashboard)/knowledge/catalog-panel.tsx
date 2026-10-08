'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import {
 catalogEnvelopeSchema,
 documentEnvelopeSchema,
 historyEnvelopeSchema,
 type CatalogDetail,
 type CatalogHistory,
 type CatalogResponse,
 type CatalogSummary,
} from '@/lib/knowledge/catalog-types';

type AppliedFilters={q:string;departmentCode:string;status:string;page:number;pageSize:number};
type Loaded<T>={key:string;value:T};
type Failed={key:string;message:string};

const statusLabels:Record<CatalogSummary['status'],string>={
 DRAFT:'ฉบับร่าง',PENDING_REVIEW:'รอตรวจ',ACTIVE:'เผยแพร่แล้ว',SUPERSEDED:'ถูกแทนที่',
 EXPIRED:'หมดอายุ',ARCHIVED:'เก็บถาวร',REJECTED:'ไม่อนุมัติ',
};
const modeLabels={RAG:'ค้นหาความรู้',STRUCTURED:'ข้อมูลแบบมีโครงสร้าง',BOTH:'ค้นหาความรู้และข้อมูลแบบมีโครงสร้าง'} as const;
const pageSize=10;
const relationPageSize=25;

function safeSourceHref(value:string|null):string|null{
 if(!value)return null;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function showDate(value:string|null):string{
 if(!value)return 'ไม่ระบุ';
 const parsed=new Date(value);
 return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',...(value.includes('T')?{timeStyle:'short'}:{})}).format(parsed):'ไม่ทราบ';
}
function sourceValue(value:string|null){
 if(!value)return <span>ไม่ระบุ</span>;
 const href=safeSourceHref(value);
 return href?<a href={href}>{value}</a>:<span>{value}</span>;
}
function errorMessage(status:number):string{
 if(status===401||status===403)return 'ไม่มีสิทธิ์ดูรายการคลังเอกสารนี้';
 if(status===404)return 'ไม่พบข้อมูลที่เลือก อาจถูกนำออกจากรายการแล้ว';
 if(status===400)return 'คำขอไม่ถูกต้อง ลองโหลดข้อมูลใหม่';
 return 'โหลดข้อมูลไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง';
}
async function getJson<T>(url:string,signal:AbortSignal,schema:{safeParse(value:unknown):{success:boolean;data?:T}}):Promise<T>{
 const response=await fetch(url,{method:'GET',cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'},signal});
 if(!response.ok)throw new Error(errorMessage(response.status));
 let body:unknown;
 try{body=await response.json();}catch{throw new Error('ข้อมูลตอบกลับอ่านไม่ได้ ลองโหลดใหม่อีกครั้ง');}
 const parsed=schema.safeParse(body);
 if(!parsed.success||parsed.data===undefined)throw new Error('รูปแบบข้อมูลตอบกลับไม่ตรงกับรายการคลังเอกสาร ลองโหลดใหม่อีกครั้ง');
 return parsed.data;
}
function failure(error:unknown):string{return error instanceof Error?error.message:'โหลดข้อมูลไม่สำเร็จ ลองอีกครั้ง';}

export function CatalogPanel(){
 const [draftQ,setDraftQ]=useState('');
 const [draftDepartment,setDraftDepartment]=useState('');
 const [draftStatus,setDraftStatus]=useState('');
 const [filters,setFilters]=useState<AppliedFilters>({q:'',departmentCode:'',status:'',page:1,pageSize});
 const [catalogRefresh,setCatalogRefresh]=useState(0);
 const [catalogState,setCatalogState]=useState<Loaded<CatalogResponse>|null>(null);
 const [catalogFailure,setCatalogFailure]=useState<Failed|null>(null);
 const [selectedFamilyId,setSelectedFamilyId]=useState<string|null>(null);
 const [historyPage,setHistoryPage]=useState(1);
 const [historyRefresh,setHistoryRefresh]=useState(0);
 const [historyState,setHistoryState]=useState<Loaded<CatalogHistory>|null>(null);
 const [historyFailure,setHistoryFailure]=useState<Failed|null>(null);
 const [selectedDocumentId,setSelectedDocumentId]=useState<string|null>(null);
 const [relationsPage,setRelationsPage]=useState(1);
 const [documentRefresh,setDocumentRefresh]=useState(0);
 const [documentState,setDocumentState]=useState<Loaded<CatalogDetail>|null>(null);
 const [documentFailure,setDocumentFailure]=useState<Failed|null>(null);
 const catalogRequest=useRef(0),historyRequest=useRef(0),documentRequest=useRef(0);
 const historyHeading=useRef<HTMLElement|null>(null),documentHeading=useRef<HTMLElement|null>(null);

 const catalogParams=useMemo(()=>{
  const query=new URLSearchParams({page:String(filters.page),pageSize:String(filters.pageSize)});
  if(filters.q)query.set('q',filters.q);
  if(filters.departmentCode)query.set('departmentCode',filters.departmentCode);
  if(filters.status)query.set('status',filters.status);
  return query.toString();
 },[filters]);
 const catalogKey=`/api/knowledge/catalog?${catalogParams}`;
 const currentCatalog=catalogState?.key===catalogKey?catalogState.value:null;
 const currentCatalogError=catalogFailure?.key===catalogKey?catalogFailure.message:null;

 useEffect(()=>{
  const controller=new AbortController(),request=++catalogRequest.current,key=catalogKey;
  void getJson(`/api/knowledge/catalog?${catalogParams}`,controller.signal,catalogEnvelopeSchema).then(({catalog})=>{
   if(controller.signal.aborted||request!==catalogRequest.current)return;
   if(catalog.page!==filters.page||catalog.pageSize!==filters.pageSize)throw new Error('หน้ารายการที่ตอบกลับไม่ตรงกับคำขอ ลองโหลดใหม่อีกครั้ง');
   setCatalogState({key,value:catalog});
  }).catch(error=>{
   if(controller.signal.aborted||request!==catalogRequest.current)return;
   setCatalogFailure({key,message:failure(error)});
  });
  return()=>controller.abort();
 },[catalogKey,catalogParams,filters.page,filters.pageSize,catalogRefresh]);

 const historyParams=useMemo(()=>new URLSearchParams({page:String(historyPage),pageSize:String(pageSize)}).toString(),[historyPage]);
 const historyKey=selectedFamilyId?`/api/knowledge/families/${encodeURIComponent(selectedFamilyId)}?${historyParams}`:'';
 const currentHistory=historyState?.key===historyKey?historyState.value:null;
 const currentHistoryError=historyFailure?.key===historyKey?historyFailure.message:null;
 useEffect(()=>{
  if(!selectedFamilyId)return;
  const controller=new AbortController(),request=++historyRequest.current,key=historyKey;
  void getJson(key,controller.signal,historyEnvelopeSchema).then(({history})=>{
   if(controller.signal.aborted||request!==historyRequest.current)return;
   if(history.family.id!==selectedFamilyId||history.documents.some(document=>document.familyId!==history.family.id)||history.page!==historyPage||history.pageSize!==pageSize)throw new Error('ประวัติที่ตอบกลับไม่ตรงกับรายการที่เลือก ลองโหลดใหม่อีกครั้ง');
   setHistoryState({key,value:history});
  }).catch(error=>{
   if(controller.signal.aborted||request!==historyRequest.current)return;
   setHistoryFailure({key,message:failure(error)});
  });
  return()=>controller.abort();
 },[selectedFamilyId,historyKey,historyPage,historyRefresh]);

 const documentParams=useMemo(()=>new URLSearchParams({relationsPage:String(relationsPage),relationsPageSize:String(relationPageSize)}).toString(),[relationsPage]);
 const documentKey=selectedDocumentId?`/api/knowledge/documents/${encodeURIComponent(selectedDocumentId)}?${documentParams}`:'';
 const currentDocument=documentState?.key===documentKey?documentState.value:null;
 const currentDocumentError=documentFailure?.key===documentKey?documentFailure.message:null;
 useEffect(()=>{
  if(!selectedDocumentId)return;
  const controller=new AbortController(),request=++documentRequest.current,key=documentKey;
  void getJson(key,controller.signal,documentEnvelopeSchema).then(({document})=>{
   if(controller.signal.aborted||request!==documentRequest.current)return;
   if(document.summary.id!==selectedDocumentId||document.relationsPage!==relationsPage||document.relationsPageSize!==relationPageSize)throw new Error('รายละเอียดที่ตอบกลับไม่ตรงกับเอกสารที่เลือก ลองโหลดใหม่อีกครั้ง');
   setDocumentState({key,value:document});
  }).catch(error=>{
   if(controller.signal.aborted||request!==documentRequest.current)return;
   setDocumentFailure({key,message:failure(error)});
  });
  return()=>controller.abort();
 },[selectedDocumentId,documentKey,relationsPage,documentRefresh]);

 useEffect(()=>{if(selectedFamilyId)historyHeading.current?.focus();},[selectedFamilyId]);
 useEffect(()=>{if(selectedDocumentId)documentHeading.current?.focus();},[selectedDocumentId]);

 const submitFilters=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  setFilters({q:draftQ.trim(),departmentCode:draftDepartment,status:draftStatus,page:1,pageSize});
  setSelectedFamilyId(null);setSelectedDocumentId(null);setHistoryPage(1);setRelationsPage(1);
 };
 const clearFilters=()=>{
  setDraftQ('');setDraftDepartment('');setDraftStatus('');
  setFilters({q:'',departmentCode:'',status:'',page:1,pageSize});
  setSelectedFamilyId(null);setSelectedDocumentId(null);setHistoryPage(1);setRelationsPage(1);
 };
 const selectFamily=(familyId:string)=>{
  setSelectedFamilyId(current=>current===familyId?null:familyId);setHistoryPage(1);setHistoryFailure(null);
  setSelectedDocumentId(null);setRelationsPage(1);setDocumentFailure(null);
 };
 const selectDocument=(documentId:string)=>{setSelectedDocumentId(current=>current===documentId?null:documentId);setRelationsPage(1);setDocumentFailure(null);};
 const retryCatalog=()=>{setCatalogFailure(null);setCatalogRefresh(value=>value+1);};
 const retryHistory=()=>{setHistoryFailure(null);setHistoryRefresh(value=>value+1);};
 const retryDocument=()=>{setDocumentFailure(null);setDocumentRefresh(value=>value+1);};

 const departments=catalogState?.value.departments??[];
 const currentCatalogLoading=!currentCatalog&&!currentCatalogError;
 const catalogPageCount=currentCatalog?Math.max(1,Math.ceil(currentCatalog.totalFamilies/filters.pageSize)):1;
 const historyPageCount=currentHistory?Math.max(1,Math.ceil(currentHistory.totalDocuments/pageSize)):1;
 const relationPageCount=currentDocument?Math.max(1,Math.ceil(currentDocument.totalRelationships/relationPageSize)):1;

 return <section className="knowledge-catalog" aria-labelledby="knowledge-catalog-title">
  <div className="knowledge-catalog-heading">
   <div><p className="knowledge-catalog-kicker">พื้นที่ผู้ดูแล</p><h2 id="knowledge-catalog-title">เอกสารที่อนุมัติแล้ว</h2><p>ดูรายการตามสายเอกสาร ประวัติฉบับ และข้อมูลความสัมพันธ์ที่บันทึกไว้</p></div>
   {currentCatalog&&<p className="knowledge-catalog-count">ผลตามตัวกรอง: {currentCatalog.totalFamilies.toLocaleString('th-TH')} สายเอกสาร · {currentCatalog.totalDocuments.toLocaleString('th-TH')} รายการเอกสาร</p>}
  </div>

  <form className="knowledge-catalog-filters" onSubmit={submitFilters}>
   <label className="knowledge-catalog-field">ค้นหาเอกสารหรือสายเอกสาร<input type="search" maxLength={120} value={draftQ} onChange={event=>setDraftQ(event.target.value)} placeholder="ชื่อเอกสาร รหัส หรือชื่อสาย" /></label>
   <label className="knowledge-catalog-field">หน่วยงาน<select value={draftDepartment} onChange={event=>setDraftDepartment(event.target.value)}><option value="">ทุกหน่วยงาน</option>{departments.map(department=><option key={department.code} value={department.code}>{department.name} ({department.code})</option>)}</select></label>
   <label className="knowledge-catalog-field">สถานะเอกสาร<select value={draftStatus} onChange={event=>setDraftStatus(event.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <div className="knowledge-catalog-filter-actions"><button className="knowledge-button knowledge-button-primary" type="submit">ค้นหา</button><button className="knowledge-button knowledge-button-secondary" type="button" onClick={clearFilters}>ล้างตัวกรอง</button></div>
  </form>

  {currentCatalogLoading&&<p className="knowledge-catalog-feedback" role="status">กำลังโหลดรายการเอกสาร…</p>}
  {currentCatalogError&&<div className="knowledge-catalog-feedback" role="alert"><p>{currentCatalogError}</p><button className="knowledge-button knowledge-button-secondary" type="button" onClick={retryCatalog}>ลองโหลดอีกครั้ง</button></div>}
  {currentCatalog&&currentCatalog.families.length===0&&<div className="knowledge-catalog-empty"><h3>{filters.q||filters.departmentCode||filters.status?'ไม่พบรายการตามตัวกรอง':'ยังไม่มีสายเอกสารที่มีฉบับอนุมัติ'}</h3><p>{filters.q||filters.departmentCode||filters.status?'ปรับคำค้นหาหรือตัวกรองแล้วค้นหาอีกครั้ง':'รายการจะแสดงเมื่อมีเอกสารที่ผ่านการอนุมัติแล้ว'}</p></div>}

  {currentCatalog&&currentCatalog.families.length>0&&<>
   <ul className="knowledge-catalog-families">
    {currentCatalog.families.map(family=><li key={family.id}>
     <article className="knowledge-catalog-family">
      <div className="knowledge-catalog-family-heading"><div><p className="knowledge-catalog-code">{family.code} · {family.category}</p><h3>{family.name}</h3></div><span className="knowledge-catalog-count">{family.documentCount.toLocaleString('th-TH')} ฉบับ</span></div>
      <dl className="knowledge-catalog-facts"><div><dt>รูปแบบเริ่มต้นของสาย</dt><dd>{modeLabels[family.defaultStorageMode]}</dd></div><div><dt>นำเข้าล่าสุด</dt><dd>{family.lastImportAt?showDate(family.lastImportAt):'ไม่ทราบข้อมูล'}</dd></div></dl>
      {family.versionsPreview.length>0?<div className="knowledge-catalog-preview-list"><h4>ตัวอย่างฉบับในรายการ</h4><ul>{family.versionsPreview.map(document=><li key={document.id}><DocumentSummary document={document} onSelect={()=>selectDocument(document.id)} selected={selectedDocumentId===document.id} /></li>)}</ul></div>:<p className="knowledge-catalog-no-versions">สายเอกสารนี้ยังไม่มีฉบับอนุมัติ</p>}
      {family.hasMoreVersions&&<p className="knowledge-catalog-note">มีฉบับเพิ่มเติม เปิดประวัติเพื่อดูรายการทั้งหมด</p>}
      <button className="knowledge-button knowledge-button-secondary" type="button" aria-expanded={selectedFamilyId===family.id} onClick={()=>selectFamily(family.id)}>{selectedFamilyId===family.id?'ซ่อนประวัติ':'ดูประวัติฉบับ'}</button>
     </article>
    </li>)}
   </ul>
   <Pager label="รายการสายเอกสาร" page={filters.page} pageCount={catalogPageCount} onChange={page=>{setSelectedFamilyId(null);setSelectedDocumentId(null);setFilters(current=>({...current,page}));}} />
  </>}

  {selectedFamilyId&&<section className="knowledge-catalog-region" aria-labelledby="knowledge-catalog-history-title" aria-busy={!currentHistory&&!currentHistoryError}>
   <div className="knowledge-catalog-region-heading"><div><p className="knowledge-catalog-kicker">ประวัติฉบับ</p><h3 id="knowledge-catalog-history-title" ref={node=>{historyHeading.current=node;}} tabIndex={-1}>{currentHistory?.family.name??'ประวัติสายเอกสาร'}</h3><p>แสดงทุกฉบับที่ได้รับอนุมัติ พร้อมสถานะและวันที่ที่บันทึกไว้</p></div><button className="knowledge-button knowledge-button-tertiary" type="button" onClick={()=>selectFamily(selectedFamilyId)}>ปิดประวัติ</button></div>
   {!currentHistory&&!currentHistoryError&&<p className="knowledge-catalog-feedback" role="status">กำลังโหลดประวัติ…</p>}
   {currentHistoryError&&<div className="knowledge-catalog-feedback" role="alert"><p>{currentHistoryError}</p><button className="knowledge-button knowledge-button-secondary" type="button" onClick={retryHistory}>ลองโหลดอีกครั้ง</button></div>}
   {currentHistory&&<>
    {currentHistory.documents.length===0?<p className="knowledge-catalog-empty-line">ไม่มีฉบับอนุมัติในสายเอกสารนี้</p>:<ul className="knowledge-catalog-history-list">{currentHistory.documents.map(document=><li key={document.id}><DocumentSummary document={document} onSelect={()=>selectDocument(document.id)} selected={selectedDocumentId===document.id} /></li>)}</ul>}
    <Pager label="ประวัติฉบับ" page={currentHistory.page} pageCount={historyPageCount} onChange={page=>setHistoryPage(page)} />
   </>}
  </section>}

  {selectedDocumentId&&<section className="knowledge-catalog-region knowledge-catalog-detail" aria-labelledby="knowledge-catalog-document-title" aria-busy={!currentDocument&&!currentDocumentError}>
   <div className="knowledge-catalog-region-heading"><div><p className="knowledge-catalog-kicker">รายละเอียดเอกสาร</p><h3 id="knowledge-catalog-document-title" ref={node=>{documentHeading.current=node;}} tabIndex={-1}>{currentDocument?.summary.title??'รายละเอียดเอกสาร'}</h3><p>ข้อมูลนี้เป็น metadata และความสัมพันธ์ที่บันทึกไว้ในระบบ</p></div><button className="knowledge-button knowledge-button-tertiary" type="button" onClick={()=>selectDocument(selectedDocumentId)}>ปิดรายละเอียด</button></div>
   {!currentDocument&&!currentDocumentError&&<p className="knowledge-catalog-feedback" role="status">กำลังโหลดรายละเอียด…</p>}
   {currentDocumentError&&<div className="knowledge-catalog-feedback" role="alert"><p>{currentDocumentError}</p><button className="knowledge-button knowledge-button-secondary" type="button" onClick={retryDocument}>ลองโหลดอีกครั้ง</button></div>}
   {currentDocument&&<DocumentDetails document={currentDocument} pageCount={relationPageCount} onPageChange={setRelationsPage} onSelectRelated={selectDocument} />}
  </section>}
 </section>;
}

function DocumentSummary({document,onSelect,selected}:{document:CatalogSummary;onSelect:()=>void;selected:boolean}){
 return <div className="knowledge-catalog-document-summary">
  <button className="knowledge-catalog-document-open" type="button" aria-expanded={selected} onClick={onSelect}><strong>{document.title}</strong><span>ฉบับ {document.versionName} · สาย {document.versionStream}</span></button>
  <dl className="knowledge-catalog-facts"><div><dt>สถานะเอกสาร</dt><dd>{statusLabels[document.status]}</dd></div><div><dt>สถานะฉบับปัจจุบันในสาย</dt><dd>{document.isCurrent?'ปัจจุบัน':'ไม่ใช่ฉบับปัจจุบัน'}</dd></div><div><dt>หน่วยงาน</dt><dd>{document.department?`${document.department.name} (${document.department.code})`:'ไม่ทราบหน่วยงาน'}</dd></div><div><dt>รูปแบบฉบับ</dt><dd>{document.storageMode?modeLabels[document.storageMode]:'ไม่ทราบรูปแบบ'}</dd></div><div><dt>ปีการศึกษา</dt><dd>{document.academicYear??'ไม่ระบุ'}</dd></div><div><dt>การมองเห็น</dt><dd>{document.visibility}</dd></div><div><dt>วันที่มีผล</dt><dd>{document.effectiveFrom?showDate(document.effectiveFrom):'ไม่ระบุ'} – {document.effectiveTo?showDate(document.effectiveTo):'ไม่ระบุ'}</dd></div><div><dt>นำเข้าล่าสุด</dt><dd>{document.lastImportAt?showDate(document.lastImportAt):'ไม่ทราบข้อมูล'}</dd></div></dl>
  <p className="knowledge-catalog-source"><span>แหล่งที่มา: </span>{sourceValue(document.sourceUrl)}</p>
 </div>;
}

function DocumentDetails({document,pageCount,onPageChange,onSelectRelated}:{document:CatalogDetail;pageCount:number;onPageChange:(page:number)=>void;onSelectRelated:(id:string)=>void}){
 const {summary,scope,review}=document;
 return <div className="knowledge-catalog-detail-body">
  <dl className="knowledge-catalog-facts knowledge-catalog-detail-facts">
   <Fact label="รหัสสายเอกสาร">{summary.familyId}</Fact><Fact label="ประเภทเอกสาร">{summary.documentType}</Fact><Fact label="ปีการศึกษา">{summary.academicYear??'ไม่ระบุ'}</Fact><Fact label="วันที่เผยแพร่">{showDate(summary.publishedAt)}</Fact>
   <Fact label="ระดับอำนาจ">{summary.authorityLevel}</Fact><Fact label="วันที่อนุมัติ">{showDate(summary.approvedAt)}</Fact><Fact label="วันที่มีผลเริ่มต้น">{showDate(summary.effectiveFrom)}</Fact><Fact label="วันที่มีผลสิ้นสุด">{showDate(summary.effectiveTo)}</Fact>
   <Fact label="วันที่สร้างรายการ">{showDate(document.createdAt)}</Fact><Fact label="วันที่ปรับปรุงรายการ">{showDate(document.updatedAt)}</Fact><Fact label="รหัสฉบับที่ถูกแทนที่">{document.supersedesDocumentId??'ไม่มีข้อมูล'}</Fact>
   <Fact label="ภาคการศึกษา">{scope.semester??'ไม่ระบุ'}</Fact><Fact label="กลุ่มผู้ใช้">{scope.audience}</Fact><Fact label="ประเภทนักศึกษา">{scope.studentType}</Fact><Fact label="หลักสูตร">{scope.programCode??'ไม่ระบุ'}</Fact><Fact label="รหัสหลักสูตร">{scope.curriculumCode??'ไม่ระบุ'}</Fact><Fact label="รุ่นเข้าศึกษา">{scope.cohort??'ไม่ระบุ'}</Fact>
   <Fact label="แหล่งทางการ">{review.officialSource?'ใช่':'ไม่ใช่'}</Fact><Fact label="ตรวจผลการสกัดแล้ว">{review.extractionReviewed?'ใช่':'ไม่ใช่'}</Fact><Fact label="ต้องตรวจเพิ่มเติม">{review.requiresReview?'ใช่':'ไม่ใช่'}</Fact><Fact label="เก็บเป็นเอกสารย้อนหลังเท่านั้น">{review.archiveOnly?'ใช่':'ไม่ใช่'}</Fact>
   <Fact label="URL แหล่งที่มา">{sourceValue(summary.sourceUrl)}</Fact><Fact label="URL หน้าที่อ้างอิง">{sourceValue(summary.sourcePageUrl)}</Fact>
  </dl>
  <section className="knowledge-catalog-relations" aria-labelledby="knowledge-catalog-relations-title">
   <div className="knowledge-catalog-region-heading"><div><h4 id="knowledge-catalog-relations-title">ความสัมพันธ์ที่บันทึกไว้</h4><p>{document.totalRelationships.toLocaleString('th-TH')} รายการ · ไม่ใช่การประเมินว่าเงื่อนไขมีผลอยู่ในปัจจุบัน</p></div></div>
   {document.relationships.length===0?<p className="knowledge-catalog-empty-line">ไม่มีความสัมพันธ์ที่เปิดเผยในรายการนี้</p>:<ul className="knowledge-catalog-relation-list">{document.relationships.map((relationship,index)=><li key={`${relationship.type}-${relationship.direction}-${relationship.documentId}-${index}`}><div><strong>{relationship.title}</strong><span>ฉบับ {relationship.versionName} · {statusLabels[relationship.status]}</span><small>{relationship.type} · {relationship.direction==='INCOMING'?'อ้างอิงเข้ามายังเอกสารนี้':'เอกสารนี้อ้างอิงไปยังรายการ'}</small></div><button className="knowledge-button knowledge-button-secondary" type="button" onClick={()=>onSelectRelated(relationship.documentId)}>ดูเอกสารที่เกี่ยวข้อง</button></li>)}</ul>}
   <Pager label="ความสัมพันธ์" page={document.relationsPage} pageCount={pageCount} onChange={onPageChange} />
  </section>
 </div>;
}
function Fact({label,children}:{label:string;children:ReactNode}){return <div><dt>{label}</dt><dd>{children}</dd></div>;}

function Pager({label,page,pageCount,onChange}:{label:string;page:number;pageCount:number;onChange:(page:number)=>void}){
 return <nav className="knowledge-catalog-pager" aria-label={`แบ่งหน้า: ${label}`}>
  <button className="knowledge-button knowledge-button-secondary" type="button" disabled={page<=1} onClick={()=>onChange(Math.max(1,page-1))}>ก่อนหน้า</button>
  <span aria-live="polite">หน้า {page.toLocaleString('th-TH')} จาก {pageCount.toLocaleString('th-TH')}</span>
  <button className="knowledge-button knowledge-button-secondary" type="button" disabled={page>=pageCount} onClick={()=>onChange(Math.min(pageCount,page+1))}>ถัดไป</button>
 </nav>;
}
