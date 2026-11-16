import 'server-only';
import {z} from 'zod';
import {getDatabasePool} from '../database/pool';
import {isSameOrigin} from '../security/origin';
import {readBoundedBody} from '../security/request-body';
import {TicketError} from '../tickets/authorization';
import {apiStaffId} from '../tickets/api';
import {revokeStaffOutboundDelivery} from './student-media-access';

const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
function reply(body:unknown,status:number){return Response.json(body,{status,headers});}
const emptyBody=z.strictObject({});

/**
 * POST /api/chat/tickets/[id]/outbound-attachments/[attachmentId]/revoke — CHAT-MEDIA-02G (DEC-202). Hidden with
 * the confirmation flag. Withdraws the Student viewer's access; it does not unsend the LINE text or delete data.
 */
export async function staffOutboundRevokeHandler(request:Request,ticketId:string,attachmentId:string):Promise<Response>{
 if(process.env.CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED!=='true')return reply({error:'NOT_FOUND'},404);
 if(!isSameOrigin(request))return reply({error:'INVALID_ORIGIN'},403);
 const staffId=await apiStaffId();if(!staffId)return reply({error:'UNAUTHENTICATED'},401);
 if(!z.uuid().safeParse(ticketId).success||!z.uuid().safeParse(attachmentId).success)return reply({error:'NOT_FOUND'},404);
 if(new URL(request.url).search)return reply({error:'INVALID_REQUEST'},400);
 try{
  const bytes=await readBoundedBody(request,256);
  if(!bytes)return reply({error:'TOO_LARGE'},413);
  if(bytes.length){
   let json:unknown;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply({error:'INVALID_REQUEST'},400);}
   if(!emptyBody.safeParse(json).success)return reply({error:'INVALID_REQUEST'},400);
  }
  return reply(await revokeStaffOutboundDelivery(getDatabasePool(),{staffId,ticketId,attachmentId}),200);
 }catch(failure){
  if(failure instanceof TicketError){
   const status=failure.code==='NOT_FOUND'?404:failure.code==='INVALID_REQUEST'?400:409;return reply({error:failure.code},status);
  }
  console.error('STAFF_OUTBOUND_REVOKE_FAILED',{code:'UNAVAILABLE'});return reply({error:'UNAVAILABLE'},503);
 }
}
