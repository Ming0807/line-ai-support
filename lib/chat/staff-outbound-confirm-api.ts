import 'server-only';
import {z} from 'zod';
import {getDatabasePool} from '../database/pool';
import {isSameOrigin} from '../security/origin';
import {readBoundedBody} from '../security/request-body';
import {TicketError} from '../tickets/authorization';
import {apiStaffId} from '../tickets/api';
import {confirmStaffOutboundAttachment} from './staff-outbound-confirm';
import {readStudentMediaLinkConfig} from './student-media-link';

const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
function reply(body:unknown,status:number){return Response.json(body,{status,headers});}
const MAX_BODY=2048;
// Recipient, session and conversation are never accepted from the client; strict rejects extra keys.
const bodySchema=z.strictObject({requestId:z.uuid(),revision:z.number().int().min(0).max(999_999_999),ticketNo:z.string().regex(/^YRU-\d{8}$/u)});

/**
 * POST /api/chat/tickets/[id]/outbound-attachments/[attachmentId]/confirm — CHAT-MEDIA-02F, hidden unless
 * CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED=true, and unavailable until the 02A Student viewer gates and a LIFF ID
 * of that Login channel are configured, so a link is never sent to a viewer that cannot verify the recipient.
 */
export async function staffOutboundConfirmHandler(request:Request,ticketId:string,attachmentId:string):Promise<Response>{
 if(process.env.CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED!=='true')return reply({error:'NOT_FOUND'},404);
 if(!isSameOrigin(request))return reply({error:'INVALID_ORIGIN'},403);
 const staffId=await apiStaffId();if(!staffId)return reply({error:'UNAUTHENTICATED'},401);
 if(!z.uuid().safeParse(ticketId).success||!z.uuid().safeParse(attachmentId).success)return reply({error:'NOT_FOUND'},404);
 if(new URL(request.url).search)return reply({error:'INVALID_REQUEST'},400);
 const link=readStudentMediaLinkConfig(),key=process.env.ENCRYPTION_KEY;
 if(!link||!key)return reply({error:'UNAVAILABLE'},503);
 try{
  const bytes=await readBoundedBody(request,MAX_BODY);
  if(!bytes)return reply({error:'TOO_LARGE'},413);
  let json:unknown;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply({error:'INVALID_REQUEST'},400);}
  const body=bodySchema.safeParse(json);if(!body.success)return reply({error:'INVALID_REQUEST'},400);
  const result=await confirmStaffOutboundAttachment(getDatabasePool(),{staffId,ticketId,attachmentId,...body.data},key,link);
  return reply(result,200);
 }catch(failure){
  if(failure instanceof TicketError){
   const status=failure.code==='NOT_FOUND'?404:failure.code==='INVALID_REQUEST'?400:409;return reply({error:failure.code},status);
  }
  console.error('STAFF_OUTBOUND_CONFIRM_FAILED',{code:'UNAVAILABLE'});return reply({error:'UNAVAILABLE'},503);
 }
}
