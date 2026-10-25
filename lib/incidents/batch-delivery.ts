import type {DbClient} from '../tickets/authorization';
import type {OutboundText} from '../queue/outbox';
import {hashOpaqueToken} from '../conversation/quick-reply';
import type {StaffChatDeliveryGuard} from '../staff/line-chat-delivery';

export interface IncidentBatchDelivery {
 id:string;batch_id:string;recipient_code:string;line_session_id:string;packet_digest:string;case_count:number;
 staff_id:string;batch_case_count:number;recipient_count:number;
 cases:{ticket_id:string;assignment_epoch:string;staff_message_id:string;conversation_id:string;current_conversation_id:string;line_session_id:string;ticket_code:string;current_ticket_code:string}[];
}

export function incidentBatchPacketDigest(messages:OutboundText[],key:string):string{
 return hashOpaqueToken(JSON.stringify({messages}),key,'incident-batch-packet-v1');
}
/** Immutable mappings can be loaded before acquiring every mapped conversation lock. */
export async function loadIncidentBatchDelivery(c:DbClient,outboxId:string):Promise<IncidentBatchDelivery|null>{
 const row=(await c.query(`select r.id,r.batch_id,r.recipient_code,r.line_session_id,r.packet_digest,r.case_count,b.staff_id,b.case_count batch_case_count,b.recipient_count
  from private.incident_reply_recipients r join private.incident_reply_batches b on b.id=r.batch_id where r.outbox_id=$1`,[outboxId])).rows[0];
 if(!row)return null;
 const cases=(await c.query(`select b.ticket_id,b.assignment_epoch::text,b.staff_message_id,b.conversation_id,t.conversation_id current_conversation_id,t.line_session_id,b.ticket_code,t.ticket_no current_ticket_code
  from private.incident_reply_cases b join public.tickets t on t.id=b.ticket_id where b.batch_id=$1 and b.recipient_id=$2 order by t.id`,[row.batch_id,row.id])).rows;
 return {...row,cases};
}
/** Called under Staff access and all mapped conversation locks. No mapping or packet substitution is accepted. */
export async function verifyIncidentBatchDelivery(c:DbClient,batch:IncidentBatchDelivery|null,guard:StaffChatDeliveryGuard|null,
 job:{channel:string;kind:string;line_session_id:string|null;conversation_id:string|null;ticket_id:string|null;delivery_mode:string;idempotency_key:string},
 payload:{messages:OutboundText[];replyToken?:string},key:string):Promise<boolean>{
 if(!batch||!guard||job.kind!=='BATCH'||job.channel!=='STUDENT'||job.delivery_mode!=='PUSH'||payload.replyToken!==undefined||
  job.line_session_id!==batch.line_session_id||job.idempotency_key!==`incident-batch:${batch.batch_id}:${batch.recipient_code}`||
  guard.staff_id!==batch.staff_id||guard.purpose!=='CASE'||batch.cases.length!==batch.case_count||guard.cases.length!==batch.case_count||
  incidentBatchPacketDigest(payload.messages,key)!==batch.packet_digest)return false;
 const first=batch.cases[0];
 if(!first||job.ticket_id!==first.ticket_id||job.conversation_id!==first.conversation_id)return false;
 for(const member of batch.cases){
  if(member.line_session_id!==batch.line_session_id||member.conversation_id!==member.current_conversation_id||member.ticket_code!==member.current_ticket_code||
   !guard.cases.some(item=>item.ticket_id===member.ticket_id&&String(item.assignment_epoch)===member.assignment_epoch&&item.conversation_id===member.conversation_id))return false;
 }
 const counts=(await c.query(`select (select count(*)::int from private.incident_reply_cases where batch_id=$1) cases,
  (select count(*)::int from private.incident_reply_recipients where batch_id=$1) recipients`,[batch.batch_id])).rows[0];
 if(counts.cases!==batch.batch_case_count||counts.recipients!==batch.recipient_count)return false;
 const prefix=`อัปเดตเคส: ${batch.cases.map(member=>member.ticket_code).join(', ')}\n\n`,text=payload.messages.map(message=>message.text).join('');
 if(!text.startsWith(prefix))return false;
 for(const member of batch.cases){
  if((await c.query(`select id from public.messages where id=$1 and ticket_id=$2 and conversation_id=$3 and sender_type='STAFF' and sender_staff_id=$4 and content=$5`,
   [member.staff_message_id,member.ticket_id,member.conversation_id,batch.staff_id,text.slice(prefix.length)])).rowCount!==1)return false;
 }
 return true;
}
