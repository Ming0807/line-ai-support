import 'server-only';
import {z} from 'zod';
import {getDatabasePool} from '../database/pool';
import {isSameOrigin} from '../security/origin';
import {readBoundedBody} from '../security/request-body';
import {createStaffOutboundStorage,type StaffOutboundStorage} from './media-storage';
import {openStaffOutbound,type StaffOutboundRef} from './staff-outbound-binary';
import {findStudentViewableAttachment} from './student-media-access';
import {StudentLineIdentityError,verifyConfiguredStudentLineIdToken} from './student-line-verification';
import {readStudentMediaLinkConfig} from './student-media-link';
import {createStudentMediaSession,openStudentMediaSession} from './student-media-session';

/**
 * CHAT-MEDIA-02G Student viewer. The LIFF page posts the raw LINE ID token once; the server verifies it with
 * LINE (02A), checks the SENT delivery to that exact recipient, and sets a five-minute cookie bound to one
 * attachment (02B). Byte requests re-check delivery/recipient/revocation before and after the Storage read.
 * Tokens, identity hashes and object paths are never logged or returned.
 */
export const STUDENT_MEDIA_COOKIE='__Host-yru-student-media';
export type StudentMediaViewerDeps={
 verify(token:string):Promise<{userHash:string;expiresAt:number}>;
 authorize(attachmentId:string,userHash:string):Promise<StaffOutboundRef|null>;
 storage:Pick<StaffOutboundStorage,'get'>;
 key:string|undefined;
 now():number;
};
function defaultDeps():StudentMediaViewerDeps{
 let storage:StaffOutboundStorage|null=null;
 return {verify:token=>verifyConfiguredStudentLineIdToken(token),
  authorize:(attachmentId,userHash)=>findStudentViewableAttachment(getDatabasePool(),attachmentId,userHash),
  storage:{get:(ref,signal)=>(storage??=createStaffOutboundStorage()).get(ref,signal)},
  key:process.env.ENCRYPTION_KEY,now:()=>Date.now()};
}

