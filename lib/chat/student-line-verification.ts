import 'server-only';
import {z} from 'zod';
import {hashLineUserId} from '../security/identity';
import {chatMediaInterruptible,readChatMediaBody} from './media-line';

/** Server-only prerequisite: no caller-provided profile or decoded subject is trusted. */
export class StudentLineIdentityError extends Error {
 constructor(public readonly code:'INVALID_IDENTITY'|'UNAVAILABLE'){super(code);}
}
const claimsSchema=z.object({iss:z.literal('https://access.line.me'),sub:z.string().regex(/^U[0-9a-f]{32}$/u),
 aud:z.string(),iat:z.number().int().safe().positive(),exp:z.number().int().safe().positive()});
const url='https://api.line.me/oauth2/v2.1/verify';
type VerificationOptions={fetch?:typeof globalThis.fetch;signal?:AbortSignal;now?:()=>number;timeoutMs?:number};
async function verifyStudentLineIdToken(input:{token:string;channelId:string;key:string},
 options:VerificationOptions={}):Promise<{userHash:string;expiresAt:number}> {
 const timeout=options.timeoutMs??8000;
 if(!input||typeof input.token!=='string'||typeof input.channelId!=='string'||typeof input.key!=='string')throw new StudentLineIdentityError('INVALID_IDENTITY');
 const master=Buffer.from(input.key,'base64');
 if(input.token.length>8192||!/^[-A-Za-z0-9_]+(?:\.[-A-Za-z0-9_]+){2}$/u.test(input.token)||
  !/^\d{6,20}$/u.test(input.channelId)||master.length!==32||master.toString('base64')!==input.key||
  !Number.isInteger(timeout)||timeout<1||timeout>10000)throw new StudentLineIdentityError('INVALID_IDENTITY');
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeout);
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 try{
  if(controller.signal.aborted)throw new StudentLineIdentityError('UNAVAILABLE');
  const body=new URLSearchParams({id_token:input.token,client_id:input.channelId});
  const response=await chatMediaInterruptible((options.fetch??globalThis.fetch)(url,{method:'POST',
   headers:{'Content-Type':'application/x-www-form-urlencoded','Accept-Encoding':'identity'},body:body.toString(),
   redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal,
   late=>{void late.body?.cancel().catch(()=>undefined);});
  if(response.url&&response.url!==url||response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>undefined);throw new StudentLineIdentityError('UNAVAILABLE');}
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);throw new StudentLineIdentityError(response.status===400||response.status===401?'INVALID_IDENTITY':'UNAVAILABLE');}
  if(!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??'')){
   void response.body?.cancel().catch(()=>undefined);throw new StudentLineIdentityError('UNAVAILABLE');
  }
  const bytes=await readChatMediaBody(response,16384,controller.signal);let raw:unknown;
  try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new StudentLineIdentityError('UNAVAILABLE');}
  const parsed=claimsSchema.safeParse(raw),milliseconds=(options.now??Date.now)();
  if(!Number.isFinite(milliseconds))throw new StudentLineIdentityError('UNAVAILABLE');
  const seconds=Math.floor(milliseconds/1000);
  if(!parsed.success||parsed.data.aud!==input.channelId||parsed.data.exp<=seconds||parsed.data.iat>seconds+60||parsed.data.exp<=parsed.data.iat)
   throw new StudentLineIdentityError('INVALID_IDENTITY');
  return {userHash:hashLineUserId(parsed.data.sub,input.key),expiresAt:parsed.data.exp};
 }catch(error){if(error instanceof StudentLineIdentityError)throw error;throw new StudentLineIdentityError('UNAVAILABLE');}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.abort();}
}
/** Routes must use this gate; callers cannot choose another LINE channel or key. */
export async function verifyConfiguredStudentLineIdToken(token:string,options:VerificationOptions={}):Promise<{userHash:string;expiresAt:number}> {
 const channelId=process.env.LINE_STUDENT_LOGIN_CHANNEL_ID,key=process.env.ENCRYPTION_KEY;
 if(process.env.LINE_STUDENT_MEDIA_VIEWER_ENABLED!=='true'||process.env.LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED!=='true'||
  !channelId||!/^\d{6,20}$/u.test(channelId)||!key)throw new StudentLineIdentityError('UNAVAILABLE');
 const master=Buffer.from(key,'base64');
 if(master.length!==32||master.toString('base64')!==key)throw new StudentLineIdentityError('UNAVAILABLE');
 return verifyStudentLineIdToken({token,channelId,key},options);
}
