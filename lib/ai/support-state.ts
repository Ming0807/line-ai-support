import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {DbClient} from '../tickets/authorization';
import {lockConversation} from '../tickets/authorization';
import {encryptValue,decryptValue} from '../security/identity';
import {decodeAIResult,lockedAIJob,type AIJob} from './jobs';
import {buildCitedAnswer} from '../knowledge/citations';
import {buildStructuredAnswer} from '../knowledge/structured-citations';
import {projectSupportInput,interpretSupportProposal,supportProposalSchema,type SupportInput,type SupportSensitivity,type InterpretedSupport} from './support-contracts';
const contextSchema=z.strictObject({sessionId:z.uuid(),conversationId:z.uuid(),messageId:z.uuid(),revision:z.number().int().nonnegative()});
export type SupportContext=z.infer<typeof contextSchema>;
export interface SupportStateSnapshot {context:SupportContext;input:SupportInput;sourceDigest:string;directoryDigest:string;minimumSensitivity:SupportSensitivity}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=z.string().regex(/^[a-f0-9]{64}$/u),risk=z.enum(['GENERAL','SENSITIVE','RESTRICTED']);
const envelopeSchema=z.strictObject({version:z.literal(1),context:contextSchema,aiJobId:z.uuid(),sourceDigest:hex,directoryDigest:hex,
 minimumSensitivity:risk,deliveredGuidance:z.boolean(),proposal:supportProposalSchema,
 interpreted:z.object({sensitiveLevel:risk}).passthrough(),departmentId:z.uuid().nullable(),guidanceOutboxId:z.uuid().nullable()});
