import {isIP} from 'node:net';
import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {internalMissProofSchema,internalMissStillApplies} from './internal-miss';
import {publicWebPlanSchema,generalWebPlanSchema,type PublicWebPlan,type GeneralWebPlan} from './public-web-plan';
import {officialWebMissSchema,officialWebMissStillApplies} from './official-web-miss';
import {buildPublicSearchQuery} from './public-search-query';
import type {OutboundText} from '../queue/outbox';
import type {PoolClient} from 'pg';
import type {AISnapshot} from '../ai/run-worker';

const instant=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
 .refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);
const title=z.string().min(1).max(500).refine(value=>value.trim()===value&&!/[\p{Cc}\p{Cf}]/u.test(value));
const leadSchema=z.object({title,url:z.string().min(1).max(2048)}).strict();
function safeUrl(value:string,plan:PublicWebPlan|GeneralWebPlan):boolean{
 try{
  if(/[\s\\\p{Cc}\p{Cf}]/u.test(value)||/%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)||value.includes('#'))return false;
  const url=new URL(value),host=url.hostname,query=buildPublicSearchQuery(plan);
  if(url.href!==value||url.protocol!=='https:'||url.username||url.password||url.port||isIP(host)!==0||host.length>253||
   host.split('.').length<2||host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))||
   (plan.purpose==='YRU_INFORMATION'?!query.includeDomains.some(domain=>host===domain||host.endsWith(`.${domain}`)):
    /(?:^|\.)(?:local|localhost|invalid|test|example)$/u.test(host)))return false;
  for(const name of url.searchParams.keys())if(/token|secret|password|credential|authorization|signature|apikey|^(?:sid|session|sessionid|auth|cookie|key|accesskey|clientkey|keypairid)$/iu.test(name.replaceAll(/[-_]/gu,'')))return false;
  return true;
 }catch{return false;}
}
export const webLeadsResultSchema=z.object({kind:z.literal('WEB_LEADS'),plan:z.union([publicWebPlanSchema,generalWebPlanSchema]),
 leads:z.array(leadSchema).min(1).max(3),observedAt:instant,expiresAt:instant,internalMiss:internalMissProofSchema,officialMiss:officialWebMissSchema.optional()}).strict().refine(value=>{
 try{
  const observed=Date.parse(value.observedAt),expiry=Date.parse(value.expiresAt),miss=value.officialMiss;
  const validPurpose=value.plan.purpose==='YRU_INFORMATION'?miss===undefined&&expiry-observed===300000&&value.plan.academicYear===value.internalMiss.scope.academicYear:
   !!miss&&miss.sourceDigest===value.internalMiss.sourceDigest&&miss.internalSignature===value.internalMiss.signature&&miss.plan.academicYear===value.internalMiss.scope.academicYear&&
   observed>=Date.parse(miss.observedAt)&&expiry>observed&&expiry===Math.min(observed+300000,Date.parse(miss.expiresAt))&&
   (value.plan.topic==='GENERAL_HTTP_500'?miss.plan.topic==='REGISTRATION':miss.plan.topic==='WIFI_ACCESS');
  return validPurpose&&new Set(value.leads.map(lead=>lead.url)).size===value.leads.length&&value.leads.every(lead=>safeUrl(lead.url,value.plan))&&!!buildPublicSearchQuery(value.plan);}
 catch{return false;}
});
export type WebLeadsResult=z.infer<typeof webLeadsResultSchema>;
function parseBase(input:unknown):WebLeadsResult{
 // Explicit allowlist projection drops unrelated private envelope metadata such as Support.
 return webLeadsResultSchema.strip().parse(copyStructuredJson(input,128*1024,3000));
}

