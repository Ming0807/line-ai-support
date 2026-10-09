import {z} from 'zod';
import {routerOutputSchema} from './schemas';
const factFields=['PROBLEM','DEVICE','ERROR','PREVIOUS_CONNECTION','LOCATION','ATTEMPTS','IMPACT','SENSITIVE_DETAIL'] as const;
const missingFields=['DEVICE','ERROR','PREVIOUS_CONNECTION','LOCATION','ATTEMPTS'] as const;
const sensitivity=z.enum(['GENERAL','SENSITIVE','RESTRICTED']);
const sourceCode=z.string().regex(/^U[0-8]$/u);
export const supportFactSchema=z.strictObject({field:z.enum(factFields),source:sourceCode,quote:z.string().min(1).max(1000).refine(value=>value.trim().length>0)});
export const supportProposalSchema=routerOutputSchema.extend({
 intent:z.enum(['INFORMATION','TROUBLESHOOT','PERSONAL_CASE','ESCALATE','SOLVED','OTHER']),
 subcategory:z.enum(['NETWORK_ACCESS','SYSTEM_ACCESS','DEVICE','PAYMENT','COURSE_REGISTRATION','SERVICE']).nullable(),
 missingContext:z.enum(missingFields).nullable(),impact:z.enum(['SINGLE_USER','MULTIPLE_USERS','UNIVERSITY_WIDE']),
 sensitivity,facts:z.array(supportFactSchema).max(8),
}).refine(value=>value.needsTicket===['PERSONAL_CASE','ESCALATE'].includes(value.intent))
 .refine(value=>value.intent==='TROUBLESHOOT'||value.missingContext===null);
export type SupportProposal=z.infer<typeof supportProposalSchema>;
export type SupportFact=z.infer<typeof supportFactSchema>;
export type SupportSensitivity=z.infer<typeof sensitivity>;
/** Private durable metadata added by the backend, never supplied as action authority by a model. */
export const supportMetadataSchema=z.strictObject({version:z.literal(1),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/u),
 directoryDigest:z.string().regex(/^[a-f0-9]{64}$/u),minimumSensitivity:sensitivity,deliveredGuidance:z.boolean(),proposal:supportProposalSchema});
export type SupportMetadata=z.infer<typeof supportMetadataSchema>;
export interface SupportSnapshot {question:string;history:{role:string;content:string}[];deliveredGuidance?:boolean}
export interface SupportDepartment {code:string;name:string}
const departmentSchema=z.strictObject({code:z.string().regex(/^[A-Z_]{2,40}$/u),name:z.string().min(1).max(200)});
export const supportInputSchema=z.strictObject({sources:z.array(z.strictObject({code:sourceCode,text:z.string().min(1).max(2000)})).min(1).max(9),
 departments:z.array(departmentSchema).min(1).max(32),deliveredGuidance:z.boolean()})
 .refine(value=>value.sources[0].code==='U0'&&new Set(value.sources.map(s=>s.code)).size===value.sources.length&&new Set(value.departments.map(d=>d.code)).size===value.departments.length);
