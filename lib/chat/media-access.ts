import type {Pool,PoolClient} from 'pg';
import {getDatabasePool,transaction} from '../database/pool';
import {loadActor,authorizeScope,lockConversation,TicketError} from '../tickets/authorization';
import {ChatMediaError,openChatMedia,type ChatMediaStorage,type ChatMediaRef} from './media-binary';
import {chatMediaReference,verifyChatMediaRowSource,type ChatMediaRow} from './media-repository';
import {createChatMediaStorage} from './media-storage';

async function authorized(c:PoolClient,staffId:string,ticketId:string,attachmentId:string,key:string):Promise<{ref:ChatMediaRef;name:string}> {
 try{
  await loadActor(c,staffId);
  const first=(await c.query('select conversation_id from public.tickets where id=$1',[ticketId])).rows[0];if(!first)throw new ChatMediaError('NOT_FOUND');
  await lockConversation(c,first.conversation_id);
  const ticket=(await c.query('select conversation_id,department_id,sensitive_level from public.tickets where id=$1 for share',[ticketId])).rows[0];
  if(!ticket)throw new ChatMediaError('NOT_FOUND');await authorizeScope(c,ticket.department_id,ticket.sensitive_level);
  const row=(await c.query<ChatMediaRow>(`select a.* from private.chat_attachments a join public.messages m on m.id=a.message_id
   where a.id=$1 and a.revoked_at is null and m.ticket_id=$2 and m.conversation_id=$3 and m.sender_type='USER'
    and m.source_event_id=a.source_event_id and m.message_type=a.kind`,[attachmentId,ticketId,ticket.conversation_id])).rows[0];
  if(!row)throw new ChatMediaError('NOT_FOUND');if(row.status!=='READY')throw new ChatMediaError('NOT_READY');
  const source=await verifyChatMediaRowSource(c,row,key);
  return {ref:chatMediaReference(row),name:source.fileName};
 }catch(error){if(error instanceof TicketError)throw new ChatMediaError('NOT_FOUND');throw error;}
}
export async function readStaffChatAttachment(staffId:string,ticketId:string,attachmentId:string,options:{pool?:Pool;key?:string;storage?:ChatMediaStorage;signal?:AbortSignal}={}):Promise<{bytes:Uint8Array;name:string;mimeType:string}> {
 const pool=options.pool??getDatabasePool(),key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ChatMediaError('UNAVAILABLE');
 const snapshot=await transaction(c=>authorized(c,staffId,ticketId,attachmentId,key),pool);
 const envelope=await (options.storage??createChatMediaStorage()).get(snapshot.ref,options.signal);
 const bytes=openChatMedia(envelope,snapshot.ref,key);
 // No SQL transaction/connection spans storage HTTP; current authorization is checked again.
 const current=await transaction(c=>authorized(c,staffId,ticketId,attachmentId,key),pool);
 if(JSON.stringify(current)!==JSON.stringify(snapshot))throw new ChatMediaError('SOURCE_CHANGED');
 return {bytes,name:current.name,mimeType:current.ref.mimeType};
}
