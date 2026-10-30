import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {ChatMediaError,CHAT_MEDIA_MAX_BYTES} from './media-binary';
import {readStaffChatAttachment} from './media-access';
const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'};
function error(code:string,status:number){return Response.json({error:code},{status,headers});}
export async function chatAttachmentHandler(request:Request,ticketId:string,attachmentId:string):Promise<Response> {
 try{
  const actor=await apiStaffId();if(!actor)return error('UNAUTHENTICATED',401);
  if(request.method!=='GET'||new URL(request.url).search||request.headers.has('range'))return error('INVALID_REQUEST',400);
  if(!z.uuid().safeParse(ticketId).success||!z.uuid().safeParse(attachmentId).success)return error('NOT_FOUND',404);
  const file=await readStaffChatAttachment(actor,ticketId,attachmentId,{signal:request.signal});
  if(file.bytes.length>CHAT_MEDIA_MAX_BYTES)throw new ChatMediaError('UNAVAILABLE');
  const encoded=encodeURIComponent(file.name).replace(/['()*]/gu,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Uint8Array(file.bytes).buffer,{headers:{...headers,'Content-Type':file.mimeType,'Content-Length':String(file.bytes.length),
   'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encoded}`}});
 }catch(failure){
  if(failure instanceof ChatMediaError){return error(failure.code,failure.code==='NOT_FOUND'?404:failure.code==='NOT_READY'?409:503);}
  console.error('CHAT_ATTACHMENT_READ_FAILED',{code:'UNAVAILABLE'});return error('UNAVAILABLE',503);
 }
}