export type SupportInput=z.infer<typeof supportInputSchema>;
const clip=(value:string,max:number)=>value.slice(0,max).replace(/[\uD800-\uDBFF]$/u,'');
export function projectSupportInput(snapshot:SupportSnapshot,departments:SupportDepartment[]):SupportInput {
 if(typeof snapshot.question!=='string'||!snapshot.question.trim()||snapshot.question.length>2000||Buffer.byteLength(snapshot.question,'utf8')>6000||!Array.isArray(snapshot.history))throw new Error('SUPPORT_INPUT_INVALID');
 const sources=[{code:'U0',text:snapshot.question},...snapshot.history.filter(message=>message.role==='user'&&typeof message.content==='string'&&message.content.trim()).slice(-8).map((message,index)=>({code:`U${index+1}`,text:clip(message.content,1000)}))];
 const parsed=supportInputSchema.safeParse({sources,departments:departments.map(d=>({code:d.code,name:d.name})),deliveredGuidance:snapshot.deliveredGuidance===true});
 if(!parsed.success||Buffer.byteLength(JSON.stringify(parsed.data),'utf8')>40000)throw new Error('SUPPORT_INPUT_INVALID');return parsed.data;
}
const categories:Record<string,string>={IT:'IT_SUPPORT',REGISTRAR:'REGISTRATION',STUDENT_AFFAIRS:'STUDENT_AFFAIRS',LIBRARY:'LIBRARY',DORMITORY:'DORMITORY',FINANCE:'FINANCE',ACADEMIC_AFFAIRS:'ACADEMIC',FACILITY:'FACILITY',ADMIN:'GENERAL'};
export function supportCategoryForDepartment(code:string){return categories[code]??'GENERAL';}
const questions:Record<typeof missingFields[number],string>={DEVICE:'ใช้อุปกรณ์อะไร และระบบปฏิบัติการใดครับ',ERROR:'มีข้อความผิดพลาดอะไรปรากฏขึ้นครับ',PREVIOUS_CONNECTION:'เคยเชื่อมต่อ Wi-Fi หรือระบบนี้ได้มาก่อนหรือไม่ครับ',LOCATION:'พบปัญหาที่อาคารหรือบริเวณใดครับ',ATTEMPTS:'ลองแก้ไขด้วยวิธีใดไปแล้วบ้างครับ'};
const ranks:Record<SupportSensitivity,number>={GENERAL:0,SENSITIVE:1,RESTRICTED:2};
/** A conservative reported-impact rule, never a department or conversation keyword router. */
function reportedMultiple(quote:string):boolean {
 if(/ไม่(?:ใช่|มี|ได้เกิดกับ)|not\s+(?:many|multiple|all)/iu.test(quote))return false;
 if(/หลาย(?:คน|เครื่อง|ราย)|ทุกคน|ทั้งมหาวิทยาลัย|(?:multiple|many)\s+(?:users|people|devices)|university[ -]wide/iu.test(quote))return true;
 const count=/(?:ผู้ใช้|นักศึกษา|อุปกรณ์)\s*(\d{1,6})\s*(?:คน|ราย|เครื่อง)|\b(\d{1,6})\s+(?:users|people|devices)\b/iu.exec(quote);
 return count!==null&&Number(count[1]??count[2])>=2;
}
export interface InterpretedSupport {
 intent:SupportProposal['intent'];category:string;subcategory:SupportProposal['subcategory'];departmentCode:string|null;
 needsTicket:boolean;needsKnowledgeSearch:boolean;needsStructuredSearch:boolean;needsWebSearch:boolean;
 priority:'LOW'|'MEDIUM'|'HIGH';severity:'NORMAL'|'ELEVATED';sensitiveLevel:SupportSensitivity;
 collectedContext:SupportFact[];problemText:string|null;clarification:string|null;searchText:string|null;suggestSolved:boolean;
}
/** An interpretation is advice only: it contains no identity, action token, SQL or mutation authority. */
export function interpretSupportProposal(value:unknown,input:SupportInput,minimum:SupportSensitivity='GENERAL'):InterpretedSupport|null {
 const proposed=supportProposalSchema.safeParse(value),context=supportInputSchema.safeParse(input);
 if(!proposed.success||!context.success||proposed.data.confidence<.8||!sensitivity.safeParse(minimum).success)return null;
 const p=proposed.data,c=context.data,seen=new Set<string>();
 for(const fact of p.facts){const source=c.sources.find(s=>s.code===fact.source);if(!source||!source.text.includes(fact.quote)||seen.has(fact.field))return null;seen.add(fact.field);}
 const departmentCode=p.department==='REGISTRATION'?'REGISTRAR':p.department;
 if(departmentCode!==null&&!c.departments.some(d=>d.code===departmentCode))return null;
 const category=departmentCode===null?'GENERAL':supportCategoryForDepartment(departmentCode);if(p.category!==category)return null;
 if(p.subcategory==='NETWORK_ACCESS'||p.subcategory==='DEVICE'){if(departmentCode!=='IT')return null;}
 if(p.subcategory==='PAYMENT'&&departmentCode!=='FINANCE'||p.subcategory==='COURSE_REGISTRATION'&&departmentCode!=='REGISTRAR')return null;
 if(p.sensitivity==='RESTRICTED'&&!seen.has('SENSITIVE_DETAIL'))return null;
 let sensitiveLevel=p.sensitivity;if(p.intent==='PERSONAL_CASE'&&ranks[sensitiveLevel]<ranks.SENSITIVE)sensitiveLevel='SENSITIVE';
 if(ranks[minimum]>ranks[sensitiveLevel])sensitiveLevel=minimum;
 const impact=p.facts.find(f=>f.field==='IMPACT');const multi=p.impact!=='SINGLE_USER'&&impact!==undefined&&reportedMultiple(impact.quote);
 const problem=p.facts.find(f=>f.field==='PROBLEM')?.quote??null;
 let clarification:string|null=null,searchText:string|null=null;
 if(p.intent==='TROUBLESHOOT'){
  if(!problem)clarification='ช่วยบอกปัญหาที่ต้องการแก้เพิ่มเติมอีกนิดครับ';
  else if(p.missingContext!==null&&!seen.has(p.missingContext))clarification=questions[p.missingContext];
 }
 if(p.intent==='PERSONAL_CASE')clarification='ผมยังเข้าถึงข้อมูลส่วนบุคคลหรือข้อมูลเฉพาะบัญชีของคุณไม่ได้ครับ สามารถรวบรวมรายละเอียดแล้วส่งให้เจ้าหน้าที่ตรวจสอบได้';
 if(p.intent==='OTHER')clarification='ช่วยอธิบายปัญหาหรือคำถามที่ต้องการให้ช่วยอีกนิดครับ';
 if(!clarification&&['INFORMATION','TROUBLESHOOT'].includes(p.intent)){
  searchText=[problem??c.sources[0].text,...p.facts.filter(f=>['DEVICE','ERROR','LOCATION'].includes(f.field)).map(f=>f.quote)].join('\n');
  if(searchText.length>2000||Buffer.byteLength(searchText,'utf8')>6000){searchText=null;clarification='ช่วยสรุปปัญหาและข้อความผิดพลาดให้สั้นลงอีกนิดครับ';}
 }
 return {intent:p.intent,category,subcategory:p.subcategory,departmentCode,needsTicket:p.needsTicket,
  needsKnowledgeSearch:p.needsKnowledgeSearch,needsStructuredSearch:p.needsStructuredSearch,needsWebSearch:p.needsWebSearch,
  priority:multi?'HIGH':p.intent==='INFORMATION'?'LOW':'MEDIUM',severity:multi?'ELEVATED':'NORMAL',sensitiveLevel,
  collectedContext:p.facts.map(f=>({...f})),problemText:problem,clarification,searchText,suggestSolved:p.intent==='SOLVED'&&c.deliveredGuidance};
}
