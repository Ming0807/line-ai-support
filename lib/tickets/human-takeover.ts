import {lockConversation,TicketError,type DbClient} from './authorization';
import {recordTicketHistory} from './history';

/** Context ownership is rechecked inside the inbox transaction. A user message never reopens CLOSED. */
export async function applyUserReply(client:DbClient,sessionId:string,ticketId:string,messageId:string):Promise<void> {
 const reference=(await client.query('select conversation_id from public.tickets where id=$1 and line_session_id=$2',[ticketId,sessionId])).rows[0];
 if(!reference)throw new TicketError('NOT_FOUND');
 await lockConversation(client,reference.conversation_id);
 const ticket=(await client.query('select * from public.tickets where id=$1 and line_session_id=$2 for update',[ticketId,sessionId])).rows[0];
 if(!ticket||ticket.mode!=='HUMAN'||['CLOSED','CANCELLED','RESOLVED'].includes(ticket.status))throw new TicketError('CONFLICT');
 const message=(await client.query('select * from public.messages where id=$1 for update',[messageId])).rows[0];
 if(!message||message.sender_type!=='USER'||message.ticket_id)throw new TicketError('CONFLICT');
 const owner=(await client.query('select line_session_id from public.conversations where id=$1',[message.conversation_id])).rows[0];
 if(!owner||owner.line_session_id!==sessionId)throw new TicketError('NOT_FOUND');
 await client.query('update public.messages set conversation_id=$2,ticket_id=$3,metadata=\'{"routing_status":"ROUTED"}\' where id=$1',[messageId,ticket.conversation_id,ticketId]);
 if(ticket.status==='WAITING_USER'){
  await client.query("update public.tickets set status='STAFF_HANDLING',revision=revision+1,updated_at=clock_timestamp() where id=$1",[ticketId]);
  await client.query("update public.conversations set mode='HUMAN',status='ACTIVE',revision=revision+1,updated_at=clock_timestamp() where id=$1",[ticket.conversation_id]);
  await recordTicketHistory(client,{ticketId,action:'USER_REPLIED',from:'WAITING_USER',to:'STAFF_HANDLING',actorType:'USER'});
 }
}
