export interface IngressEvent { channel: 'STUDENT'|'STAFF'; eventId: string; userHash: string|null; payloadEncrypted: string; eventKind?:EventKind; }
export interface WebhookDependencies { channel: 'STUDENT'|'STAFF'; secret?: string; encryptionKey?: string; persist(events: IngressEvent[]): Promise<void>; maxBytes?: number; }
function fail(status:number,code:string):Response { return Response.json({ok:false,code},{status}); }
function object(value:unknown):Record<string,unknown>|null {
 return value!==null && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : null;
}
async function limitedBody(request:Request,maxBytes:number):Promise<Buffer|null> {
 if(!request.body) return Buffer.alloc(0);
 const reader=request.body.getReader();
 const chunks:Uint8Array[]=[];
 let size=0;
 try {
  for(;;){
   const {done,value}=await reader.read();
   if(done) break;
   size+=value.length;
   if(size>maxBytes){await reader.cancel();return null;}
   chunks.push(value);
  }
  return Buffer.concat(chunks);
 } finally {reader.releaseLock();}
}
export async function receiveLineWebhook(request:Request,dependencies:WebhookDependencies):Promise<Response> {
 const {secret,encryptionKey,channel,persist}=dependencies;
 if(!secret || !encryptionKey) return fail(503,'CHANNEL_NOT_CONFIGURED');
 let body:Buffer|null;
 try{body=await limitedBody(request,dependencies.maxBytes??1_048_576);}
 catch{return fail(400,'INVALID_BODY');}
 if(!body) return fail(413,'BODY_TOO_LARGE');
 if(!verifyLineSignature(body,request.headers.get('x-line-signature'),secret)) return fail(401,'INVALID_SIGNATURE');
 let envelope:Record<string,unknown>|null;
 try{envelope=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));}
 catch{return fail(400,'INVALID_JSON');}
 if(!envelope || !Array.isArray(envelope.events) || envelope.events.length>100) return fail(400,'INVALID_ENVELOPE');
 if(envelope.events.length===0) return Response.json({ok:true});
 try {
  const events:IngressEvent[]=envelope.events.map((event:unknown)=>{
   const data=object(event),source=object(data?.source);
   const json=JSON.stringify(event);
   return {channel,eventId:typeof data?.webhookEventId==='string' && data.webhookEventId.length>0
    ? data.webhookEventId : `malformed:${createHash('sha256').update(json).digest('hex')}`,
    userHash:source?.type==='user' && typeof source.userId==='string'?hashLineUserId(source.userId,encryptionKey):null,
    payloadEncrypted:encryptValue(json,encryptionKey),eventKind:classifyEventKind(event)};
  });
  await persist(events);
  console.info('LINE_INGRESS_ACCEPTED',{channel,eventCount:events.length});
  return Response.json({ok:true});
 } catch {
  console.error('LINE_INGRESS_FAILED',{channel,code:'INGRESS_TEMPORARILY_UNAVAILABLE'});
  return fail(503,'INGRESS_TEMPORARILY_UNAVAILABLE');
 }
}
import { createHash } from 'node:crypto';
import { encryptValue, hashLineUserId } from '../security/identity';
import { verifyLineSignature } from './signature';
import { classifyEventKind, type EventKind } from './events';
