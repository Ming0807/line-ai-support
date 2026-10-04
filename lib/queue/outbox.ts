import type {DbClient} from '../tickets/authorization';
import {encryptValue} from '../security/identity';
import {lockConversation} from '../tickets/authorization';
import {validateOutboxTarget} from './outbox-target';

export interface OutboundText {type:'text';text:string;quickReply?:{items:{type:'action';action:{type:'postback';label:string;data:string;displayText?:string}}[]}}
export interface EnqueueMessage {
 idempotencyKey:string;channel:'STUDENT'|'STAFF';kind:'AI'|'STAFF'|'SYSTEM'|'NOTIFICATION';
 lineSessionId?:string;recipientStaffId?:string;conversationId?:string;ticketId?:string;
 conversationRevision?:number;replyToken?:string;receivedAt?:Date;messages:OutboundText[];
}
export async function enqueueOutbound(client:DbClient,input:EnqueueMessage,key:string):Promise<string|null> {
 validateOutboxTarget({...input,deliveryMode:input.replyToken?'REPLY':'PUSH'});
 if(input.kind==='AI'){
  if(!input.conversationId||input.conversationRevision===undefined)throw new Error('AI_FENCE_REQUIRED');
  await lockConversation(client,input.conversationId);
  const allowed=(await client.query(`select c.id from public.conversations c where c.id=$1 and c.line_session_id=$2 and c.mode='AI' and c.revision=$3
   and c.status in ('ACTIVE','WAITING') and not exists(select 1 from public.tickets t where t.conversation_id=c.id and t.mode='HUMAN' and t.status not in ('CLOSED','CANCELLED'))`,[input.conversationId,input.lineSessionId,input.conversationRevision])).rowCount===1;
  if(!allowed)return null;
 }
 const lane=input.lineSessionId??input.recipientStaffId;
 if(!lane||input.messages.length<1||input.messages.length>5)throw new Error('INVALID_OUTBOX_INPUT');
 await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`outbox:${input.channel}:${lane}`]);
 const safeWindow=20;
 const deadline=input.replyToken&&input.receivedAt?new Date(input.receivedAt.getTime()+safeWindow*1000):null;
 const result=await client.query(`insert into private.message_outbox
 (idempotency_key,channel,kind,line_session_id,recipient_staff_id,conversation_id,ticket_id,
 expected_conversation_revision,payload_encrypted,delivery_mode,reply_deadline_at)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(idempotency_key) do nothing returning id`,
 [input.idempotencyKey,input.channel,input.kind,input.lineSessionId??null,input.recipientStaffId??null,
 input.conversationId??null,input.ticketId??null,input.conversationRevision??null,
 encryptValue(JSON.stringify({messages:input.messages,replyToken:input.replyToken}),key),deadline?'REPLY':'PUSH',deadline]);
 if(result.rows[0])return result.rows[0].id;
 const existing=(await client.query('select id from private.message_outbox where idempotency_key=$1',[input.idempotencyKey])).rows[0];
 if(!existing)throw new Error('OUTBOX_INSERT_FAILED');return existing.id;
}
