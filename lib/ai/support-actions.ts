import {z} from 'zod';
import type {DbClient} from '../tickets/authorization';
import {lockConversation} from '../tickets/authorization';
import {decryptValue,hashLineUserId} from '../security/identity';
import {userEventSchema} from '../line/events';
import {createChoices,hashOpaqueToken} from '../conversation/quick-reply';
import {candidateSnapshot,loadCandidates} from '../conversation/context-resolver';
import {loadSupportActionState,type SupportActionState} from './support-state';

const confirmationSchema=z.strictObject({sessionId:z.uuid(),conversationId:z.uuid(),stateDigest:z.string().regex(/^[a-f0-9]{64}$/u),eventId:z.uuid()});
export type SupportConfirmation=z.infer<typeof confirmationSchema>;
/** Only a verified inbox plus an actually consumed, unexpired owned choice authorizes a new outcome. */
export async function supportConfirmationMatches(client:DbClient,value:SupportConfirmation,action:'SOLVED'|'ESCALATE',key:string,options:{replay?:boolean;requireLive?:boolean;departmentCode?:string}={}):Promise<boolean>{
 const p=confirmationSchema.safeParse(value);if(!p.success)return false;const input=p.data;
 const source=(await client.query(`select e.payload_encrypted,e.user_hash,i.user_hash expected_hash from private.webhook_inbox e
  join private.line_identities i on i.line_session_id=$2 where e.id=$1 and e.channel='STUDENT'`,[input.eventId,input.sessionId])).rows[0];
 if(!source||source.user_hash!==source.expected_hash)return false;
 try{
  const event=userEventSchema.safeParse(JSON.parse(decryptValue(source.payload_encrypted,key)));
  if(!event.success||event.data.type!=='postback'||hashLineUserId(event.data.source.userId,key)!==source.expected_hash)return false;
  const token=/^yru:choice:([A-Za-z0-9_-]{43})$/.exec(event.data.postback.data)?.[1];if(!token)return false;
  const row=(await client.query(`select choice,candidate_snapshot,expires_at>clock_timestamp() live from private.pending_route_choices
   where token_hash=$1 and line_session_id=$2 and consumed_at is not null for update`,[hashOpaqueToken(token,key),input.sessionId])).rows[0];
  if(!row||(!options.replay||options.requireLive)&&!row.live||row.choice.action!==action||row.choice.conversationId!==input.conversationId||row.choice.supportDigest!==input.stateDigest||
   options.departmentCode!==undefined&&row.choice.departmentCode!==options.departmentCode)return false;
  if(options.replay)return true;
  const canonical=(v:{id:string}[])=>JSON.stringify([...v].sort((a,b)=>a.id.localeCompare(b.id)));
  return Array.isArray(row.candidate_snapshot)&&canonical(row.candidate_snapshot)===canonical(candidateSnapshot(await loadCandidates(client,input.sessionId)));
 }catch{return false;}
}
/** New canonical troubleshooting can offer confirmation, but consumption still requires actual SENT guidance. */
export async function createSupportActions(client:DbClient,state:SupportActionState,key:string,options:{canonicalTroubleshooting?:boolean}={}){
 const a=state.interpreted,context=state.snapshot.context;
 const values={conversationId:context.conversationId,supportDigest:state.stateDigest};
 const choices:{label:string;value:Record<string,string>}[]=[];
 if(state.canConfirmSolved||options.canonicalTroubleshooting)choices.push({label:'แก้ได้แล้ว',value:{action:'SOLVED',...values}});
 const needsHandoff=a.needsTicket||options.canonicalTroubleshooting||state.canConfirmSolved||a.intent==='TROUBLESHOOT'&&!a.clarification;
 if(needsHandoff){
  if(a.departmentCode)choices.push({label:`ส่งต่อ ${a.departmentCode}`,value:{action:'ESCALATE',departmentCode:a.departmentCode,...values}});
  choices.push({label:a.departmentCode?'เลือกหน่วยงานอื่น':'ติดต่อเจ้าหน้าที่',value:{action:'CONTACT',...values}});
 }
 if(!choices.length)return undefined;
 choices.push({label:'เริ่มเรื่องใหม่',value:{action:'NEW'}});
 return createChoices(client,{sessionId:context.sessionId,snapshot:candidateSnapshot(await loadCandidates(client,context.sessionId)),choices},key);
}
export async function confirmSupportSolved(client:DbClient,value:SupportConfirmation,key:string):Promise<boolean>{
 const p=confirmationSchema.safeParse(value);if(!p.success)return false;const input=p.data;await lockConversation(client,input.conversationId);
 const prior=(await client.query('select * from private.ai_support_outcomes where conversation_id=$1',[input.conversationId])).rows[0];
 if(prior)return prior.kind==='USER_CONFIRMED_SOLVED'&&prior.line_session_id===input.sessionId&&prior.confirmation_event_id===input.eventId&&prior.state_digest===input.stateDigest&&
  await supportConfirmationMatches(client,input,'SOLVED',key,{replay:true});
 const state=await loadSupportActionState(client,input.sessionId,input.conversationId,key);
 if(!state||state.stateDigest!==input.stateDigest||!state.canConfirmSolved||!await supportConfirmationMatches(client,input,'SOLVED',key)||
  (await client.query('select id from public.tickets where conversation_id=$1',[input.conversationId])).rowCount)return false;
 await client.query(`insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,department_id,sensitive_level)
  values($1,$2,$3,$4,$5,'USER_CONFIRMED_SOLVED',$6,$7)`,[input.conversationId,input.sessionId,state.snapshot.context.messageId,input.eventId,state.stateDigest,state.departmentId,state.interpreted.sensitiveLevel]);
 await client.query("update public.conversations set status='RESOLVED',revision=revision+1,updated_at=clock_timestamp() where id=$1",[input.conversationId]);
 await client.query("update private.ai_jobs set status='SUPPRESSED',last_error_code='USER_CONFIRMED_SOLVED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where conversation_id=$1 and status in('PENDING','PROCESSING')",[input.conversationId]);
 await client.query("update private.message_outbox set status='SUPPRESSED',last_error_code='USER_CONFIRMED_SOLVED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where conversation_id=$1 and kind='AI' and status in('PENDING','PROCESSING')",[input.conversationId]);
 return true;
}
/** Called atomically after a verified confirmation created the exact ticket and encrypted context copy. */
export async function recordSupportEscalation(client:DbClient,input:SupportConfirmation,state:SupportActionState,ticketId:string,departmentCode:string,key:string){
 if(state.stateDigest!==input.stateDigest||state.snapshot.context.sessionId!==input.sessionId||state.snapshot.context.conversationId!==input.conversationId||
  !await supportConfirmationMatches(client,input,'ESCALATE',key,{replay:true,requireLive:true,departmentCode}))throw new Error('SUPPORT_CONFIRMATION_INVALID');
 const ticket=(await client.query(`select t.* from public.tickets t join private.ticket_support_contexts s on s.ticket_id=t.id
  where t.id=$1 and t.conversation_id=$2 and t.line_session_id=$3 and s.state_digest=$4 and s.source_digest=$5`,
 [ticketId,input.conversationId,input.sessionId,state.stateDigest,state.sourceDigest])).rows[0];
 if(!ticket)throw new Error('SUPPORT_TICKET_CONTEXT_INVALID');
 await client.query(`insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,department_id,sensitive_level,ticket_id)
  values($1,$2,$3,$4,$5,'USER_CONFIRMED_ESCALATED',$6,$7,$8)`,[input.conversationId,input.sessionId,state.snapshot.context.messageId,input.eventId,state.stateDigest,ticket.department_id,ticket.sensitive_level,ticket.id]);
}