const privateHeaders={'Cache-Control':'private, no-store, max-age=0',Pragma:'no-cache',Vary:'Cookie','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
function reply(body:unknown,status:number,extra:Record<string,string>={}):Response{
 return Response.json(body,{status,headers:{...privateHeaders,...extra}});
}
const lowerUuid=z.uuid().refine(value=>value===value.toLowerCase());
const sessionBody=z.strictObject({attachmentId:lowerUuid,idToken:z.string().min(1).max(8192)});
const MAX_SESSION_BODY=10240;

/** Hidden unless every 02A/02F viewer gate is configured, so the route and the LINE link appear together. */
function viewerEnabled(deps:StudentMediaViewerDeps):boolean{
 return readStudentMediaLinkConfig(process.env)!==null&&typeof deps.key==='string'&&deps.key.length>0;
}
function kindOf(ref:StaffOutboundRef):'PDF'|'IMAGE'{return ref.mimeType==='application/pdf'?'PDF':'IMAGE';}
function fail(code:string):void{console.error('STUDENT_MEDIA_VIEW_FAILED',{code});}

/** POST /api/student/media/session */
export async function studentMediaSessionHandler(request:Request,deps:StudentMediaViewerDeps=defaultDeps()):Promise<Response>{
 if(!viewerEnabled(deps))return reply({error:'NOT_FOUND'},404);
 if(!isSameOrigin(request))return reply({error:'INVALID_ORIGIN'},403);
 if(new URL(request.url).search)return reply({error:'INVALID_REQUEST'},400);
 if(!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type')??''))return reply({error:'INVALID_REQUEST'},400);
 const bytes=await readBoundedBody(request,MAX_SESSION_BODY).catch(()=>new Uint8Array());
 if(!bytes)return reply({error:'TOO_LARGE'},413);
 let json:unknown;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply({error:'INVALID_REQUEST'},400);}
 const body=sessionBody.safeParse(json);if(!body.success)return reply({error:'INVALID_REQUEST'},400);
 let identity:{userHash:string;expiresAt:number};
 try{identity=await deps.verify(body.data.idToken);}
 catch(error){
  if(error instanceof StudentLineIdentityError&&error.code==='INVALID_IDENTITY')return reply({error:'UNAUTHENTICATED'},401);
  fail('LINE_VERIFY_UNAVAILABLE');return reply({error:'UNAVAILABLE'},503);
 }
 try{
  const ref=await deps.authorize(body.data.attachmentId,identity.userHash);
  if(!ref||ref.attachmentId!==body.data.attachmentId)return reply({error:'NOT_FOUND'},404);
  const now=Math.floor(deps.now()/1000);
  let session:string;
  try{session=createStudentMediaSession({attachmentId:ref.attachmentId,userHash:identity.userHash,identityExpiresAt:identity.expiresAt},deps.key!,now);}
  catch{return reply({error:'UNAUTHENTICATED'},401);}
  const maxAge=Math.min(300,identity.expiresAt-now);
  const cookie=`${STUDENT_MEDIA_COOKIE}=${session}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
  return reply({attachmentId:ref.attachmentId,kind:kindOf(ref),byteLength:ref.byteLength},200,{'Set-Cookie':cookie});
 }catch{fail('SESSION_UNAVAILABLE');return reply({error:'UNAVAILABLE'},503);}
}

function readCookie(request:Request):string|null{
 const header=request.headers.get('cookie');if(!header)return null;
 for(const part of header.split(';')){
  const index=part.indexOf('=');if(index<0)continue;
  if(part.slice(0,index).trim()===STUDENT_MEDIA_COOKIE)return part.slice(index+1).trim();
 }
 return null;
}
function sameRef(a:StaffOutboundRef,b:StaffOutboundRef|null):boolean{
 return !!b&&a.attachmentId===b.attachmentId&&a.objectId===b.objectId&&a.ticketId===b.ticketId&&a.mimeType===b.mimeType&&
  a.byteLength===b.byteLength&&a.checksum===b.checksum;
}
const extension={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'} as const;

/** GET /api/student/media/[attachmentId] */
export async function studentMediaFileHandler(request:Request,attachmentId:string,deps:StudentMediaViewerDeps=defaultDeps()):Promise<Response>{
 if(!viewerEnabled(deps))return reply({error:'NOT_FOUND'},404);
 if(!lowerUuid.safeParse(attachmentId).success)return reply({error:'NOT_FOUND'},404);
 if(new URL(request.url).search)return reply({error:'INVALID_REQUEST'},400);
 const site=request.headers.get('sec-fetch-site');
 if(site&&site!=='same-origin'&&site!=='none')return reply({error:'INVALID_ORIGIN'},403);
 const value=readCookie(request);if(!value)return reply({error:'UNAUTHENTICATED'},401);
 let userHash:string;
 try{userHash=openStudentMediaSession(value,attachmentId,deps.key!,Math.floor(deps.now()/1000)).userHash;}
 catch{return reply({error:'UNAUTHENTICATED'},401);}
 try{
  const ref=await deps.authorize(attachmentId,userHash);
  if(!ref||ref.attachmentId!==attachmentId)return reply({error:'NOT_FOUND'},404);
  const bytes=openStaffOutbound(await deps.storage.get(ref,request.signal),ref,deps.key!);
  // Revocation, unfollow, identity change or expiry during the Storage read wins over the bytes already read.
  if(!sameRef(ref,await deps.authorize(attachmentId,userHash)))return reply({error:'NOT_FOUND'},404);
  const kind=kindOf(ref),name=`yru-${kind==='PDF'?'file':'image'}.${extension[ref.mimeType]}`;
  return new Response(new Uint8Array(bytes),{status:200,headers:{...privateHeaders,'Content-Type':ref.mimeType,'Content-Length':String(bytes.length),
   'Content-Disposition':`${kind==='PDF'?'attachment':'inline'}; filename="${name}"`,
   'Content-Security-Policy':"default-src 'none'; img-src 'self'; sandbox"}});
 }catch{fail('FILE_UNAVAILABLE');return reply({error:'UNAVAILABLE'},503);}
}
