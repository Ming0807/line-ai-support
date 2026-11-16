import 'server-only';
import type {Pool} from 'pg';
import {z} from 'zod';
import {authorizeScope,isSupervisor,loadActor,TicketError,type DbClient} from '../tickets/authorization';
import {staffOutboundRefSchema,type StaffOutboundRef} from './staff-outbound-binary';

/**
 * CHAT-MEDIA-02G (DEC-202): a delivered Staff file is viewable for this many days after LINE accepted the
 * message. Expiry only ends access; the private object and draft stay for a later audited retention policy.
 */
export const STUDENT_MEDIA_ACCESS_DAYS=30;
const hashPattern=/^[a-f0-9]{64}$/u;

/**
 * Read-only check used both before and after the Storage read. Access needs: a confirmed delivery whose
 * bound STAFF/STUDENT outbox row is SENT inside the access window, a READY draft, the verified hash equal to
 * both the confirmed recipient and the session's current identity, an active (followed) LINE session and no
 * revocation. A closed case does not withdraw a delivered file.
 */
export async function findStudentViewableAttachment(c:DbClient|Pick<Pool,'query'>,attachmentId:string,userHash:string):Promise<StaffOutboundRef|null>{
 if(!z.uuid().safeParse(attachmentId).success||attachmentId!==attachmentId.toLowerCase()||typeof userHash!=='string'||!hashPattern.test(userHash))return null;
 const row=(await c.query(`select a.id,a.object_id,a.ticket_id,a.mime_type,a.byte_length,a.checksum
  from private.staff_outbound_deliveries d
  join private.staff_outbound_attachments a on a.id=d.attachment_id and a.ticket_id=d.ticket_id and a.staff_id=d.staff_id
  join private.message_outbox o on o.id=d.outbox_id
  join private.line_identities i on i.line_session_id=a.line_session_id
  join public.line_sessions s on s.id=a.line_session_id
  where d.attachment_id=$1 and a.status='READY' and a.recipient_hash=$2 and i.user_hash=$2 and s.active
   and o.kind='STAFF' and o.channel='STUDENT' and o.status='SENT' and o.completed_at is not null
   and o.ticket_id=a.ticket_id and o.conversation_id=a.conversation_id and o.line_session_id=a.line_session_id
   and o.completed_at>clock_timestamp()-make_interval(days=>$3)
   and not exists(select 1 from private.staff_outbound_revocations r where r.attachment_id=d.attachment_id)`,
  [attachmentId,userHash,STUDENT_MEDIA_ACCESS_DAYS])).rows[0];
 if(!row)return null;
 const parsed=staffOutboundRefSchema.safeParse({attachmentId:row.id,objectId:row.object_id,ticketId:row.ticket_id,mimeType:row.mime_type,
  byteLength:row.byte_length,checksum:row.checksum});
 return parsed.success?parsed.data:null;
}

/**
 * Withdraws the Student's access to one confirmed file. Allowed for the sending Staff member, the current
 * assignee or a supervisor, each only within the case's department/sensitivity scope. Works on closed cases,
 * is idempotent and never deletes or rewrites the draft, delivery or private object.
 */
export async function revokeStaffOutboundDelivery(pool:Pool,input:{staffId:string;ticketId:string;attachmentId:string}):Promise<{attachmentId:string;revoked:true}>{
 if(![input.staffId,input.ticketId,input.attachmentId].every(value=>z.uuid().safeParse(value).success))throw new TicketError('NOT_FOUND');
 const c=await pool.connect();
 try{
  await c.query('begin');
  const actor=await loadActor(c,input.staffId);
  const row=(await c.query(`select d.staff_id,t.department_id,t.sensitive_level,t.assigned_staff_id
   from private.staff_outbound_deliveries d join public.tickets t on t.id=d.ticket_id
   where d.attachment_id=$1 and d.ticket_id=$2 for share of d`,[input.attachmentId,input.ticketId])).rows[0];
  if(!row)throw new TicketError('NOT_FOUND');
  await authorizeScope(c,row.department_id,row.sensitive_level);
  if(row.staff_id!==input.staffId&&row.assigned_staff_id!==input.staffId&&!isSupervisor(actor))throw new TicketError('NOT_FOUND');
  await c.query(`insert into private.staff_outbound_revocations(attachment_id,revoked_by) values($1,$2) on conflict(attachment_id) do nothing`,
   [input.attachmentId,input.staffId]);
  await c.query('commit');
  return {attachmentId:input.attachmentId,revoked:true};
 }catch(error){await c.query('rollback').catch(()=>undefined);throw error;}
 finally{c.release();}
}
