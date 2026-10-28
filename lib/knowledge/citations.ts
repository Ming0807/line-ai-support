import {z} from 'zod';
import type {OutboundText} from '../queue/outbox';
import type {KnowledgeEvidence} from './types';
import {sourceLocationSchema} from '../imports/extraction';
import type {SourceLocation} from '../imports/types';
import {ruleProofSchema,ruleProofsEqual} from './rule-proof';

export const LINE_TEXT_PACKET_LIMIT_MESSAGE='คำตอบพร้อมแหล่งอ้างอิงยาวเกินขนาดที่ส่งครบใน LINE ได้ในครั้งเดียวครับ กรุณาแยกคำถามเป็นประเด็น หรือเลือกติดต่อเจ้าหน้าที่เพื่อให้ช่วยตรวจสอบครับ';

// Transport shape is not link authority: buildCitedAnswer binds all proposed
// links to the exact cited reviewed evidence before any answer can be delivered.
export const ragAnswerSchema=z.object({answer:z.string().min(1).max(12000).refine(value=>value.trim().length>0),citationChunkIds:z.array(z.uuid()).min(1).max(5)
 .refine(ids=>new Set(ids).size===ids.length)}).strict();
/** Completion-only abstention. Every actual ANSWER still uses the unchanged schema above. */
export const ragCompletionSchema=z.strictObject({answer:ragAnswerSchema.shape.answer.nullable(),
 citationChunkIds:z.array(z.uuid()).max(5),
}).refine(value=>value.answer===null?value.citationChunkIds.length===0:ragAnswerSchema.safeParse(value).success);
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
 try{const url=new URL(source);if(url.protocol!=='https:'||!safeHttpLink(source,false))return invalid();return source;}
 catch{return invalid();}
}
function linkMatches(text:string):RegExpStringIterator<RegExpExecArray>{
 return text.matchAll(/[a-z][a-z0-9+.-]*:(?=\S)[^\s<>"`]+|(?:www\.|\/\/)[^\s<>"`]+|(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}][\p{L}\p{N}-]{0,62}\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?![\p{L}\p{N}-])(?:[/:?#][^\s<>"`]+)?/giu);
}
function proposedLinkTokens(text:string):string[]{
 return [...linkMatches(text)]
  .map(match=>match[0].replace(/[)\]},;.!?]+$/u,''));
}
function safeHttpLink(source:string,yruOnly:boolean):boolean{
 try{
  if(source.length>2000||!/^https?:\/\//iu.test(source))return false;
  const url=new URL(source),authority=source.match(/^https?:\/\/([^/?#]+)/iu)?.[1];
  if(!authority||/[:@\\]/u.test(authority)||url.username||url.password||url.port||
   yruOnly&&!(url.hostname.toLowerCase()==='yru.ac.th'||url.hostname.toLowerCase().endsWith('.yru.ac.th')))return false;
  let decoded=source;
  for(let count=0;count<3;count++){
   if(/[\u0000-\u001f\u007f]/u.test(decoded))return false;
   const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;
  }
  return decodeURIComponent(decoded)===decoded&&!/[\u0000-\u001f\u007f]/u.test(decoded);
 }catch{return false;}
}
/** No model URL is fetched. Only a cited source can authorize its exact token. */
function assertCitedLinks(answer:string,cited:KnowledgeEvidence[]):void{
 const proposed=proposedLinkTokens(answer);if(proposed.length>20)return invalid();
 if(JSON.stringify(proposed)!==JSON.stringify(proposedLinkTokens(answer.normalize('NFKC'))))return invalid();
 for(const link of proposed){
  const matched=cited.some(row=>{
   if(row.sourceUrl===link)return safeSourceUrl(row.sourceUrl)!==null;
   const bare=!/[:@\\]/u.test(link)&&!link.startsWith('//')&&safeHttpLink('https://'+link,true);
   return (safeHttpLink(link,true)||bare)&&proposedLinkTokens(row.content).includes(link);
  });
  if(!matched)return invalid();
 }
}
export function lineMessages(text:string):OutboundText[] {
 const messages:OutboundText[]=[];
 let current='';
 const append=(segment:string)=>{
  if(segment.length>5000)throw new Error('LINE_TEXT_PACKET_TOO_LARGE');
  if(current.length+segment.length>5000){
   if(messages.length>=5)throw new Error('LINE_TEXT_PACKET_TOO_LARGE');
   messages.push({type:'text',text:current});current='';
  }
  current+=segment;
  if(messages.length>=5)throw new Error('LINE_TEXT_PACKET_TOO_LARGE');
 };
 const plain=(value:string)=>{for(const {segment} of new Intl.Segmenter('th',{granularity:'grapheme'}).segment(value))append(segment);};
 let offset=0;
 for(const match of linkMatches(text)){
  plain(text.slice(offset,match.index));append(match[0]);offset=match.index+match[0].length;
 }
 plain(text.slice(offset));
 if(current){
  if(messages.length>=5)throw new Error('LINE_TEXT_PACKET_TOO_LARGE');
  messages.push({type:'text',text:current});
 }
 if(messages.length<1)return invalid();
 return messages;
}
export function locationLabel(location:SourceLocation):string {
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
 const cited=answer.data.citationChunkIds.map(id=>{const row=evidence.get(id);if(!row)return invalid();return row;});
 assertCitedLinks(answer.data.answer,cited);
 const citations=answer.data.citationChunkIds.map(id=>{
  const row=evidence.get(id);if(!row)return invalid();
  // Source URLs/page numbers are selected here, never supplied by model output.
  return {chunkId:row.chunkId,documentId:row.documentId,documentRevision:row.documentRevision,title:row.title,familyCode:row.familyCode,
   academicYear:row.academicYear,authorityLevel:row.authorityLevel,pageNumber:row.pageNumber,sectionTitle:row.sectionTitle,sourceUrl:safeSourceUrl(row.sourceUrl),sourceLocations:structuredClone(row.sourceLocations??[]),...(row.ruleProof?{ruleProof:structuredClone(row.ruleProof)}:{})};
 });
 const displayed=new Set<string>(),references:string[]=[];
 for(const c of citations){
  let label=`${c.title.replace(/[\r\n]/g,' ')}${c.academicYear===null?'':` (ปี ${c.academicYear})`}`;
  const html=c.sourceLocations.length>0&&c.sourceLocations.every(location=>location.kind==='HTML');
  if(html){
   const normalize=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('th');
   const seen=new Set([normalize(c.title)]),parts:string[]=[];
   const add=(value:string)=>{const clean=value.replace(/[\r\n]/g,' ').trim(),key=normalize(clean);if(clean&&!seen.has(key)){seen.add(key);parts.push(clean);}};
   for(const location of c.sourceLocations)if(location.kind==='HTML'){
    for(const heading of location.headingPath)add(heading);
    if(location.tableIndex!==null)add(`ตาราง ${location.tableIndex}`);
   }
   if(c.sectionTitle!==null)add(c.sectionTitle);
   if(parts.length)label+=' · '+parts.join(' · ');
  }else label+=`${c.sourceLocations.length?` · ${c.sourceLocations.map(locationLabel).join(' · ').replace(/[\r\n]/g,' ')}`:c.pageNumber===null?'':` หน้า ${c.pageNumber}`}${c.sectionTitle===null?'':` · ${c.sectionTitle.replace(/[\r\n]/g,' ')}`}`;
  if(c.sourceUrl!==null)label+='\n'+c.sourceUrl;
  const key=JSON.stringify([c.documentId,c.documentRevision,label]);
  if(html&&displayed.has(key))continue;
  displayed.add(key);references.push(`${references.length+1}. ${label}`);
 }
 return {messages:lineMessages(`${answer.data.answer}\n\nแหล่งอ้างอิง:\n${references.join('\n')}`),citations};
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
