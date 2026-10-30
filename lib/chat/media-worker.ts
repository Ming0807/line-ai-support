import type {Pool} from 'pg';
import {ChatMediaError,inspectChatMedia,sealChatMedia,verifyChatMediaImage,type ChatMediaStorage} from './media-binary';
import {downloadLineChatMedia} from './media-line';
import {createChatMediaStorage} from './media-storage';
import {claimChatAttachment,failChatAttachment,finishChatAttachment} from './media-repository';
import {verifyChatMediaPdf} from './media-pdf';

export async function runChatMediaCycle(pool:Pool,key:string,options:{download?:(messageId:string)=>Promise<{bytes:Uint8Array;contentType:string}>;storage?:ChatMediaStorage}={}):Promise<{claimed:number;completed:number;failed:number}> {
 const result={claimed:0,completed:0,failed:0},claim=await claimChatAttachment(pool,key);if(!claim)return result;result.claimed=1;
 try{
  const downloaded=await (options.download??downloadLineChatMedia)(claim.source.lineMessageId);
  const inspected=inspectChatMedia(downloaded.bytes,downloaded.contentType,claim.kind,claim.source.declaredBytes);
  if(inspected.mimeType==='application/pdf')await verifyChatMediaPdf(downloaded.bytes);
  else await verifyChatMediaImage(downloaded.bytes,inspected.mimeType);
  const ref={attachmentId:claim.id,messageId:claim.messageId,sourceEventId:claim.sourceEventId,objectId:claim.leaseToken,...inspected};
  const envelope=sealChatMedia(downloaded.bytes,ref,key);
  await (options.storage??createChatMediaStorage()).put(ref,envelope);
  if(await finishChatAttachment(pool,claim,{ref},key))result.completed=1;else result.failed=1;
 }catch(error){
  result.failed=1;await failChatAttachment(pool,claim,error instanceof ChatMediaError?error.code:'UNAVAILABLE');
  console.warn('CHAT_MEDIA_PROCESSING_FAILED',{code:error instanceof ChatMediaError?error.code:'UNAVAILABLE'});
 }
 return result;
}
