'use client';

import type {ImportReviewDraft} from '@/lib/imports/review-schema';
import type {PublicSourceReview} from '@/lib/imports/public-source-review';
import {publicSourceModeAllowed} from '@/lib/imports/public-source-mode';

type Category='GRADES'|'STUDENT_RECORDS'|'PHONE';
type Basis=PublicSourceReview['sensitivityAdjudications'][number]['basis'];
type Props={
 value:PublicSourceReview;
 documentType:ImportReviewDraft['metadata']['documentType'];
 visibility:ImportReviewDraft['metadata']['visibility'];
 storageMode:ImportReviewDraft['metadata']['storageMode'];
 datasetType?:ImportReviewDraft['metadata']['datasetType'];
 academicYear?:number|null;
 publishedAt:string|null;
 effectiveFrom:string|null;
 effectiveTo:string|null;
 action:ImportReviewDraft['action'];
 relationship:ImportReviewDraft['relationship'];
 target:ImportReviewDraft['target'];
 sourceUrl:string|null;
 scope?:ImportReviewDraft['metadata']['scope'];
 sensitiveCategories:readonly string[];
 sourceFormat?:string;
 extractionWarnings?:readonly {key:string;code:string;location?:{kind:string;pageNumber?:number}|null}[];
 disabled:boolean;
 onChange:(value:PublicSourceReview)=>void;
};

const categoryNames:Record<string,string>={GRADES:'ผลการเรียน',STUDENT_RECORDS:'ข้อมูลนักศึกษา',PHONE:'หมายเลขโทรศัพท์'};
const basisNames:Record<Basis,string>={
 GENERAL_POLICY_WORDING:'ถ้อยคำของนโยบายทั่วไป',
 PUBLIC_BLANK_TEMPLATE:'ช่องข้อมูลในแบบฟอร์มว่าง',
 INSTITUTIONAL_CONTACT:'หมายเลขติดต่อของหน่วยงาน',
};
const categorySet=new Set<Category>(['GRADES','STUDENT_RECORDS','PHONE']);
export function publicSourceCategoryName(category:string):string{return categoryNames[category]??category;}
export function publicSourceBasisName(basis:Basis):string{return basisNames[basis];}

function basesFor(category:Category):Basis[]{
 if(category==='GRADES')return ['GENERAL_POLICY_WORDING','PUBLIC_BLANK_TEMPLATE'];
 if(category==='STUDENT_RECORDS')return ['PUBLIC_BLANK_TEMPLATE'];
 return ['INSTITUTIONAL_CONTACT'];
}

function basisMatchesType(basis:Basis,documentType:string|null):boolean{
 if(basis==='GENERAL_POLICY_WORDING')return ['REGULATION','GUIDE','CALENDAR','ANNOUNCEMENT'].includes(documentType??'');
 if(basis==='PUBLIC_BLANK_TEMPLATE')return documentType==='FORM';
 return documentType==='GUIDE';
}

