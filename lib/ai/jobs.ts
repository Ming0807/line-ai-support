import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {lockConversation,type DbClient} from '../tickets/authorization';
import {encryptValue,decryptValue} from '../security/identity';
import type {OutboundText} from '../queue/outbox';
import {ragAnswerSchema,citationEvidenceSchema} from '../knowledge/citations';
import {knowledgeScopeSchema} from '../knowledge/retrieval';
import {structuredQuerySchema} from '../knowledge/structured-query';
import {structuredAnswerSchema,structuredEvidenceListSchema} from '../knowledge/structured-citations';

const action=z.object({type:z.literal('postback'),label:z.string().min(1).max(20),data:z.string().min(1).max(300),displayText:z.string().max(300).optional()}).strict();
export const aiRequestSchema=z.object({replyToken:z.string().min(1).max(500).optional(),receivedAt:z.iso.datetime(),
 quickReply:z.object({items:z.array(z.object({type:z.literal('action'),action}).strict()).min(1).max(13)}).strict().optional()}).strict();
export const aiResultSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('CLARIFY'),text:z.string().min(1).max(2000)}).strict(),
 z.object({kind:z.literal('ANSWER'),output:ragAnswerSchema,scope:knowledgeScopeSchema,evidence:z.array(citationEvidenceSchema).min(1).max(12),
  queryVector:z.array(z.number().finite()).min(1).max(4096).refine(v=>v.some(n=>n!==0)),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({kind:z.literal('STRUCTURED_ANSWER'),output:structuredAnswerSchema,scope:knowledgeScopeSchema,query:structuredQuerySchema,evidence:structuredEvidenceListSchema}).strict()
  .refine(value=>Buffer.byteLength(JSON.stringify(value),'utf8')<=128*1024),
]);
export type AIResult=z.infer<typeof aiResultSchema>;
export interface AIJob {
 id:string;line_session_id:string;conversation_id:string;message_id:string;expected_conversation_revision:number;
 lease_token:string;lease_until:Date;request_encrypted:string;result_encrypted:string|null;attempts:number;
}
export interface PrepareAIJob {
 sessionId:string;conversationId:string;messageId:string;replyToken?:string;receivedAt:Date;quickReply?:OutboundText['quickReply'];
}
/** Called inside the verified inbox business transaction, after routing and storing the USER message. */
export async function prepareAIJob(client:DbClient,input:PrepareAIJob,key:string):Promise<string|null>{
 if(![input.sessionId,input.conversationId,input.messageId].every(id=>z.uuid().safeParse(id).success)||
  !(input.receivedAt instanceof Date)||!Number.isFinite(input.receivedAt.getTime()))throw new Error('AI_JOB_CONTEXT_INVALID');
 const request=aiRequestSchema.safeParse({replyToken:input.replyToken,receivedAt:input.receivedAt.toISOString(),quickReply:input.quickReply});
 if(!request.success)throw new Error('AI_JOB_REQUEST_INVALID');
 await lockConversation(client,input.conversationId);
 const context=(await client.query(`select c.mode,c.status,c.revision,s.active,m.sender_type,m.message_type from public.conversations c
  join public.line_sessions s on s.id=c.line_session_id join public.messages m on m.id=$3 and m.conversation_id=c.id
  where c.id=$1 and c.line_session_id=$2`,[input.conversationId,input.sessionId,input.messageId])).rows[0];
 if(!context||context.sender_type!=='USER'||context.message_type!=='TEXT')throw new Error('AI_JOB_CONTEXT_INVALID');
 if(!context.active||context.mode!=='AI'||!['ACTIVE','WAITING'].includes(context.status))return null;
 if((await client.query("select id from public.tickets where conversation_id=$1 and mode='HUMAN' and status not in ('CLOSED','CANCELLED')",[input.conversationId])).rowCount)return null;
 const saved=(await client.query(`insert into private.ai_jobs(line_session_id,conversation_id,message_id,expected_conversation_revision,request_encrypted)
  values($1,$2,$3,$4,$5) on conflict(message_id) do nothing returning id`,[input.sessionId,input.conversationId,input.messageId,context.revision,
  encryptValue(JSON.stringify(request.data),key)])).rows[0];
 return saved?.id??(await client.query('select id from private.ai_jobs where message_id=$1',[input.messageId])).rows[0].id;
}
export async function claimAIJob(pool:Pool):Promise<AIJob|null>{return (await pool.query('select * from private.claim_ai_job()')).rows[0]??null;}

export async function lockedAIJob(client:PoolClient,job:AIJob):Promise<AIJob>{
 const row=(await client.query(`select * from private.ai_jobs where id=$1 and status='PROCESSING' and lease_token=$2
  and lease_until>clock_timestamp() for update`,[job.id,job.lease_token])).rows[0];
 if(!row)throw new Error('AI_JOB_LEASE_LOST');return row;
}
export async function saveAIResult(pool:Pool,job:AIJob,result:AIResult,key:string):Promise<void>{
 const parsed=aiResultSchema.safeParse(result);
 if(!parsed.success||JSON.stringify(parsed.data).length>150000)throw new Error('AI_JOB_RESULT_INVALID');
 await transaction(async client=>{
  await client.query("set local statement_timeout='5s'");
  const locked=await lockedAIJob(client,job);if(locked.result_encrypted!==null)return;
  const saved=await client.query(`update private.ai_jobs set result_encrypted=$3,result_saved_at=clock_timestamp()
   where id=$1 and lease_token=$2 and lease_until>clock_timestamp()`,[job.id,job.lease_token,encryptValue(JSON.stringify(parsed.data),key)]);
  if(saved.rowCount!==1)throw new Error('AI_JOB_LEASE_LOST');
 },pool);
}
export function decodeAIResult(job:AIJob,key:string):AIResult|null {
 if(job.result_encrypted===null)return null;
 try{return aiResultSchema.parse(JSON.parse(decryptValue(job.result_encrypted,key)));}
 catch{throw new Error('AI_JOB_RESULT_INVALID');}
}
