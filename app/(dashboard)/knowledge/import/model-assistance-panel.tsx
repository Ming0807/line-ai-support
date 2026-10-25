'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {ImportReviewDraft} from '@/lib/imports/review-schema';
import {modelAssistanceResultSchema,type ImportModelResult,type ImportModelSuggestion} from '@/lib/imports/model-assistance-contract';

type ModelAssistancePanelProps={
 jobId:string;
 jobRevision:number;
 extractionRevision:number;
 disabled:boolean;
 onApply:(suggestions:readonly ImportModelSuggestion[])=>void;
};
type BoundResult={bindingKey:string;value:ImportModelResult};
type BoundError={bindingKey:string;message:string};
const fieldLabels:Record<ImportModelSuggestion['field'],string>={
 title:'ชื่อเอกสาร',familyCode:'กลุ่มเอกสาร',departmentCode:'หน่วยงาน',documentType:'ประเภทเอกสาร',versionName:'ชื่อฉบับ',academicYear:'ปีการศึกษา',
};

export function applyModelSuggestionsToDraft(draft:ImportReviewDraft,suggestions:readonly ImportModelSuggestion[]):ImportReviewDraft{
 const next=structuredClone(draft);
 for(const suggestion of suggestions){
  const field=suggestion.field;
  if(field==='academicYear'){
   if(next.metadata.academicYear!==null||!/^\d{4}$/u.test(suggestion.value))continue;
   const year=Number(suggestion.value);
   if(year>=2400&&year<=3000)next.metadata.academicYear=year;
   continue;
  }
  if(next.metadata[field]===null)Object.assign(next.metadata,{[field]:suggestion.value.trim()});
 }
 return next;
}

function errorMessage(status:number,code:unknown):string{
 if(status===409||code==='CONFLICT')return 'ข้อมูลเอกสารเปลี่ยนระหว่างเตรียมข้อเสนอ โหลดฉบับล่าสุดแล้วลองใหม่';
 if(status===422||code==='IMPORT_AI_SOURCE_REVIEW_REQUIRED')return 'ยังส่งข้อความให้ AI ไม่ได้ ตรวจต้นฉบับว่าอนุญาตให้ส่งและไม่มีข้อมูลส่วนบุคคลหรือข้อมูลลับ';
 if(status===503||code==='AI_UNAVAILABLE')return 'บริการ AI ฟรียังไม่พร้อม ลองอีกครั้งภายหลัง หรือกรอกข้อมูลด้วยตนเอง';
 return 'เตรียมข้อเสนอจาก AI ไม่สำเร็จ ลองอีกครั้งหรือกรอกข้อมูลด้วยตนเอง';
}

