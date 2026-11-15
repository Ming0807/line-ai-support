import 'server-only';
import {z} from 'zod';
import {getDatabasePool} from '../database/pool';
import {isSameOrigin} from '../security/origin';
import {readBoundedBody} from '../security/request-body';
import {TicketError} from '../tickets/authorization';
import {apiStaffId} from '../tickets/api';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError,verifyChatMediaImage} from './media-binary';
import {verifyChatMediaPdf} from './media-pdf';
import {createStaffOutboundStorage} from './media-storage';
import {beginStaffOutboundUpload,finishStaffOutboundUpload,releaseStaffOutboundLease} from './staff-outbound-drafts';
import {uploadStaffOutboundAttachment,type StaffOutboundUploadDeps} from './staff-outbound-upload';

const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
function reply(body:unknown,status:number){return Response.json(body,{status,headers});}
const metadataSchema=z.strictObject({
 requestId:z.uuid(),revision:z.string().regex(/^\d{1,9}$/u).transform(Number),
 name:z.string().min(1).max(1080),checksum:z.string().regex(/^[a-f0-9]{64}$/u),
 contentType:z.enum(['application/pdf','image/jpeg','image/png']),length:z.string().regex(/^\d{1,10}$/u).transform(Number),
});
/** Lazy defaults: configuration, pool and Storage are resolved only when a step actually runs. */
function defaultDeps():StaffOutboundUploadDeps {
 const key=()=>{const value=process.env.ENCRYPTION_KEY;if(!value)throw new ChatMediaError('UNAVAILABLE');return value;};
 return {get key(){return key();},verifyPdf:verifyChatMediaPdf,verifyImage:verifyChatMediaImage,
  storage:{put:(ref,envelope)=>createStaffOutboundStorage().put(ref,envelope),get:(ref,signal)=>createStaffOutboundStorage().get(ref,signal)},
  begin:input=>beginStaffOutboundUpload(getDatabasePool(),input,key()),finish:input=>finishStaffOutboundUpload(getDatabasePool(),input,key()),
  release:input=>releaseStaffOutboundLease(getDatabasePool(),input)};
}

/**
 * POST /api/chat/tickets/[id]/outbound-attachments — CHAT-MEDIA-02E, hidden unless
 * CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED=true. The raw body is the file. Metadata travels in headers so
 * a cross-origin form cannot forge the request (custom headers force a CORS preflight), in addition
 * to the same-origin check. Content-Length and the SHA-256 header are mandatory because the Next
 * proxy buffers at most 10 MB and silently truncates larger bodies instead of failing.
 */
export async function staffOutboundUploadHandler(request:Request,ticketId:string):Promise<Response>{
 if(process.env.CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED!=='true')return reply({error:'NOT_FOUND'},404);
 if(!isSameOrigin(request))return reply({error:'INVALID_ORIGIN'},403);
 const staffId=await apiStaffId();if(!staffId)return reply({error:'UNAUTHENTICATED'},401);
 if(!z.uuid().safeParse(ticketId).success)return reply({error:'NOT_FOUND'},404);
 if(new URL(request.url).search)return reply({error:'INVALID_REQUEST'},400);
 const metadata=metadataSchema.safeParse({requestId:request.headers.get('x-yru-request-id'),revision:request.headers.get('x-yru-ticket-revision'),
  name:request.headers.get('x-yru-file-name'),checksum:request.headers.get('x-yru-content-sha256'),
  contentType:request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase(),length:request.headers.get('content-length')});
 if(!metadata.success)return reply({error:'INVALID_REQUEST'},400);
 let name:string;try{name=decodeURIComponent(metadata.data.name);}catch{return reply({error:'INVALID_REQUEST'},400);}
 if(metadata.data.length<1)return reply({error:'INVALID_REQUEST'},400);
 if(metadata.data.length>CHAT_MEDIA_MAX_BYTES)return reply({error:'TOO_LARGE'},413);
 try{
  const bytes=await readBoundedBody(request,CHAT_MEDIA_MAX_BYTES);
  if(!bytes)return reply({error:'TOO_LARGE'},413);
  if(bytes.length!==metadata.data.length)return reply({error:'INVALID_ATTACHMENT'},400);
  const result=await uploadStaffOutboundAttachment(defaultDeps(),{staffId,ticketId,requestId:metadata.data.requestId,revision:metadata.data.revision,
   name,contentType:metadata.data.contentType,declaredChecksum:metadata.data.checksum,bytes});
  return result.status==='READY'?reply({attachmentId:result.attachmentId,status:'READY'},201):reply({error:'DRAFT_FAILED',attachmentId:result.attachmentId},409);
 }catch(failure){
  if(failure instanceof ChatMediaError){
   const status=failure.code==='TOO_LARGE'?413:failure.code==='STALE_LEASE'?409:failure.code==='INVALID_ATTACHMENT'||failure.code==='UNSUPPORTED_TYPE'?400:503;
   return reply({error:status===503?'UNAVAILABLE':failure.code},status);
  }
  if(failure instanceof TicketError){
   const status=failure.code==='NOT_FOUND'?404:failure.code==='CONFLICT'?409:400;return reply({error:failure.code},status);
  }
  console.error('STAFF_OUTBOUND_UPLOAD_FAILED',{code:'UNAVAILABLE'});return reply({error:'UNAVAILABLE'},503);
 }
}