export function publicSourceReviewIssues(input:Props):string[]{
 const issues:string[]=[];
 if(input.visibility!=='PUBLIC'||!publicSourceModeAllowed(input,Boolean(input.value.transcription)))issues.push('ใช้กับเอกสารสาธารณะ หรือข้อมูลบริการที่ตรวจเทียบกับต้นฉบับทางการแล้วเท่านั้น');
 if(input.value.transcription){
  if(input.sourceFormat!=='CSV'||input.sourceUrl!==input.value.transcription.parent.sourceUrl)issues.push('ไฟล์ถอดข้อมูลต้องเป็น CSV และอ้างถึงหน้าเว็บต้นฉบับที่เลือกไว้');
  if(input.academicYear!=null||input.scope?.audience!=='ALL'||input.scope?.studentType!=='ALL'||[input.scope?.semester,input.scope?.programCode,input.scope?.curriculumCode,input.scope?.cohort].some(value=>value!=null))issues.push('ข้อมูลบริการทั่วไปต้องไม่เติมปี รุ่น หรือหลักสูตรที่ต้นฉบับไม่ได้ระบุ');
 }
 if(!input.sourceUrl?.trim())issues.push('ระบุ URL ต้นฉบับทางการก่อน');
 if(input.value.temporalBasis==='CURRENT_REVIEWED'){
  if(!['FORM','GUIDE','CALENDAR','ANNOUNCEMENT'].includes(input.documentType??''))issues.push('การทบทวนแบบข้อมูลปัจจุบันใช้กับแบบฟอร์ม คู่มือ ปฏิทิน หรือประกาศเฉพาะรุ่นเท่านั้น');
  if(input.documentType==='ANNOUNCEMENT'&&(input.scope?.cohort==null||!input.scope.audience||input.scope.audience==='ALL'||!input.scope.studentType||input.scope.studentType==='ALL'))issues.push('ประกาศแบบข้อมูลปัจจุบันต้องระบุรุ่น ระดับผู้เรียน และภาคการศึกษาเฉพาะ ห้ามใช้ทุกกลุ่ม');
  if(input.documentType==='ANNOUNCEMENT'&&input.publishedAt===null)issues.push('ระบุวันที่ประกาศตามต้นฉบับ โดยไม่ใช้แทนวันเริ่มมีผล');
  if(input.effectiveFrom!==null||input.effectiveTo!==null)issues.push('ล้างวันที่เริ่มมีผลและวันสิ้นผล เพราะต้นฉบับไม่ได้ระบุวันเหล่านี้');
  if(!input.value.temporalReason?.trim())issues.push('ระบุเหตุผลที่ยืนยันข้อมูลปัจจุบันโดยไม่แทนวันที่ที่ไม่มีในต้นฉบับ');
  if(input.action!=='NEW_FAMILY'&&input.action!=='ADD_ADDITIONAL'||input.relationship!==null||input.target!==null)issues.push('เลือกการเพิ่มเอกสารใหม่หรือเพิ่มฉบับในกลุ่มเดิมโดยไม่ผูกกับฉบับหรือการยกเลิก');
 }
 if(input.value.temporalBasis==='DATED'&&input.effectiveFrom===null)issues.push('วันที่เริ่มมีผลยังจำเป็นสำหรับเส้นทางที่ใช้วันที่');
 const adjudications=input.value.sensitivityAdjudications;
 const supported=input.sensitiveCategories.filter((category):category is Category=>categorySet.has(category as Category));
 const unsupported=input.sensitiveCategories.filter(category=>!categorySet.has(category as Category));
 if(unsupported.length)issues.push(`หมวดหมู่ ${unsupported.map(category=>categoryNames[category]??category).join('、')} ยังใช้การทบทวนแหล่งข้อมูลสาธารณะนี้ไม่ได้`);
 if(adjudications.length!==supported.length||supported.some(category=>!adjudications.some(item=>item.category===category)))issues.push('เลือกเหตุผลให้ครบทุกหมวดหมู่ที่ระบบตรวจพบ');
 for(const item of adjudications){
  if(!input.sensitiveCategories.includes(item.category))issues.push(`ลบการพิจารณา ${categoryNames[item.category]} ที่ไม่ตรงกับผลวิเคราะห์ปัจจุบัน`);
  if(!basisMatchesType(item.basis,input.documentType))issues.push(`ประเภทเอกสารปัจจุบันไม่รองรับเหตุผล “${basisNames[item.basis]}”`);
  if(item.basis==='GENERAL_POLICY_WORDING'&&item.category!=='GRADES'||item.basis==='PUBLIC_BLANK_TEMPLATE'&&!['STUDENT_RECORDS','GRADES'].includes(item.category)||item.basis==='INSTITUTIONAL_CONTACT'&&item.category!=='PHONE')issues.push(`เหตุผล “${basisNames[item.basis]}” ไม่ตรงกับหมวดหมู่ ${categoryNames[item.category]}`);
  if(!item.reason?.trim())issues.push(`ระบุเหตุผลจากต้นฉบับสำหรับ ${categoryNames[item.category]}`);
 }
 const diagrams=input.value.extractionAdjudications??[];
 const findings=(input.extractionWarnings??[]).filter(w=>w.code==='UNSUPPORTED_TABLES'&&w.location?.kind==='PDF');
 for(const item of diagrams){
  if(input.sourceFormat!=='PDF'||!['FORM','GUIDE'].includes(input.documentType??'')||!findings.some(w=>w.key===item.warningKey))issues.push('การตรวจแผนภาพไม่ตรงกับหน้าเอกสาร PDF ปัจจุบัน กรุณาเริ่มตรวจใหม่');
  if(!item.reason?.trim())issues.push('ระบุเหตุผลจากการตรวจภาพต้นฉบับสำหรับแผนภาพ');
 }
 if(input.sourceFormat==='PDF'&&['FORM','GUIDE'].includes(input.documentType??'')&&findings.some(w=>!diagrams.some(a=>a.warningKey===w.key)))issues.push('แก้การอ่านตาราง หรือทบทวนแผนภาพแต่ละหน้าจากต้นฉบับก่อนอนุมัติ');
 return [...new Set(issues)];
}

