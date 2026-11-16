import 'server-only';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {TicketError} from '../tickets/authorization';
import {applyStaffAttachmentReply} from '../tickets/ticket-service';
import {currentStaffOutboundScope,matchesStaffOutboundRecipient} from './staff-outbound-drafts';
import {staffAttachmentMessageText,studentMediaViewerUrl,type StudentMediaLinkConfig} from './student-media-link';

export const staffOutboundConfirmInputSchema=z.strictObject({
 staffId:z.uuid(),ticketId:z.uuid(),attachmentId:z.uuid(),requestId:z.uuid(),
 revision:z.number().int().min(0).max(999_999_999),ticketNo:z.string().regex(/^YRU-\d{8}$/u),
});
export type StaffOutboundConfirmInput=z.input<typeof staffOutboundConfirmInputSchema>;
export type StaffOutboundConfirmResult={attachmentId:string;messageId:string;status:string;revision:number};

function requestHash(value:{attachmentId:string;revision:number;ticketNo:string}):string{
 return createHash('sha256').update(JSON.stringify(['staff-outbound-confirm:v1',value.attachmentId,value.revision,value.ticketNo])).digest('hex');
}

/**
 * CHAT-MEDIA-02F. The Staff member who uploaded a READY draft explicitly confirms it for the case's current
 * recipient at the ticket revision they are looking at. In ONE transaction: the STAFF_REPLY locks and
 * eligibility, the draft's recipient/session/conversation/assignment must still equal the case's current
 * ones (no retargeting; an intervening revision is re-reviewed by this explicit confirmation), the existing
 * STAFF_REPLY transition writes the message, history, receipt, delivery guard/case and outbox, and an
 * append-only delivery row binds draft→message→outbox. Only a text LIFF link is sent; no LINE or Storage
 * call happens here. Delivery truth stays the outbox status.
 */
export async function confirmStaffOutboundAttachment(pool:Pool,input:StaffOutboundConfirmInput,key:string,link:StudentMediaLinkConfig):Promise<StaffOutboundConfirmResult>{
 const parsed=staffOutboundConfirmInputSchema.safeParse(input);if(!parsed.success)throw new TicketError('INVALID_REQUEST');
 const value=parsed.data,hash=requestHash(value);
 return transaction(async c=>{
  // Delivery rows are append-only, so a replay is answered before the (now advanced) revision is checked.
  const prior=(await c.query(`select attachment_id,request_hash,result from private.staff_outbound_deliveries
   where staff_id=$1 and ticket_id=$2 and request_id=$3`,[value.staffId,value.ticketId,value.requestId])).rows[0];
  if(prior){if(prior.attachment_id!==value.attachmentId||prior.request_hash!==hash)throw new TicketError('CONFLICT');return prior.result as StaffOutboundConfirmResult;}
  const scope=await currentStaffOutboundScope(c,value.staffId,value.ticketId,value.revision);
  const ticket=(await c.query('select ticket_no from public.tickets where id=$1',[value.ticketId])).rows[0];
  if(!ticket||ticket.ticket_no!==value.ticketNo)throw new TicketError('CONFLICT');
  const draft=(await c.query(`select * from private.staff_outbound_attachments where id=$1 and ticket_id=$2 for update`,[value.attachmentId,value.ticketId])).rows[0];
  if(!draft||draft.staff_id!==value.staffId)throw new TicketError('NOT_FOUND');
  if(draft.status!=='READY'||!matchesStaffOutboundRecipient(draft,scope))throw new TicketError('CONFLICT');
  if((await c.query('select 1 from private.staff_outbound_deliveries where attachment_id=$1',[value.attachmentId])).rowCount)throw new TicketError('CONFLICT');
  const text=staffAttachmentMessageText(draft.mime_type,studentMediaViewerUrl(link.liffId,value.attachmentId));
  const applied=await applyStaffAttachmentReply(c,value.staffId,value.ticketId,{requestId:value.requestId,revision:value.revision,text},key);
  if(!applied.messageId)throw new TicketError('CONFLICT');
  const outbox=(await c.query('select id from private.message_outbox where idempotency_key=$1',[`staff-reply:${value.ticketId}:${applied.messageId}`])).rows[0];
  if(!outbox)throw new TicketError('CONFLICT');
  const result:StaffOutboundConfirmResult={attachmentId:value.attachmentId,messageId:applied.messageId,status:applied.result.status,revision:applied.result.revision};
  await c.query(`insert into private.staff_outbound_deliveries(attachment_id,staff_id,ticket_id,request_id,request_hash,message_id,outbox_id,confirmed_revision,result)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[value.attachmentId,value.staffId,value.ticketId,value.requestId,hash,applied.messageId,outbox.id,value.revision,result]);
  return result;
 },pool);
}
