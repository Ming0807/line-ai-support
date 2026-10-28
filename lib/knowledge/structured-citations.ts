import {z} from 'zod';
import {canonicalDigest,copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {provenanceUrl} from '../imports/source';
import {STRUCTURED_DATASETS,validateStructuredPayload} from './structured-payload';
import {getStructuredRegistryEntry} from './structured-registry';
import {validateStructuredRowReference} from './structured-row-reference';
import {lineMessages,locationLabel} from './citations';
import {knowledgeScopeSchema} from './retrieval';

export const STRUCTURED_EVIDENCE_MAX_BYTES=64*1024;
const invalid=():never=>{throw new Error('STRUCTURED_CITATION_INVALID');};
const citationLabel=(value:string)=>value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu,' ');
const schema=z.object({rowId:z.uuid(),dataset:z.enum(STRUCTURED_DATASETS),payload:z.unknown(),reference:z.unknown(),
 title:z.string().min(1).max(500),familyCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/u),academicYear:z.number().int().min(2400).max(3000).nullable(),
 authorityLevel:z.number().int().min(0).max(100),sourceUrl:z.string().max(2048).nullable()}).strict();
export const structuredAnswerSchema=z.object({answer:z.string().min(1).max(12000).refine(value=>value.trim().length>0).refine(s=>!/(?:https?:\/\/|www\.)/iu.test(s)),
 citationRowIds:z.array(z.uuid()).min(1).max(5).refine(ids=>new Set(ids).size===ids.length)}).strict();

/** Only persisted-source callers may construct this internal evidence. Shape alone is not authorization. */
export function validateStructuredEvidence(input:unknown){
 try{
  const value=schema.parse(copyStructuredJson(input,STRUCTURED_EVIDENCE_MAX_BYTES,2048));
  const payload=validateStructuredPayload(value.dataset,value.payload),reference=validateStructuredRowReference(value.reference,payload);
  for(const field of getStructuredRegistryEntry(value.dataset).fields){
   const url=payload[field.name as keyof typeof payload];
   if(field.kind==='URL'&&url!==null&&typeof url==='string'&&provenanceUrl(url)!==url)return invalid();
  }
  if(value.rowId!==reference.rowId||value.dataset!==reference.dataset)return invalid();
  const sourceUrl=value.sourceUrl===null?null:provenanceUrl(value.sourceUrl);
  if(sourceUrl!==value.sourceUrl)return invalid();
  if(reference.sourceLocation.kind==='HTML'&&reference.sourceLocation.sourceUrl!==null)provenanceUrl(reference.sourceLocation.sourceUrl);
  return freezeStructuredData({...value,payload,reference,sourceUrl});
 }catch{return invalid();}
}
export type StructuredEvidence=ReturnType<typeof validateStructuredEvidence>;
/** Administrative codes assigned during transcription are selectors, not facts observed in the source. */
export function structuredPromptEvidence(row:StructuredEvidence){
 const payload:Record<string,unknown>={...row.payload};if(row.reference.transcription)delete payload.service_code;
 return {rowId:row.rowId,dataset:row.dataset,payload,title:row.title,academicYear:row.academicYear};
}
export const structuredEvidenceListSchema=z.unknown().transform((input,context)=>{
 try{return validateStructuredEvidenceList(input);}catch{context.addIssue({code:'custom',message:'STRUCTURED_CITATION_INVALID'});return z.NEVER;}
});
export function validateStructuredEvidenceList(input:unknown):StructuredEvidence[]{
 try{
  const snapshot=copyStructuredJson(input,STRUCTURED_EVIDENCE_MAX_BYTES,4096);
  if(!Array.isArray(snapshot)||snapshot.length<1||snapshot.length>20)return invalid();
  const result=snapshot.map(validateStructuredEvidence);if(new Set(result.map(row=>row.rowId)).size!==result.length)return invalid();
  return freezeStructuredData(result);
 }catch{return invalid();}
}
const formDirectoryShapeSchema=z.object({kind:z.literal('FORM_DIRECTORY'),scope:knowledgeScopeSchema,evidence:structuredEvidenceListSchema,
 support:z.never().optional()}).strict();