export default function PublicSourceReviewPanel({value,documentType,visibility,storageMode,datasetType,academicYear,publishedAt,effectiveFrom,effectiveTo,action,relationship,target,sourceUrl,scope,sensitiveCategories,sourceFormat,extractionWarnings=[],disabled,onChange}:Props){
 const issues=publicSourceReviewIssues({value,documentType,visibility,storageMode,datasetType,academicYear,publishedAt,effectiveFrom,effectiveTo,action,relationship,target,sourceUrl,scope,sensitiveCategories,sourceFormat,extractionWarnings,disabled,onChange});
 const update=(patch:Partial<PublicSourceReview>)=>onChange({...value,...patch});
 const diagramWarnings=sourceFormat==='PDF'&&['FORM','GUIDE'].includes(documentType??'')&&storageMode==='RAG'?extractionWarnings.filter(w=>w.code==='UNSUPPORTED_TABLES'&&w.location?.kind==='PDF'):[];

 function setAdjudication(category:Category,basis:Basis|''){
  const current=value.sensitivityAdjudications.find(item=>item.category===category);
  const next=value.sensitivityAdjudications.filter(item=>item.category!==category);
  if(basis)next.push({category,basis,reason:current?.reason??null});
  update({sensitivityAdjudications:next});
 }
 function setReason(category:Category,reason:string){
  update({sensitivityAdjudications:value.sensitivityAdjudications.map(item=>item.category===category?{...item,reason:reason===''?null:reason}:item)});
 }

 return <section className="knowledge-review-section knowledge-public-source-review" aria-labelledby="public-source-review-title">
  <h4 id="public-source-review-title">ทบทวนแหล่งข้อมูลสาธารณะ</h4>
  {value.transcription&&<p className="knowledge-hint">ไฟล์นี้เป็นฉบับถอดข้อมูล ระบบจะตรวจเทียบเมื่อบันทึก · ต้นฉบับ: <a href={value.transcription.parent.sourceUrl} target="_blank" rel="noreferrer">{value.transcription.parent.title}</a></p>}
  {documentType==='ANNOUNCEMENT'&&value.temporalBasis==='CURRENT_REVIEWED'&&<p className="knowledge-hint">ขอบเขตประกาศ: รุ่น {scope?.cohort??'ยังไม่ระบุ'} · {scope?.audience??'ยังไม่ระบุระดับผู้เรียน'} · {scope?.studentType??'ยังไม่ระบุภาคการศึกษา'}</p>}
  <p className="knowledge-hint">บันทึกการพิจารณาแยกจากคำเตือนเดิม ระบบยังเก็บผลตรวจและประวัติการทบทวนไว้ครบ</p>
  <div className="knowledge-review-grid">
   <label className="knowledge-field">
    ฐานการระบุเวลา
    <select value={value.temporalBasis} disabled={disabled} onChange={event=>update({temporalBasis:event.currentTarget.value as PublicSourceReview['temporalBasis'],temporalReason:event.currentTarget.value==='DATED'?null:value.temporalReason})}>
     <option value="DATED">ระบุวันที่ตามต้นฉบับ</option>
     <option value="CURRENT_REVIEWED">ตรวจแล้วว่าเป็นข้อมูลปัจจุบัน โดยต้นฉบับไม่ระบุวันเริ่มใช้</option>
    </select>
    <span className="knowledge-hint">วันที่ประกาศเว้นว่างได้เมื่อไม่ปรากฏในต้นฉบับ ระบบจะไม่ใช้วันดึงหน้าแทน</span>
   </label>
   {value.temporalBasis==='CURRENT_REVIEWED'&&<label className="knowledge-field">
    เหตุผลที่ยืนยันข้อมูลปัจจุบัน *
    <textarea value={value.temporalReason??''} maxLength={500} disabled={disabled} placeholder="บันทึกสิ่งที่ตรวจจากหน้าแหล่งทางการ" onChange={event=>update({temporalReason:event.currentTarget.value===''?null:event.currentTarget.value})}/>
   </label>}
  </div>
  {value.temporalBasis==='CURRENT_REVIEWED'&&<p className="knowledge-hint">ใช้ได้กับแบบฟอร์ม คู่มือ หรือปฏิทินที่ไม่มีวันเริ่ม/สิ้นผล และเพิ่มเป็นเอกสารใหม่หรือฉบับเพิ่มเติมเท่านั้น</p>}
  {sensitiveCategories.length>0&&<ul className="knowledge-review-warnings" aria-label="การพิจารณาหมวดหมู่ที่ตรวจพบ">
   {sensitiveCategories.map(category=>{
    if(!categorySet.has(category as Category))return <li key={category}><p className="knowledge-review-stale">{categoryNames[category]??category}: หมวดหมู่นี้ยังใช้การทบทวนแหล่งข้อมูลสาธารณะนี้ไม่ได้</p></li>;
    const typed=category as Category,current=value.sensitivityAdjudications.find(item=>item.category===typed),options=basesFor(typed).filter(basis=>basisMatchesType(basis,documentType));
    const visibleOptions=current&&!options.includes(current.basis)?[current.basis,...options]:options;
    return <li key={typed}><fieldset>
     <legend>{categoryNames[typed]} · ผลตรวจยังคงอยู่</legend>
     <label className="knowledge-field">
      เหตุผลที่ตรงกับต้นฉบับ
      <select value={current?.basis??''} disabled={disabled} onChange={event=>setAdjudication(typed,event.currentTarget.value as Basis|'')}>
       <option value="">{options.length?'เลือกเหตุผลจากต้นฉบับ':'เลือกประเภทเอกสารที่ตรงกับต้นฉบับก่อน'}</option>
       {visibleOptions.map(basis=><option value={basis} key={basis}>{basisNames[basis]}{!options.includes(basis)?' · ไม่ตรงกับประเภทเอกสาร':''}</option>)}
      </select>
     </label>
     {current&&<label className="knowledge-field">
      เหตุผลจากการตรวจต้นฉบับ *
      <textarea value={current.reason??''} maxLength={500} disabled={disabled} placeholder="ระบุว่าตรวจตรงไหนและพบอะไร" onChange={event=>setReason(typed,event.currentTarget.value)}/>
     </label>}
    </fieldset></li>;
   })}
  </ul>}
  {diagramWarnings.map(warning=>{
   const current=value.extractionAdjudications?.find(a=>a.warningKey===warning.key);
   return <fieldset className="knowledge-review-section" key={warning.key}><legend>แผนภาพหน้า {warning.location?.pageNumber}</legend>
    <p className="knowledge-hint">ใช้เมื่ออ่านภาพและข้อความครบแล้ว ช่องที่ตรวจพบเป็นแผนภาพขั้นตอน ไม่มีข้อมูลตารางตกหล่น ระบบยังเก็บคำเตือนและต้นฉบับไว้</p>
    <label className="knowledge-field"><span><input type="checkbox" checked={Boolean(current)} disabled={disabled} onChange={event=>{
     const rest=(value.extractionAdjudications??[]).filter(a=>a.warningKey!==warning.key);
     update({extractionAdjudications:event.currentTarget.checked?[...rest,{warningKey:warning.key,basis:'REVIEWED_NON_TABULAR_DIAGRAM',reason:null}]:rest});
    }}/> ตรวจภาพหน้า {warning.location?.pageNumber} แล้วเป็นแผนภาพขั้นตอน</span></label>
    {current&&<label className="knowledge-field">สิ่งที่ตรวจยืนยันจากแผนภาพ *<textarea maxLength={500} value={current.reason??''} disabled={disabled} onChange={event=>update({extractionAdjudications:(value.extractionAdjudications??[]).map(a=>a.warningKey===warning.key?{...a,reason:event.currentTarget.value||null}:a)})}/></label>}
   </fieldset>;
  })}
  {issues.length>0&&<div className="knowledge-review-stale" role="status"><strong>ยังไม่ครบสำหรับการพิจารณานี้</strong><ul>{issues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}
  {sensitiveCategories.length===0&&<p className="knowledge-hint">ยังไม่มีหมวดหมู่ที่ต้องพิจารณาเพิ่ม</p>}
 </section>;
}
