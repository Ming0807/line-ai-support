import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction,getDatabasePool} from '../database/pool';
import {nextTicketStatus,type TicketStatus} from '../conversation/state-machine';
import {enqueueOutbound} from '../queue/outbox';
import {ticketActionSchemas,type TicketActionInput,type StaffTicketAction,type TicketActionResult} from '../../types/tickets';
import {TicketError,loadActor,authorizeScope,isSupervisor,lockConversation,eligibleScopeSql} from './authorization';
import {recordTicketHistory} from './history';
import {notifyTicketStaff} from './notifications';
import {staffChatAccessLock} from '../staff/line-case-context';

/** Internal verified LINE origin only; browser action schemas cannot supply this. */
export interface ManualLineSelection {bindingHash:string;selectionId:string}

/** Sole Staff mutation boundary; caller owns the transaction, including any inbox/token effects. */
async function applyTicketActionInternal(client:PoolClient,staffId:string,ticketId:string,action:StaffTicketAction,input:TicketActionInput,key:string,batch?:{intervention:boolean},lineOrigin?:ManualLineSelection):Promise<{result:TicketActionResult;messageId:string|null}> {
 const parsed=ticketActionSchemas[action].safeParse(input);if(!parsed.success)throw new TicketError('INVALID_REQUEST');
 if(lineOrigin&&action!=='STAFF_REPLY')throw new TicketError('INVALID_REQUEST');
 if(action==='STAFF_REPLY')await client.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 const normalized=parsed.data;
 const actor=await loadActor(client,staffId);
 const reference=(await client.query('select conversation_id from public.tickets where id=$1',[ticketId])).rows[0];
 if(!reference)throw new TicketError('NOT_FOUND');
 await lockConversation(client,reference.conversation_id);
 const ticket=(await client.query('select * from public.tickets where id=$1 for update',[ticketId])).rows[0];
 if(!ticket)throw new TicketError('NOT_FOUND');
 await authorizeScope(client,ticket.department_id,ticket.sensitive_level);
 const conversation=(await client.query('select * from public.conversations where id=$1 for update',[ticket.conversation_id])).rows[0];
 const payloadHash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 const receiptAction=batch?'INCIDENT_BATCH_REPLY':action;
 const previous=(await client.query('select payload_hash,result from private.ticket_action_receipts where staff_id=$1 and ticket_id=$2 and action=$3 and request_id=$4',[staffId,ticketId,receiptAction,input.requestId])).rows[0];
 if(previous){if(previous.payload_hash!==payloadHash)throw new TicketError('CONFLICT');return {result:previous.result,messageId:null};}
 if(ticket.revision!==input.revision)throw new TicketError('CONFLICT');
 const supervisor=isSupervisor(actor);
 if(batch&&(action!=='STAFF_REPLY'||ticket.sensitive_level!=='GENERAL'||!ticket.assigned_staff_id||
  conversation.active_ticket_id!==ticketId||!['ACTIVE','WAITING'].includes(conversation.status)||
  !['STAFF_HANDLING','WAITING_USER'].includes(ticket.status)||
  (batch.intervention&&!supervisor)||(!batch.intervention&&ticket.assigned_staff_id!==staffId)))throw new TicketError('CONFLICT');
 if(['REASSIGN','REOPEN'].includes(action)&&!supervisor)throw new TicketError('NOT_FOUND');
 if(['STAFF_REPLY','RESOLVE','CLOSE'].includes(action)&&ticket.assigned_staff_id!==staffId&&!supervisor)throw new TicketError('NOT_FOUND');
 if(action==='ACCEPT'&&ticket.assigned_staff_id)throw new TicketError('CONFLICT');
 if(action!=='ACCEPT'&&(ticket.mode!=='HUMAN'||conversation.mode!=='HUMAN'))throw new TicketError('INVALID_ACTION');
 if(action==='STAFF_REPLY'&&(conversation.active_ticket_id!==ticketId||!['ACTIVE','WAITING'].includes(conversation.status)))throw new TicketError('CONFLICT');
 const next=nextTicketStatus(ticket.status as TicketStatus,action);
 if(!next)throw new TicketError('INVALID_ACTION');
 let selectionExpiresAt:string|undefined;
 if(lineOrigin){
  const selection=(await client.query(`select x.expires_at from private.staff_line_case_context x
   join private.staff_line_identities i on i.staff_id=x.staff_id and i.user_hash=x.binding_hash and i.active
   where x.staff_id=$1 and x.ticket_id=$2 and x.binding_hash=$3 and x.selection_id=$4
   and x.assignment_epoch=$5 and x.expires_at>clock_timestamp()`,[staffId,ticketId,lineOrigin.bindingHash,lineOrigin.selectionId,ticket.staff_line_epoch])).rows[0];
  if(!selection||ticket.sensitive_level!=='GENERAL'||ticket.assigned_staff_id!==staffId)throw new TicketError('CONFLICT');
  selectionExpiresAt=selection.expires_at.toISOString();
 }
 let assignee=ticket.assigned_staff_id;
 if(action==='ACCEPT')assignee=staffId;
 if(action==='REOPEN')assignee=null;
 if(action==='REASSIGN'){
  const target=(await client.query(`select s.id from public.staff_profiles s where ${eligibleScopeSql} and s.id=$3 for share`,[ticket.department_id,ticket.sensitive_level,input.assigneeId])).rows[0];
  if(!target)throw new TicketError('NOT_FOUND');assignee=target.id;
 }
 const updated=(await client.query(`update public.tickets set status=$2,mode='HUMAN',assigned_staff_id=$3,revision=revision+1,updated_at=clock_timestamp(),
 accepted_at=case when $4='ACCEPT' then clock_timestamp() else accepted_at end,
 resolved_at=case when $4='RESOLVE' then clock_timestamp() when $4='REOPEN' then null else resolved_at end,
 closed_at=case when $4='CLOSE' then clock_timestamp() when $4='REOPEN' then null else closed_at end where id=$1 returning *`,[ticketId,next,assignee,action])).rows[0];
 const conversationStatus=next==='CLOSED'?'CLOSED':next==='RESOLVED'?'RESOLVED':next==='WAITING_USER'?'WAITING':'ACTIVE';
 await client.query('update public.conversations set mode=\'HUMAN\',status=$2,active_ticket_id=$3,revision=revision+1,updated_at=clock_timestamp() where id=$1',[ticket.conversation_id,conversationStatus,ticketId]);
 await client.query("update private.message_outbox set status='SUPPRESSED',last_error_code='HUMAN_TAKEOVER',completed_at=clock_timestamp(),lease_token=null,lease_until=null where conversation_id=$1 and kind='AI' and status in ('PENDING','PROCESSING')",[ticket.conversation_id]);
 const names={ACCEPT:'ACCEPTED',STAFF_REPLY:'STAFF_REPLIED',RESOLVE:'RESOLVED',CLOSE:'CLOSED',REASSIGN:'REASSIGNED',REOPEN:'REOPENED'};
 await recordTicketHistory(client,{ticketId,action:names[action],from:ticket.status,to:next,actorType:'STAFF',actorId:staffId,reason:input.reason});
 let messageId:string|null=null;
 if(action==='STAFF_REPLY'){
  const message=(await client.query("insert into public.messages(conversation_id,ticket_id,sender_type,sender_staff_id,content) values($1,$2,'STAFF',$3,$4) returning id",[ticket.conversation_id,ticketId,staffId,input.text])).rows[0];
  messageId=message.id;
  if(!batch){
   const outbox=await enqueueOutbound(client,{idempotencyKey:`staff-reply:${ticketId}:${message.id}`,channel:'STUDENT',kind:'STAFF',lineSessionId:ticket.line_session_id,conversationId:ticket.conversation_id,ticketId,
    selectionExpiresAt,messages:[{type:'text',text:ticket.ticket_no},{type:'text',text:input.text!}]},key);
   if(!outbox)throw new TicketError('CONFLICT');
   await client.query("insert into private.staff_chat_delivery_guards(outbox_id,staff_id,binding_hash,purpose) values($1,$2,$3,'CASE')",[outbox,staffId,lineOrigin?.bindingHash??null]);
   await client.query('insert into private.staff_chat_delivery_cases(outbox_id,ticket_id,assignment_epoch) values($1,$2,$3)',[outbox,ticketId,ticket.staff_line_epoch]);
  }
 }
 if(action==='REOPEN')await notifyTicketStaff(client,updated,key);
 const result:TicketActionResult={id:ticketId,status:next,revision:updated.revision};
 await client.query('insert into private.ticket_action_receipts(staff_id,ticket_id,action,request_id,payload_hash,result) values($1,$2,$3,$4,$5,$6)',[staffId,ticketId,receiptAction,input.requestId,payloadHash,result]);
 return {result,messageId};
}

export async function applyTicketAction(client:PoolClient,staffId:string,ticketId:string,action:StaffTicketAction,input:TicketActionInput,key:string,lineOrigin?:ManualLineSelection):Promise<TicketActionResult>{
 return (await applyTicketActionInternal(client,staffId,ticketId,action,input,key,undefined,lineOrigin)).result;
}
/** Internal batch transaction owns grouping/enqueue; individual history/state/receipts stay identical. */
export async function applyIncidentBatchStaffReply(client:PoolClient,staffId:string,ticketId:string,input:TicketActionInput,key:string,intervention:boolean){
 const applied=await applyTicketActionInternal(client,staffId,ticketId,'STAFF_REPLY',input,key,{intervention});
 if(!applied.messageId)throw new TicketError('CONFLICT');
 return {result:applied.result,messageId:applied.messageId};
}

export async function executeTicketAction(staffId:string,ticketId:string,action:StaffTicketAction,input:TicketActionInput,pool:Pool=getDatabasePool()):Promise<TicketActionResult> {
 const key=process.env.ENCRYPTION_KEY;if(!key)throw new Error('ENCRYPTION_NOT_CONFIGURED');
 return transaction(client=>applyTicketAction(client,staffId,ticketId,action,input,key),pool);
}