/** Drop search snippets/score/request ID before persistence. This does not authenticate the private miss receipt. */
export function createWebLeads(plan:unknown,candidates:unknown,internalMiss:unknown,observedAt:unknown,officialMiss?:unknown):WebLeadsResult{
 try{
  const references=z.array(z.object({title:z.string().min(1).max(500),url:z.string().min(1).max(2048)})).min(1).max(3)
   .parse(copyStructuredJson(candidates,64*1024,2000)).map(lead=>({...lead,title:lead.title.replace(/\s+/gu,' ').trim()}));
  const stamp=instant.parse(observedAt),miss=officialMiss===undefined?undefined:officialWebMissSchema.parse(copyStructuredJson(officialMiss,8192,128));
  return freezeStructuredData(webLeadsResultSchema.parse(copyStructuredJson({kind:'WEB_LEADS',plan,leads:references,
   observedAt:stamp,expiresAt:new Date(Math.min(Date.parse(stamp)+300000,miss?Date.parse(miss.expiresAt):Infinity)).toISOString(),internalMiss,...(miss?{officialMiss:miss}:{})},128*1024,3000)));
 }catch{throw new Error('WEB_LEADS_INVALID');}
}

/** Time check only; production callers must separately verify source/actor/lease/receipt. */
export function webLeadsStillFresh(input:unknown,now:Date):boolean{
 try{const value=parseBase(input),time=now.getTime();return Number.isFinite(time)&&time>=Date.parse(value.observedAt)&&time<Date.parse(value.expiresAt);}
 catch{return false;}
}
/** Caller owns fresh source/actor authorization and the catalog fence on this transaction. */
export async function verifyWebLeads(client:PoolClient,input:unknown,source:AISnapshot,key:string):Promise<boolean>{
 try{
  const value=parseBase(input),now=(await client.query('select clock_timestamp() observed_at')).rows[0]?.observed_at;
  if(!(now instanceof Date)||!webLeadsStillFresh(value,now)||!await internalMissStillApplies(client,value.internalMiss,source,key))return false;
  if(value.plan.purpose==='GENERAL_PUBLIC'&&!await officialWebMissStillApplies(client,value.officialMiss,value.internalMiss,source,key))return false;
  const after=(await client.query('select clock_timestamp() observed_at')).rows[0]?.observed_at;
  return after instanceof Date&&webLeadsStillFresh(value,after);
 }catch{return false;}
}
export function buildWebLeadReply(input:unknown):{messages:OutboundText[];citations:{type:'WEB_LEAD';title:string;url:string;verification:'NOT_VERIFIED';observedAt:string}[]}{
 try{
  const result=parseBase(input);
  const messages:OutboundText[]=[{type:'text',text:result.plan.purpose==='GENERAL_PUBLIC'?
   'ยังไม่พบคำตอบที่ยืนยันได้จากฐานความรู้และผลค้นเว็บไซต์มหาวิทยาลัยครับ ลิงก์ต่อไปนี้เป็นข้อมูลทั่วไปสำหรับแก้ปัญหา ยังไม่ได้ยืนยันความถูกต้องหรือการใช้กับกรณีของคุณ ข้อมูลนี้ไม่ยืนยันระเบียบ สิทธิ หรือสถานะระบบของมหาวิทยาลัย กรุณาตรวจแหล่งต้นทางหรือติดต่อเจ้าหน้าที่ก่อนนำไปใช้':
   'ยังไม่พบคำตอบที่ยืนยันได้จากฐานความรู้ครับ ลิงก์ต่อไปนี้เป็นผลค้นจากเว็บไซต์มหาวิทยาลัยที่อาจเกี่ยวข้อง ยังไม่ได้ยืนยันความถูกต้อง ความเป็นปัจจุบัน หรือการใช้กับกรณีของคุณ กรุณาตรวจเอกสารต้นทางหรือติดต่อเจ้าหน้าที่ก่อนนำไปใช้'},
   ...result.leads.map((lead,i)=>({type:'text' as const,text:`[${i+1}] ${lead.title}\n${lead.url}`}))];
  return {messages,citations:result.leads.map(lead=>({type:'WEB_LEAD',...lead,verification:'NOT_VERIFIED',observedAt:result.observedAt}))};
 }catch{throw new Error('WEB_LEADS_INVALID');}
}
