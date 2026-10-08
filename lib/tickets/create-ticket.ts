import {z} from 'zod';
import {resolveDepartment} from './route-department';
import {lockConversation,TicketError,type DbClient} from './authorization';
import {recordTicketHistory} from './history';
import {notifyTicketStaff} from './notifications';
import {enqueueOutbound} from '../queue/outbox';
import {loadSupportSnapshot} from '../ai/support-state';

const inputSchema=z.object({sessionId:z.uuid(),conversationId:z.uuid(),departmentCode:z.string(),summary:z.string().trim().min(1).max(1000)}).strict();
export async function createEscalation(client:DbClient,input:z.infer<typeof inputSchema>,key:string):Promise<{id:string;ticket_no:string}> {
 const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new TicketError('INVALID_REQUEST');
 const department=await resolveDepartment(client,input.departmentCode);
 await lockConversation(client,input.conversationId);
 const conversation=(await client.query('select * from public.conversations where id=$1 and line_session_id=$2 for update',[input.conversationId,input.sessionId])).rows[0];
 if(!conversation||conversation.mode!=='AI'||!['ACTIVE','WAITING'].includes(conversation.status))throw new TicketError('CONFLICT');
 if((await client.query("select id from public.tickets where conversation_id=$1 and status not in ('CLOSED','CANCELLED')",[conversation.id])).rowCount)throw new TicketError('CONFLICT');
 let sensitivity='GENERAL';
 if((await client.query('select conversation_id from private.ai_support_state where conversation_id=$1',[conversation.id])).rowCount){
  const last=(await client.query("select id from public.messages where conversation_id=$1 and sender_type='USER' and message_type='TEXT' and metadata->>'routing_status' is distinct from 'PENDING' order by created_at desc,id desc limit 1",[conversation.id])).rows[0];
  const support=last?await loadSupportSnapshot(client,{sessionId:input.sessionId,conversationId:conversation.id,messageId:last.id,revision:conversation.revision},key):null;
  if(!support)throw new TicketError('CONFLICT');sensitivity=support.minimumSensitivity;
 }
 const ticket=(await client.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,sensitive_level,mode,status)
 values($1,$2,$3,$4,$5,'HUMAN','WAITING_STAFF') returning *`,[input.sessionId,input.conversationId,department.id,input.summary,sensitivity])).rows[0];
 await client.query("update public.conversations set mode='HUMAN',status='ACTIVE',conversation_type='TICKET',active_ticket_id=$2,revision=revision+1,updated_at=clock_timestamp() where id=$1",[conversation.id,ticket.id]);
 await client.query("update public.messages set ticket_id=$2 where conversation_id=$1 and ticket_id is null",[conversation.id,ticket.id]);
 await client.query("update private.message_outbox set status='SUPPRESSED',last_error_code='HUMAN_TAKEOVER',lease_token=null,lease_until=null,completed_at=clock_timestamp() where conversation_id=$1 and kind='AI' and status in ('PENDING','PROCESSING')",[conversation.id]);
 await recordTicketHistory(client,{ticketId:ticket.id,action:'CREATED',to:'WAITING_STAFF',actorType:'SYSTEM'});
 await recordTicketHistory(client,{ticketId:ticket.id,action:'ROUTED',to:'WAITING_STAFF',actorType:'SYSTEM'});
 await enqueueOutbound(client,{idempotencyKey:`ticket-created:${ticket.id}`,channel:'STUDENT',kind:'SYSTEM',lineSessionId:input.sessionId,conversationId:conversation.id,ticketId:ticket.id,
  messages:[{type:'text',text:`รับเรื่องแล้วครับ ${ticket.ticket_no}\nส่งต่อ${department.name_th} รอเจ้าหน้าที่รับงาน`} ]},key);
 await notifyTicketStaff(client,ticket,key);
 return {id:ticket.id,ticket_no:ticket.ticket_no};
}
