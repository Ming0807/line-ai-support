import type {DbClient} from '../tickets/authorization';
import type {DirectUserEvent} from '../line/events';
import {decryptValue} from '../security/identity';
import {candidateSnapshot} from './context-resolver';
import type {RouteCandidate} from './router';
import {consumeChoiceHash,hashOpaqueToken} from './quick-reply';
import {loadSupportActionState} from '../ai/support-state';

// A server command confirms a previously offered action; it never selects a case from keywords.
export const TYPED_ESCALATION_CONFIRMATION='ยืนยันให้ส่งเรื่องนี้ให้เจ้าหน้าที่ช่วยตรวจสอบ';
export const isTypedSupportConfirmation=(text:string)=>text.trim()===TYPED_ESCALATION_CONFIRMATION;

async function wasOfferSent(client:DbClient,sessionId:string,conversationId:string,tokenHash:string,key:string,receivedAt:Date):Promise<boolean>{
 if(!(receivedAt instanceof Date)||!Number.isFinite(receivedAt.getTime()))return false;
 const rows=(await client.query(`select payload_encrypted from private.message_outbox where line_session_id=$1 and conversation_id=$2
  and channel='STUDENT' and kind='AI' and status='SENT' and completed_at<=$3
  order by created_at desc,id desc limit 20`,[sessionId,conversationId,receivedAt])).rows;
 return rows.some(row=>{
  try{
   const payload=JSON.parse(decryptValue(row.payload_encrypted,key));
   return Array.isArray(payload.messages)&&payload.messages.some((message:{quickReply?:{items?:{action?:{data?:string}}[]}})=>
    message.quickReply?.items?.some(item=>{
     const token=/^yru:choice:([A-Za-z0-9_-]{43})$/.exec(item.action?.data??'')?.[1];
     return !!token&&hashOpaqueToken(token,key)===tokenHash;
    }));
  }catch{return false;}
 });
}

/** Caller holds the session/candidate locks. Only one live, fresh, actually sent proposal is eligible. */
export async function consumeTypedSupportConfirmation(client:DbClient,sessionId:string,text:string,candidates:RouteCandidate[],key:string,receivedAt:Date){
 if(!isTypedSupportConfirmation(text))return null;
 const rows=(await client.query(`select token_hash,choice from private.pending_route_choices where line_session_id=$1
  and consumed_at is null and expires_at>clock_timestamp() and choice->>'action'='ESCALATE'
  and choice->>'supportDigest' is not null order by token_hash limit 21`,[sessionId])).rows;
 if(rows.length>20)return null;
 const eligible=[];
 for(const row of rows){
  if(!candidates.some(candidate=>candidate.conversationId===row.choice.conversationId&&candidate.mode==='AI'))continue;
  const state=await loadSupportActionState(client,sessionId,row.choice.conversationId,key);
  if(state?.stateDigest!==row.choice.supportDigest||!await wasOfferSent(client,sessionId,row.choice.conversationId,row.token_hash,key,receivedAt))continue;
  eligible.push(row);
 }
 if(eligible.length!==1)return null;
 const row=eligible[0],consumed=await consumeChoiceHash(client,sessionId,row.token_hash,candidateSnapshot(candidates));
 return consumed?{choice:consumed.choice,tokenHash:row.token_hash as string}:null;
}

/** Validators reconstruct MESSAGE authority from the immutable verified inbox and owned control record. */
export async function confirmationChoiceHash(client:DbClient,event:DirectUserEvent,eventId:string,sessionId:string,key:string):Promise<string|null>{
 if(event.type==='postback'){
  const token=/^yru:choice:([A-Za-z0-9_-]{43})$/.exec(event.postback.data)?.[1];
  return token?hashOpaqueToken(token,key):null;
 }
 if(event.type!=='message'||event.message.type!=='text'||!isTypedSupportConfirmation(event.message.text))return null;
 const row=(await client.query(`select m.metadata->>'support_choice_hash' token_hash,m.conversation_id,e.received_at from public.messages m
  join private.webhook_inbox e on e.id=m.source_event_id
  join public.conversations c on c.id=m.conversation_id where m.source_event_id=$1 and m.line_message_id=$2
  and c.line_session_id=$3 and m.sender_type='USER' and m.content=$4 and m.metadata->>'routing_status'='ROUTE_CONTROL'`,
 [eventId,event.message.id,sessionId,event.message.text])).rows[0];
 if(!row||!/^[a-f0-9]{64}$/u.test(row.token_hash??''))return null;
 return await wasOfferSent(client,sessionId,row.conversation_id,row.token_hash,key,row.received_at)?row.token_hash:null;
}
