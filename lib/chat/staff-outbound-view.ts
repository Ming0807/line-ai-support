import type {Pool,PoolClient} from 'pg';
import {decryptValue} from '../security/identity';
import {readStudentMediaLinkConfig} from './student-media-link';
import type {OutboundAttachmentView,StudentAttachmentAccess} from '../../types/inbox';

/**
 * CHAT-MEDIA-02G (DEC-202): a delivered Staff file is viewable for this many days after LINE accepted the
 * message. Expiry only ends access; the private object and draft stay for a later audited retention policy.
 * Lives here (no 'server-only') so the Staff thread read and the Student viewer share one window.
 */
export const STUDENT_MEDIA_ACCESS_DAYS=30;

type Env=Record<string,string|undefined>;

/**
 * CHAT-MEDIA-02H (DEC-205): the Inbox attach control is offered only when upload, confirmation and the
 * complete Student viewer configuration (02A gates, same-channel LIFF ID, encryption key) are all set, so
 * Staff never prepares a file the Student cannot open.
 */
export function staffOutboundFilesEnabled(env:Env=process.env):boolean{
 return env.CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED==='true'&&env.CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED==='true'&&
  readStudentMediaLinkConfig(env)!==null&&typeof env.ENCRYPTION_KEY==='string'&&env.ENCRYPTION_KEY.length>0;
}

/**
 * Student-side state as the Staff thread shows it. Mirrors findStudentViewableAttachment: only SENT inside
 * the access window and not revoked is AVAILABLE. RETRY/UNKNOWN are still in the outbox's hands, so they are
 * shown as waiting; an unknown status fails closed as not delivered.
 */
export function studentAttachmentAccess(input:{outboxStatus:string;withinWindow:boolean;revoked:boolean}):StudentAttachmentAccess{
 if(input.revoked)return 'REVOKED';
 switch(input.outboxStatus){
  case 'PENDING':case 'PROCESSING':case 'RETRY':case 'UNKNOWN':return 'WAITING_DELIVERY';
  case 'SENT':return input.withinWindow?'AVAILABLE':'EXPIRED';
  default:return 'NOT_DELIVERED';
 }
}

/**
 * Same rule as revokeStaffOutboundDelivery (sender, current assignee or supervisor; department/sensitivity
 * scope is already enforced by the thread read), false once revoked or while the revoke route is hidden.
 */
export function canRevokeStaffOutbound(input:{revoked:boolean;revokeEnabled:boolean;actorId:string;actorSupervisor:boolean;senderId:string;assigneeId:string|null}):boolean{
 if(input.revoked||!input.revokeEnabled)return false;
 return input.actorId===input.senderId||(input.assigneeId!==null&&input.actorId===input.assigneeId)||input.actorSupervisor;
}

const mimeTypes=new Set(['application/pdf','image/jpeg','image/png']);

/**
 * Confirmed outbound files for the given messages of one already-authorized ticket, keyed by the confirming
 * STAFF message. The file name is decrypted for Staff only; the LIFF link is never derived from message text.
 */
export async function outboundAttachmentsForMessages(c:PoolClient|Pick<Pool,'query'>,input:{ticketId:string;messageIds:string[];actorId:string;
 actorSupervisor:boolean;assigneeId:string|null;revokeEnabled:boolean;key:string|undefined}):Promise<Map<string,OutboundAttachmentView>>{
 const result=new Map<string,OutboundAttachmentView>();
 if(!input.messageIds.length)return result;
 const rows=(await c.query(`select d.message_id,a.id,a.name_encrypted,a.mime_type,a.byte_length,d.staff_id,o.status outbox_status,
  (o.status='SENT' and o.completed_at is not null and o.completed_at>clock_timestamp()-make_interval(days=>$3)) within_window,
  exists(select 1 from private.staff_outbound_revocations r where r.attachment_id=d.attachment_id) revoked
  from private.staff_outbound_deliveries d
  join private.staff_outbound_attachments a on a.id=d.attachment_id and a.ticket_id=d.ticket_id and a.staff_id=d.staff_id
  join public.messages m on m.id=d.message_id and m.ticket_id=d.ticket_id and m.sender_type='STAFF'
  join private.message_outbox o on o.id=d.outbox_id
  where d.ticket_id=$1 and d.message_id=any($2::uuid[])`,[input.ticketId,input.messageIds,STUDENT_MEDIA_ACCESS_DAYS])).rows;
 if(!rows.length)return result;
 if(!input.key)throw new Error('ENCRYPTION_NOT_CONFIGURED');
 for(const row of rows){
  const size=Number(row.byte_length);
  if(!mimeTypes.has(row.mime_type)||!Number.isSafeInteger(size)||size<1)continue;
  const revoked=row.revoked===true;
  result.set(row.message_id,{id:row.id,name:decryptValue(row.name_encrypted,input.key),mimeType:row.mime_type,size,
   studentAccess:studentAttachmentAccess({outboxStatus:String(row.outbox_status),withinWindow:row.within_window===true,revoked}),
   canRevoke:canRevokeStaffOutbound({revoked,revokeEnabled:input.revokeEnabled,actorId:input.actorId,actorSupervisor:input.actorSupervisor,
    senderId:row.staff_id,assigneeId:input.assigneeId})});
 }
 return result;
}