function stateEnvelope(row:Record<string,unknown>,key:string){
 try{const raw=JSON.parse(decryptValue(String(row.context_encrypted),key)),parsed=envelopeSchema.safeParse(raw);if(!parsed.success)return null;const p=parsed.data;
  if(digest(raw)!==row.state_digest||p.context.conversationId!==row.conversation_id||p.context.sessionId!==row.line_session_id||p.context.messageId!==row.last_message_id||
   p.context.revision!==row.conversation_revision||p.aiJobId!==row.ai_job_id||p.sourceDigest!==row.source_digest||p.directoryDigest!==row.directory_digest||
   p.guidanceOutboxId!==row.guidance_outbox_id||p.departmentId!==row.department_id||p.interpreted.sensitiveLevel!==row.sensitive_level)return null;return p;
 }catch{return null;}
}
/** Validated canonical prior delivery; never treat a clarification or changed-evidence message as guidance. */
async function guidanceMatches(client:DbClient,id:string,context:SupportContext,key:string,options:{mustBeSent:boolean;jobId?:string}):Promise<boolean>{
 const row=(await client.query(`select j.*,o.status outbox_status,o.payload_encrypted outbox_payload from private.message_outbox o
  join private.ai_jobs j on o.idempotency_key='ai-job:'||j.id::text
  where o.id=$1 and o.channel='STUDENT' and o.kind='AI' and o.line_session_id=$2 and o.conversation_id=$3
   and o.expected_conversation_revision=$4 and j.line_session_id=$2 and j.conversation_id=$3 and j.expected_conversation_revision=$4
   and j.status in('PROCESSING','DONE') and o.status not in('SUPPRESSED','DEAD')`,[id,context.sessionId,context.conversationId,context.revision])).rows[0];
 if(!row||options.mustBeSent&&(row.outbox_status!=='SENT'||row.status!=='DONE'||row.last_error_code!==null)||
  !options.mustBeSent&&(row.status!=='PROCESSING'||row.id!==options.jobId)||options.jobId&&row.id!==options.jobId)return false;
 try{
  const result=decodeAIResult(row,key);if(!result||result.kind==='CLARIFY')return false;
  const expected=result.kind==='ANSWER'?buildCitedAnswer(result.output,result.evidence):buildStructuredAnswer(result.output,result.evidence);
  const payload=JSON.parse(decryptValue(row.outbox_payload,key));
  if(!Array.isArray(payload.messages)||JSON.stringify(payload.messages.map((m:{text?:unknown})=>m.text))!==JSON.stringify(expected.messages.map(m=>m.text)))return false;
  return (await client.query(`select id from public.messages where conversation_id=$1 and sender_type='AI' and message_type='TEXT'
   and metadata->>'ai_job_id'=$2 and metadata->'citations'=$3::jsonb and content=$4`,[context.conversationId,row.id,JSON.stringify(expected.citations),expected.messages.map(m=>m.text).join('\n')])).rowCount===1;
 }catch{return false;}
}
/** Caller owns a short transaction. Private identifiers stay out of input, the provider projection. */
export async function loadSupportSnapshot(client:DbClient,value:SupportContext,key:string):Promise<SupportStateSnapshot|null>{
 const parsed=contextSchema.safeParse(value);if(!parsed.success)return null;const context=parsed.data;
 await lockConversation(client,context.conversationId);
 const allowed=(await client.query(`select c.id from public.conversations c join public.line_sessions s on s.id=c.line_session_id and s.active
  join public.messages m on m.conversation_id=c.id and m.id=$3 and m.sender_type='USER' and m.message_type='TEXT'
  where c.id=$1 and c.line_session_id=$2 and c.revision=$4 and c.mode='AI' and c.status in('ACTIVE','WAITING')
  and not exists(select 1 from public.tickets t where t.conversation_id=c.id and t.mode='HUMAN' and t.status not in('CLOSED','CANCELLED'))`,[context.conversationId,context.sessionId,context.messageId,context.revision])).rowCount===1;
 if(!allowed)return null;
 const messages=(await client.query(`select id,content,created_at from public.messages where conversation_id=$1 and sender_type='USER' and message_type='TEXT'
  and metadata->>'routing_status' is distinct from 'PENDING' order by created_at desc,id desc limit 9`,[context.conversationId])).rows;
 if(messages[0]?.id!==context.messageId)return null;
 const departments=(await client.query('select id,code,name_th from public.departments where active order by code,id for share')).rows;
 const state=(await client.query('select * from private.ai_support_state where conversation_id=$1',[context.conversationId])).rows[0];
 if(state&&!stateEnvelope(state,key))return null;
 const minimum=z.enum(['GENERAL','SENSITIVE','RESTRICTED']).safeParse(state?.sensitive_level??'GENERAL');if(!minimum.success)return null;
 let input:SupportInput;try{input=projectSupportInput({question:messages[0].content,history:messages.slice(1).reverse().map(m=>({role:'user',content:m.content})),
  deliveredGuidance:state?.guidance_outbox_id?await guidanceMatches(client,state.guidance_outbox_id,context,key,{mustBeSent:true}):false},departments.map(d=>({code:d.code,name:d.name_th})));}catch{return null;}
 return {context,input,minimumSensitivity:minimum.data,sourceDigest:digest({sessionId:context.sessionId,conversationId:context.conversationId,messages:messages.map(m=>({id:m.id,content:m.content,createdAt:m.created_at.toISOString()}))}),
  directoryDigest:digest(departments.map(d=>({id:d.id,code:d.code,name:d.name_th})))};
}
/** Only a root-owned finalization may call this; it grants no action/transition/delivery authority. */
export async function saveSupportState(client:DbClient,job:AIJob,expected:SupportStateSnapshot,proposal:unknown,key:string,options:{guidanceOutboxId?:string}={}):Promise<{stateDigest:string;interpreted:InterpretedSupport}>{
 await lockConversation(client,job.conversation_id);const current=await lockedAIJob(client,job);
 if(current.line_session_id!==job.line_session_id||current.conversation_id!==job.conversation_id||current.message_id!==job.message_id||
  current.expected_conversation_revision!==job.expected_conversation_revision||expected.context.sessionId!==current.line_session_id||
  expected.context.conversationId!==current.conversation_id||expected.context.messageId!==current.message_id||expected.context.revision!==current.expected_conversation_revision)throw new Error('SUPPORT_CONTEXT_CHANGED');
 const fresh=await loadSupportSnapshot(client,expected.context,key);
 if(!fresh||fresh.sourceDigest!==expected.sourceDigest||fresh.directoryDigest!==expected.directoryDigest)throw new Error('SUPPORT_CONTEXT_CHANGED');
 const parsed=supportProposalSchema.safeParse(proposal);if(!parsed.success)throw new Error('SUPPORT_PROPOSAL_INVALID');
 const existing=(await client.query('select * from private.ai_support_state where conversation_id=$1 for update',[current.conversation_id])).rows[0];
 if(existing?.ai_job_id===current.id){
  const payload=stateEnvelope(existing,key);if(!payload)throw new Error('SUPPORT_STATE_INVALID');
  if(payload.sourceDigest!==fresh.sourceDigest||payload.directoryDigest!==fresh.directoryDigest||
   JSON.stringify(payload.context)!==JSON.stringify(fresh.context)||JSON.stringify(payload.proposal)!==JSON.stringify(parsed.data)||
   options.guidanceOutboxId!==undefined&&options.guidanceOutboxId!==existing.guidance_outbox_id)throw new Error('SUPPORT_CONTEXT_CHANGED');
  const interpreted=interpretSupportProposal(payload.proposal,{...fresh.input,deliveredGuidance:payload.deliveredGuidance},payload.minimumSensitivity);
  if(!interpreted||interpreted.sensitiveLevel!==existing.sensitive_level)throw new Error('SUPPORT_STATE_INVALID');
  if(!(await client.query("select id from private.ai_jobs where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()",[current.id,current.lease_token])).rowCount)throw new Error('AI_JOB_LEASE_LOST');
  return {stateDigest:existing.state_digest,interpreted};
 }
 if(fresh.minimumSensitivity!==expected.minimumSensitivity||fresh.input.deliveredGuidance!==expected.input.deliveredGuidance)throw new Error('SUPPORT_CONTEXT_CHANGED');
 const interpreted=interpretSupportProposal(parsed.data,fresh.input,fresh.minimumSensitivity);if(!interpreted)throw new Error('SUPPORT_PROPOSAL_INVALID');
 const guidanceId=options.guidanceOutboxId??existing?.guidance_outbox_id??null;
 if(options.guidanceOutboxId&&(!z.uuid().safeParse(options.guidanceOutboxId).success||!await guidanceMatches(client,options.guidanceOutboxId,fresh.context,key,{mustBeSent:false,jobId:current.id})))throw new Error('SUPPORT_GUIDANCE_INVALID');
 const department=interpreted.departmentCode===null?null:(await client.query('select id from public.departments where code=$1 and active for share',[interpreted.departmentCode])).rows[0];
 if(interpreted.departmentCode!==null&&!department)throw new Error('SUPPORT_CONTEXT_CHANGED');
 const payload={version:1,context:fresh.context,aiJobId:current.id,sourceDigest:fresh.sourceDigest,directoryDigest:fresh.directoryDigest,
  minimumSensitivity:fresh.minimumSensitivity,deliveredGuidance:fresh.input.deliveredGuidance,proposal:parsed.data,interpreted,departmentId:department?.id??null,guidanceOutboxId:guidanceId};
 const stateDigest=digest(payload),encrypted=encryptValue(JSON.stringify(payload),key);if(encrypted.length>100000)throw new Error('SUPPORT_STATE_INVALID');
 await client.query(`insert into private.ai_support_state(conversation_id,line_session_id,last_message_id,ai_job_id,conversation_revision,
  source_digest,directory_digest,state_digest,context_encrypted,guidance_outbox_id,department_id,sensitive_level)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(conversation_id) do update set
  line_session_id=excluded.line_session_id,last_message_id=excluded.last_message_id,ai_job_id=excluded.ai_job_id,conversation_revision=excluded.conversation_revision,
  source_digest=excluded.source_digest,directory_digest=excluded.directory_digest,state_digest=excluded.state_digest,context_encrypted=excluded.context_encrypted,
  guidance_outbox_id=excluded.guidance_outbox_id,department_id=excluded.department_id,sensitive_level=excluded.sensitive_level,updated_at=clock_timestamp()`,
 [current.conversation_id,current.line_session_id,current.message_id,current.id,current.expected_conversation_revision,fresh.sourceDigest,fresh.directoryDigest,stateDigest,encrypted,guidanceId,department?.id??null,interpreted.sensitiveLevel]);
 if(!(await client.query("select id from private.ai_jobs where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()",[current.id,current.lease_token])).rowCount)throw new Error('AI_JOB_LEASE_LOST');
 return {stateDigest,interpreted};
}
