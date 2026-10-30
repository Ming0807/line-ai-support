import {fileURLToPath} from 'node:url';
import {executeParserChild} from '../imports/parser-process';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError} from './media-binary';

/** Structural PDF validation only; no text extraction, rendering, URLs or model calls. */
export async function verifyChatMediaPdf(bytes:Uint8Array):Promise<void> {
 if(!(bytes instanceof Uint8Array)||!bytes.length)throw new ChatMediaError('INVALID_ATTACHMENT');
 if(bytes.length>CHAT_MEDIA_MAX_BYTES)throw new ChatMediaError('TOO_LARGE');
 try{
  const result=await executeParserChild(bytes,{scriptPath:fileURLToPath(new URL('../../scripts/chat-media-pdf-child.ts',import.meta.url)),loadTsx:true,timeoutMs:10000});
  if(result!=='PDF_VALID')throw new ChatMediaError('INVALID_ATTACHMENT');
 }catch{throw new ChatMediaError('INVALID_ATTACHMENT');}
}