/** The full private result is bounded independently from the smaller evidence-list limit. */
export const formDirectoryResultSchema=formDirectoryShapeSchema.superRefine((value,context)=>{
 try{
  copyStructuredJson(value,128*1024,20_000);
  if(value.evidence.length>20||value.evidence.some(row=>row.dataset!=='service_forms'))throw new Error('FORM_DIRECTORY_INVALID');
 }catch{context.addIssue({code:'custom',message:'FORM_DIRECTORY_INVALID'});}
});
export function structuredEvidenceStillMatches(previous:unknown,current:unknown):boolean {
 try{
  const before=validateStructuredEvidenceList(previous),after=validateStructuredEvidenceList(current);
  const byId=new Map(after.map(row=>[row.rowId,row]));
  return before.length===after.length&&before.every(row=>canonicalDigest('structured-evidence-v1',row)===canonicalDigest('structured-evidence-v1',byId.get(row.rowId)));
 }catch{return false;}
}
function renderStructuredAnswer(answer:string,citationRowIds:readonly string[],evidence:StructuredEvidence[],includeFormDescriptions=false){
 const byId=new Map(evidence.map(row=>[row.rowId,row]));
 const citations=citationRowIds.map(rowId=>{
   const row=byId.get(rowId);if(!row)return invalid();
   return {rowId,dataset:row.dataset,documentId:row.reference.documentId,documentRevision:row.reference.documentRevision,title:row.title,
    familyCode:row.familyCode,academicYear:row.academicYear,sourceUrl:row.sourceUrl,sourceLocation:structuredClone(row.reference.sourceLocation),
    sourceRow:row.reference.sourceRow,coordinateKind:row.reference.coordinateKind,...(row.reference.transcription?{primarySource:structuredClone(row.reference.transcription)}:{})};
  });
 const references=citations.map((c,i)=>c.primarySource?`${i+1}. ${citationLabel(c.primarySource.parent.title)} · ตรวจเทียบข้อมูลจากหน้าเว็บทางการ\n${c.primarySource.parent.sourceUrl}`:`${i+1}. ${citationLabel(c.title)}${c.academicYear===null?'':` (ปี ${c.academicYear})`} · ${citationLabel(locationLabel(c.sourceLocation))} · แถว ${c.sourceRow}${c.coordinateKind==='EXTRACTED_LOGICAL'?' ของตารางที่สกัด':''}${c.sourceUrl===null?'':`\n${c.sourceUrl}`}`).join('\n');
 // Destination links come only from validated cited rows, never model prose.
 // Keep them distinct from the document/page proving where the data came from.
 const formLinks=citationRowIds.flatMap((rowId,index)=>{
   const row=byId.get(rowId)!;
   if(row.dataset!=='service_forms'||!('form_url' in row.payload)||!('name' in row.payload))return [];
   const description=includeFormDescriptions&&'description' in row.payload&&row.payload.description
    ?`\nคำอธิบายจากเอกสาร: ${row.payload.description}`:'';
   return [`${index+1}. ${citationLabel(row.payload.name)}${description}\n${row.payload.form_url}`];
  });
 const destinations=formLinks.length?`\n\nลิงก์แบบฟอร์ม:\n${formLinks.join('\n')}`:'';
 const serviceLinks=citationRowIds.flatMap((rowId,index)=>{
  const row=byId.get(rowId)!;
  if(row.dataset!=='university_services')return [];
  const service=validateStructuredPayload('university_services',row.payload);
  return service.url===null?[]:[`${index+1}. ${citationLabel(service.name)}\n${service.url}`];
 });
 const serviceDestinations=serviceLinks.length?`\n\nเว็บไซต์บริการตามเอกสาร:\n${serviceLinks.join('\n')}`:'';
 return {messages:lineMessages(`${answer}${destinations}${serviceDestinations}\n\nแหล่งอ้างอิง:\n${references}`),citations};
}
export function buildStructuredAnswer(input:unknown,available:StructuredEvidence[]){
 try{
  const answer=structuredAnswerSchema.parse(input),evidence=validateStructuredEvidenceList(available);
  if(evidence.some(row=>answer.answer.toLowerCase().includes(row.rowId.toLowerCase())))return invalid();
  if(evidence.some(row=>row.reference.transcription&&row.dataset==='university_services'&&'service_code'in row.payload&&answer.answer.toLowerCase().includes(row.payload.service_code.toLowerCase())))return invalid();
  const byId=new Map(evidence.map(row=>[row.rowId,row]));
  const selected=answer.citationRowIds.map(rowId=>{const row=byId.get(rowId);return row??invalid();});
  let text=answer.answer;
  if(selected.some(row=>row.dataset==='academic_calendar_events')){
   // Citations prove a row exists, not that model-written date conversions are correct.
   // Keep date facts at the same server boundary used again for final delivery.
   if(selected.some(row=>row.dataset!=='academic_calendar_events'))return invalid();
   text=selected.map(row=>{
    const value=validateStructuredPayload('academic_calendar_events',row.payload);
    return `${value.title}\nปีการศึกษา ${value.academic_year} · ${value.semester} · ${value.student_type}`+
     `\nวันที่เริ่ม: ${value.start_date}${value.end_date===null?'':`\nวันที่สิ้นสุด: ${value.end_date}`}`+
     (value.description===null?'':`\nรายละเอียดจากเอกสาร: ${value.description}`);
   }).join('\n\n');
   // Preserve existing output bounds and URL restrictions; never clip source qualifications.
   if(!structuredAnswerSchema.shape.answer.safeParse(text).success)return invalid();
  }
  return renderStructuredAnswer(text,answer.citationRowIds,evidence);
 }catch(error){if(error instanceof Error&&error.message==='LINE_TEXT_PACKET_TOO_LARGE')throw error;return invalid();}
}
/** Server-owned copy for a reviewed form directory; no model prose or destinations enter this path. */
export function buildStructuredFormDirectory(available:unknown){
 try{
  const evidence=validateStructuredEvidenceList(available);
  if(evidence.some(row=>row.dataset!=='service_forms'))return invalid();
  return renderStructuredAnswer('รายการนี้แสดงแบบฟอร์มที่ผ่านการตรวจทานแล้ว กรุณาเลือกแบบฟอร์มที่ตรงกับเรื่องของคุณและอ่านรายละเอียดก่อนยื่น รายการนี้ไม่ได้ยืนยันว่าคุณมีสิทธิ์หรือเข้าเกณฑ์',
   evidence.map(row=>row.rowId),evidence,true);
 }catch(error){if(error instanceof Error&&error.message==='LINE_TEXT_PACKET_TOO_LARGE')throw error;return invalid();}
}
