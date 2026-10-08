import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import type {DbClient} from '../tickets/authorization';
import {lockConversation} from '../tickets/authorization';
import {userEventSchema,type DirectUserEvent} from '../line/events';
import {decryptValue,hashLineUserId} from '../security/identity';
import type {InboxJob} from '../queue/process-inbox';
import {loadCandidates} from './context-resolver';
import {projectRoutingContext,resolveRoutingProposal,type SemanticCandidate,type SemanticClassifier} from './semantic-routing-contracts';
type Selection=NonNullable<ReturnType<typeof resolveRoutingProposal>>;
export interface SemanticRoutingAdvice {eventId:string;sessionId:string;questionDigest:string;contextDigest:string;selection:Selection}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function loadContext(client:DbClient,sessionId:string):Promise<SemanticCandidate[]>{
 const candidates=await loadCandidates(client,sessionId);
 if(candidates.length>12)return [];
 const rows=(await client.query(`select c.id,c.topic,t.problem_summary,
  coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'content',m.content,'createdAt',m.created_at) order by m.created_at,m.id)
   from(select id,content,created_at from public.messages where conversation_id=c.id and sender_type='USER' and message_type='TEXT'
    and metadata->>'routing_status' is distinct from 'PENDING' order by created_at desc,id desc limit 2) m),'[]'::jsonb) history
  from public.conversations c left join public.tickets t on t.id=c.active_ticket_id where c.id=any($1::uuid[])`,[candidates.map(c=>c.conversationId)])).rows;
 if(rows.length!==candidates.length)return [];
 return candidates.map(candidate=>{const row=rows.find(r=>r.id===candidate.conversationId)!;return {...candidate,topic:row.topic,summary:row.problem_summary??null,history:row.history};});
}
/** Called within the normal owned inbox transaction, before inserting the current USER message. */
export async function validateRoutingAdvice(client:DbClient,input:{sessionId:string;eventId:string;event:DirectUserEvent},advice?:SemanticRoutingAdvice):Promise<Selection|null>{
 if(!advice||advice.eventId!==input.eventId||advice.sessionId!==input.sessionId||input.event.type!=='message'||input.event.message.type!=='text'||
  advice.questionDigest!==digest(input.event.message.text))return null;
 if(!(await client.query('select id from public.line_sessions where id=$1 and active',[input.sessionId])).rowCount)return null;
 const current=await loadContext(client,input.sessionId);
 if(!current.length||digest(current)!==advice.contextDigest)return null;
 if(advice.selection.selectedConversationId&&!current.some(c=>c.conversationId===advice.selection.selectedConversationId))return null;
 return advice.selection;
}
/** Lease preflight commits before provider HTTP. No ticket/message/outbox effects occur here. */
export async function classifyStudentInboxContext(pool:Pool,job:InboxJob,key:string,classify:SemanticClassifier):Promise<SemanticRoutingAdvice|null>{
 if(job.channel!=='STUDENT')return null;
 const before=await transaction(async c=>{
  await c.query("set local statement_timeout='5s';set local lock_timeout='2s'");
  const row=(await c.query(`select * from private.webhook_inbox where id=$1 and lease_token=$2 and status='PROCESSING'
   and lease_until>clock_timestamp()+interval '7 seconds' for share`,[job.id,job.lease_token])).rows[0];
  if(!row||row.channel!=='STUDENT'||row.payload_encrypted!==job.payload_encrypted)return null;
  let parsed;try{parsed=userEventSchema.safeParse(JSON.parse(decryptValue(row.payload_encrypted,key)));}catch{return null;}
  if(!parsed.success)return null;
  const event=parsed.data;if(event.type!=='message'||event.message.type!=='text')return null;
  const question=event.message.text;if(question.length>2000||!question.trim())return null;
  const hash=hashLineUserId(event.source.userId,key);if(row.user_hash!==hash||job.user_hash!==hash)return null;
  await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`processing:STUDENT:${hash}`]);
  const session=(await c.query('select i.line_session_id from private.line_identities i join public.line_sessions s on s.id=i.line_session_id and s.active where i.user_hash=$1',[hash])).rows[0];
  if(!session)return null;
  const recent=(await c.query(`select count(*)::int n from private.webhook_inbox prior where prior.user_hash=$1 and prior.channel='STUDENT'
   and prior.event_kind='MESSAGE' and prior.received_at>$2::timestamptz-interval '1 minute' and prior.received_at<=$2 and prior.event_seq<$3`,[hash,row.received_at,row.event_seq])).rows[0].n;
  if(recent>=20||(await c.query('select id from public.messages where line_message_id=$1',[event.message.id])).rowCount)return null;
  const candidates=await loadCandidates(c,session.line_session_id);if(!candidates.length||candidates.length>12)return null;
  for(const candidate of [...candidates].sort((a,b)=>a.conversationId.localeCompare(b.conversationId)))await lockConversation(c,candidate.conversationId);
  const context=await loadContext(c,session.line_session_id);if(!context.length)return null;
  const remaining=(await c.query('select extract(epoch from(lease_until-clock_timestamp()))*1000 ms from private.webhook_inbox where id=$1 and lease_token=$2 and status=\'PROCESSING\'',[job.id,job.lease_token])).rows[0];
  const duration=Math.min(8000,Number(remaining?.ms)-7000);if(!Number.isFinite(duration)||duration<1)return null;
  return {sessionId:session.line_session_id as string,question,context,duration};
 },pool);
 if(!before)return null;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const boundary=new Promise<null>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},before.duration);});
 try{
  const proposal=await Promise.race([boundary,Promise.resolve().then(()=>classify({question:before.question,contexts:projectRoutingContext(before.context)},controller.signal))]);
  const selection=resolveRoutingProposal(proposal,before.context);if(controller.signal.aborted||!selection)return null;
  return {eventId:job.id,sessionId:before.sessionId,questionDigest:digest(before.question),contextDigest:digest(before.context),selection};
 }catch{return null;}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
