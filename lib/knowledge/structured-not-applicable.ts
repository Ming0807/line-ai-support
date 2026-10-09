import {z} from 'zod';
import type {AISnapshot} from '../ai/run-worker';
import {copyStructuredJson,freezeStructuredData,canonicalDigest} from '../imports/structured-mapping-contract';
import {publicWebTopicSchema,hasPublicTopicAnchor,requestsExactPublicInformation} from './public-web-plan';
export const structuredProcedureProposalSchema=z.object({version:z.literal(1),kind:z.literal('PROCEDURE'),topic:publicWebTopicSchema,
 quote:z.string().min(1).max(500).refine(value=>value.trim().length>0&&!/[\p{Cc}\p{Cf}]/u.test(value))}).strict();
export const structuredProcedureCertificateSchema=z.object({version:z.literal(1),kind:z.literal('PROCEDURE'),topic:publicWebTopicSchema,
 questionDigest:z.string().regex(/^[a-f0-9]{64}$/u)}).strict();
export type StructuredProcedureCertificate=z.infer<typeof structuredProcedureCertificateSchema>;
const question=z.string().min(1).max(12000).refine(value=>value.trim().length>0&&Buffer.byteLength(value,'utf8')<=12000);
const procedure=/(?:วิธี|ขั้นตอน|ทำยังไง|อย่างไร|แก้(?:ปัญหา|ไข)|\b(?:how\s+to|steps?|procedure|troubleshoot\w*|fix)\b)/iu;
const failure=/(?:(?:ต่อ|เข้า|ใช้งาน|เชื่อมต่อ).{0,15}(?:ไม่ได้|ไม่สำเร็จ)|error\s*500|\b(?:failed|cannot|can't|not\s+working)\b)/iu;
const digest=(text:string)=>canonicalDigest('structured-procedure-question-v1',text);
function procedural(topic:StructuredProcedureCertificate['topic'],text:string):boolean{
 return hasPublicTopicAnchor(topic,text)&&!requestsExactPublicInformation(text)&&(procedure.test(text)||
  ['WIFI_ACCESS','REGISTRATION','LIBRARY_SERVICES'].includes(topic)&&failure.test(text));
}
/** Pure semantic proposal check. Actor/source ownership remains the caller's responsibility. */
export function validateStructuredProcedure(input:unknown,userText:unknown):StructuredProcedureCertificate{
 try{
  const proposal=structuredProcedureProposalSchema.parse(copyStructuredJson(input,4096,64)),text=question.parse(userText);
  if(!text.includes(proposal.quote)||!procedural(proposal.topic,proposal.quote)||!procedural(proposal.topic,text))throw new Error();
  return freezeStructuredData({version:1,kind:'PROCEDURE',topic:proposal.topic,questionDigest:digest(text)});
 }catch{throw new Error('STRUCTURED_PROCEDURE_INVALID');}
}
/** No certificate can turn an assistant summary/arbitrary assembled question into source authority. */
export function structuredProcedureApplies(input:unknown,snapshot:AISnapshot):boolean{
 try{
  const certificate=structuredProcedureCertificateSchema.parse(copyStructuredJson(input,4096,64));
  const source=z.object({question,history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(3000)}).strict()).max(8)})
   .parse(copyStructuredJson(snapshot,128*1024,6000));
  const texts=[source.question,...source.history.filter(item=>item.role==='user').flatMap(item=>
   [`${item.content}\n${source.question}`,`${item.content.slice(0,1000)}\n${source.question}`])];
  return texts.some(text=>question.safeParse(text).success&&digest(text)===certificate.questionDigest&&procedural(certificate.topic,text));
 }catch{return false;}
}