export default function ModelAssistancePanel({jobId,jobRevision,extractionRevision,disabled,onApply}:ModelAssistancePanelProps){
 const bindingKey=`${jobId}:${jobRevision}:${extractionRevision}`;
 const [consentKey,setConsentKey]=useState<string|null>(null);
 const [pendingKey,setPendingKey]=useState<string|null>(null);
 const [result,setResult]=useState<BoundResult|null>(null);
 const [error,setError]=useState<BoundError|null>(null);
 const requestId=useRef(0);
 const activeRequest=useRef<number|null>(null);
 const abortRef=useRef<AbortController|null>(null);

 useEffect(()=>()=>{
  requestId.current+=1;
  activeRequest.current=null;
  abortRef.current?.abort();
 },[bindingKey]);

 const consented=consentKey===bindingKey;
 const loading=pendingKey===bindingKey;
 const boundResult=result?.bindingKey===bindingKey?result.value:null;
 const boundError=error?.bindingKey===bindingKey?error.message:null;

 const requestAssistance=useCallback(async()=>{
  if(disabled||!consented||activeRequest.current!==null)return;
  const id=++requestId.current;
  activeRequest.current=id;
  const controller=new AbortController();abortRef.current=controller;
  const binding={jobId,jobRevision,extractionRevision};
  setPendingKey(bindingKey);setError(null);setResult(null);
  try{
   const response=await fetch(`/api/knowledge/imports/${encodeURIComponent(jobId)}/assistance`,{
    method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,
    headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedJobRevision:jobRevision,expectedExtractionRevision:extractionRevision,externalProcessingConfirmed:true}),
   });
   const body:unknown=await response.json().catch(()=>null);
   if(id!==requestId.current||controller.signal.aborted)return;
   if(!response.ok){
    const code=typeof body==='object'&&body!==null&&'error' in body?body.error:undefined;
    setError({bindingKey,message:errorMessage(response.status,code)});return;
   }
   const payload=typeof body==='object'&&body!==null&&'modelAssistance' in body?body.modelAssistance:undefined;
   const parsed=modelAssistanceResultSchema.safeParse(payload);
   if(!parsed.success||parsed.data.jobId!==binding.jobId||parsed.data.jobRevision!==binding.jobRevision||parsed.data.extractionRevision!==binding.extractionRevision){
    setError({bindingKey,message:errorMessage(409,'CONFLICT')});return;
   }
   setResult({bindingKey,value:parsed.data});
  }catch{
   if(id===requestId.current&&!controller.signal.aborted)setError({bindingKey,message:errorMessage(0,null)});
  }finally{
   if(activeRequest.current===id){activeRequest.current=null;abortRef.current=null;setPendingKey(null);}
  }
 },[bindingKey,consented,disabled,extractionRevision,jobId,jobRevision]);

 return <section className="knowledge-assisted-summary-card" aria-labelledby="model-assistance-title">
  <div className="knowledge-assisted-header"><div><h4 id="model-assistance-title">ตัวช่วย AI เพิ่มเติม (ไม่บังคับ)</h4></div></div>
  <p className="knowledge-hint">AI จะอ่านข้อความ 4 ส่วนแรกที่มีเนื้อหา ส่วนละไม่เกิน 3,000 ตัวอักษร พร้อมรหัสและชื่อกลุ่มเอกสารและหน่วยงานที่มีในระบบ ผ่านบริการ AI ภายนอกแบบใช้ฟรี ข้อเสนอต้องตรวจเทียบกับต้นฉบับ</p>
  <label className="knowledge-ai-consent">
   <input type="checkbox" checked={consented} disabled={disabled||loading} onChange={event=>setConsentKey(event.target.checked?bindingKey:null)}/>
   <span>ส่งข้อความบางส่วนจากเอกสาร และยืนยันว่าเอกสารนี้ส่งให้บริการภายนอกได้
   <span className="knowledge-hint">ยืนยันว่าได้รับอนุญาตให้ส่ง และเอกสารไม่มีข้อมูลส่วนบุคคลหรือข้อมูลลับ</span></span>
  </label>
  <button type="button" className="knowledge-button knowledge-button-primary" onClick={()=>void requestAssistance()} disabled={disabled||!consented||loading}>
   {loading?'กำลังเตรียมข้อเสนอ…':'ให้ AI ช่วยเตรียมข้อมูล'}
  </button>
  {boundError&&<p className="knowledge-message knowledge-message-error" role="alert">{boundError}</p>}
  {boundResult&&<div className="knowledge-assisted-facts" aria-live="polite">
   <p className="knowledge-hint">ข้อความอ้างอิงจากต้นฉบับ · ข้อเสนอ AI ยังไม่ใช่ข้อเท็จจริงที่ตรวจแล้ว</p>
   {boundResult.suggestions.length===0?<p>ไม่พบข้อเสนอที่มีหลักฐานตรงจากข้อความที่ส่งไป</p>:boundResult.suggestions.map(suggestion=><article className="knowledge-assisted-fact" key={`${suggestion.field}:${suggestion.segmentId}`}>
    <strong>{fieldLabels[suggestion.field]}: {suggestion.value}</strong>
    <p className="knowledge-hint">ข้อความที่อ่านได้ ส่วนที่ {suggestion.pageIndex+1}</p>
    <blockquote>{suggestion.quote}</blockquote>
   </article>)}
   {boundResult.omittedPages>0&&<p className="knowledge-hint">มีข้อความอีก {boundResult.omittedPages} ส่วนไม่ได้ส่งให้บริการ AI</p>}
   {boundResult.suggestions.length>0&&<button type="button" className="knowledge-button knowledge-button-secondary" disabled={disabled||loading} onClick={()=>onApply(boundResult.suggestions)}>
    เติมข้อเสนอเฉพาะช่องที่ยังว่าง
   </button>}
  </div>}
 </section>;
}
