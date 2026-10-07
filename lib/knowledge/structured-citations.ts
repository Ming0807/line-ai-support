import {z} from 'zod';
import {canonicalDigest,copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {provenanceUrl} from '../imports/source';
import {STRUCTURED_DATASETS,validateStructuredPayload} from './structured-payload';
import {getStructuredRegistryEntry} from './structured-registry';
import {validateStructuredRowReference} from './structured-row-reference';
import {lineMessages,locationLabel} from './citations';

export const STRUCTURED_EVIDENCE_MAX_BYTES=64*1024;
const invalid=():never=>{throw new Error('STRUCTURED_CITATION_INVALID');};
const citationLabel=(value:string)=>value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu,' ');
const schema=z.object({rowId:z.uuid(),dataset:z.enum(STRUCTURED_DATASETS),payload:z.unknown(),reference:z.unknown(),
 title:z.string().min(1).max(500),familyCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/u),academicYear:z.number().int().min(2400).max(3000).nullable(),
 authorityLevel:z.number().int().min(0).max(100),sourceUrl:z.string().max(2048).nullable()}).strict();
export const structuredAnswerSchema=z.object({answer:z.string().trim().min(1).max(3000).refine(s=>!/(?:https?:\/\/|www\.)/iu.test(s)),
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
export function structuredEvidenceStillMatches(previous:unknown,current:unknown):boolean {
 try{
  const before=validateStructuredEvidenceList(previous),after=validateStructuredEvidenceList(current);
  const byId=new Map(after.map(row=>[row.rowId,row]));
  return before.length===after.length&&before.every(row=>canonicalDigest('structured-evidence-v1',row)===canonicalDigest('structured-evidence-v1',byId.get(row.rowId)));
 }catch{return false;}
}
export function buildStructuredAnswer(input:unknown,available:StructuredEvidence[]){
 try{
  const answer=structuredAnswerSchema.parse(input),evidence=validateStructuredEvidenceList(available),byId=new Map(evidence.map(row=>[row.rowId,row]));
  const citations=answer.citationRowIds.map(rowId=>{
   const row=byId.get(rowId);if(!row)return invalid();
   return {rowId,dataset:row.dataset,documentId:row.reference.documentId,documentRevision:row.reference.documentRevision,title:row.title,
    familyCode:row.familyCode,academicYear:row.academicYear,sourceUrl:row.sourceUrl,sourceLocation:structuredClone(row.reference.sourceLocation),
    sourceRow:row.reference.sourceRow,coordinateKind:row.reference.coordinateKind};
  });
  const references=citations.map((c,i)=>`${i+1}. ${citationLabel(c.title)}${c.academicYear===null?'':` (ปี ${c.academicYear})`} · ${citationLabel(locationLabel(c.sourceLocation))} · แถว ${c.sourceRow}${c.coordinateKind==='EXTRACTED_LOGICAL'?' ของตารางที่สกัด':''}${c.sourceUrl===null?'':`\n${c.sourceUrl}`}`).join('\n');
  return {messages:lineMessages(`${answer.answer}\n\nแหล่งอ้างอิง:\n${references}`),citations};
 }catch{return invalid();}
}
