import {z} from 'zod';
import type {OutboundText} from '../queue/outbox';
import type {KnowledgeEvidence} from './types';
import {sourceLocationSchema} from '../imports/extraction';
import type {SourceLocation} from '../imports/types';
import {ruleProofSchema,ruleProofsEqual} from './rule-proof';

export const ragAnswerSchema=z.object({answer:z.string().trim().min(1).max(3000)
 .refine(s=>!/(?:https?:\/\/|www\.)/i.test(s)),citationChunkIds:z.array(z.uuid()).min(1).max(5)
 .refine(ids=>new Set(ids).size===ids.length)}).strict();
export const citationEvidenceSchema=z.object({chunkId:z.uuid(),documentId:z.uuid(),documentRevision:z.number().int().min(0),title:z.string().min(1).max(500),
 familyCode:z.string(),academicYear:z.number().int().nullable(),authorityLevel:z.number().int().min(0).max(100),pageNumber:z.number().int().positive().nullable(),
 sectionTitle:z.string().max(180).nullable(),content:z.string().min(1).max(6000),sourceUrl:z.string().max(2000).nullable(),similarity:z.number().finite(),
 sourceLocations:z.array(sourceLocationSchema).max(16).optional(),ruleProof:ruleProofSchema.optional()}).strict().superRefine((value,context)=>{
 const locations=value.sourceLocations??[];
 if(Buffer.byteLength(JSON.stringify(locations),'utf8')>65536||locations.some(location=>location.kind!==locations[0].kind)||
  (locations.length>0&&(locations[0].kind==='PDF'?locations[0].pageNumber!==value.pageNumber:value.pageNumber!==null)))context.addIssue({code:'custom',message:'KNOWLEDGE_CITATION_INVALID'});
 for(const location of locations){if(location.kind==='HTML'&&location.sourceUrl!==null){try{safeSourceUrl(location.sourceUrl);}catch{context.addIssue({code:'custom',message:'KNOWLEDGE_CITATION_INVALID'});}}}
});

function invalid():never{throw new Error('KNOWLEDGE_CITATION_INVALID');}
function safeSourceUrl(source:string|null):string|null {
 if(source===null)return null;
 try{const url=new URL(source);if(url.protocol!=='https:'||url.username||url.password||url.port||/[\r\n]/.test(source))return invalid();return source;}
 catch{return invalid();}
}
function lineMessages(text:string):OutboundText[] {
 const messages:OutboundText[]=[];
 let current='';
 for(const {segment} of new Intl.Segmenter('th',{granularity:'grapheme'}).segment(text)){
  if(segment.length>5000)return invalid();
  if(current.length+segment.length>5000){messages.push({type:'text',text:current});current='';}
  current+=segment;
 }
 if(current)messages.push({type:'text',text:current});
 if(messages.length<1||messages.length>5)return invalid();
 return messages;
}
function locationLabel(location:SourceLocation):string {
 const table=location.tableIndex===null?'':` · ตาราง ${location.tableIndex}`;
 switch(location.kind){
  case 'PDF':return `PDF หน้า ${location.pageNumber} · ช่วง ${location.blockStart}–${location.blockEnd}${table}`;
  case 'DOCX':return `Word · ช่วง ${location.blockStart}–${location.blockEnd}${location.headingPath.length?` · ${location.headingPath.join(' / ')}`:''}${table}`;
  case 'XLSX':return `Excel ${location.sheetName} · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}${table}`;
  case 'CSV':return `CSV · แถว ${location.rowStart}–${location.rowEnd} · คอลัมน์ ${location.columnStart}–${location.columnEnd}${table}`;
  case 'HTML':return `HTML · ช่วง ${location.blockStart}–${location.blockEnd}${location.headingPath.length?` · ${location.headingPath.join(' / ')}`:''}${table}`;
 }
}
export function buildCitedAnswer(input:unknown,available:KnowledgeEvidence[]):{
 messages:OutboundText[];citations:Omit<KnowledgeEvidence,'content'|'similarity'>[];
} {
 const answer=ragAnswerSchema.safeParse(input);
 if(!answer.success||available.length>12)return invalid();
 const evidence=new Map<string,KnowledgeEvidence>();
 for(const item of available){const parsed=citationEvidenceSchema.safeParse(item);if(!parsed.success||evidence.has(item.chunkId))return invalid();evidence.set(item.chunkId,parsed.data);}
 const citations=answer.data.citationChunkIds.map(id=>{
  const row=evidence.get(id);if(!row)return invalid();
  // Source URLs/page numbers are selected here, never supplied by model output.
  return {chunkId:row.chunkId,documentId:row.documentId,documentRevision:row.documentRevision,title:row.title,familyCode:row.familyCode,
   academicYear:row.academicYear,authorityLevel:row.authorityLevel,pageNumber:row.pageNumber,sectionTitle:row.sectionTitle,sourceUrl:safeSourceUrl(row.sourceUrl),sourceLocations:structuredClone(row.sourceLocations??[]),...(row.ruleProof?{ruleProof:structuredClone(row.ruleProof)}:{})};
 });
 const references=citations.map((c,i)=>`${i+1}. ${c.title.replace(/[\r\n]/g,' ')}${c.academicYear===null?'':` (ปี ${c.academicYear})`}`+
  `${c.sourceLocations.length?` · ${c.sourceLocations.map(locationLabel).join(' · ').replace(/[\r\n]/g,' ')}`:c.pageNumber===null?'':` หน้า ${c.pageNumber}`}${c.sectionTitle===null?'':` · ${c.sectionTitle.replace(/[\r\n]/g,' ')}`}`+
  `${c.sourceUrl===null?'':`\n${c.sourceUrl}`}`).join('\n');
 return {messages:lineMessages(`${answer.data.answer}\n\nแหล่งอ้างอิง:\n${references}`),citations};
}

/** Run after a fresh, fenced retrieval in finalization; changes invalidate the result. */
export function evidenceStillMatches(previous:KnowledgeEvidence[],current:KnowledgeEvidence[]):boolean {
 if(previous.length<1||previous.length>12||new Set(previous.map(e=>e.chunkId)).size!==previous.length)return false;
 const candidates=new Map(current.map(e=>[e.chunkId,e]));
 return previous.every(e=>{
  const fresh=candidates.get(e.chunkId);if(!fresh)return false;
  const before=citationEvidenceSchema.safeParse(e),after=citationEvidenceSchema.safeParse(fresh);if(!before.success||!after.success)return false;
  return e.documentId===fresh.documentId&&e.documentRevision===fresh.documentRevision&&e.content===fresh.content&&e.title===fresh.title&&
   e.familyCode===fresh.familyCode&&e.academicYear===fresh.academicYear&&e.authorityLevel===fresh.authorityLevel&&
   e.pageNumber===fresh.pageNumber&&e.sectionTitle===fresh.sectionTitle&&e.sourceUrl===fresh.sourceUrl&&JSON.stringify(before.data.sourceLocations??[])===JSON.stringify(after.data.sourceLocations??[])&&
   (before.data.ruleProof===undefined&&after.data.ruleProof===undefined||ruleProofsEqual(before.data.ruleProof,after.data.ruleProof));
 });
}
