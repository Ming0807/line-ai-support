import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {encryptValue,decryptValue} from '../security/identity';

export const LINE_STAFF_FLOW_COOKIE='yru-staff-line-flow';
export const LINE_STAFF_FLOW_SECONDS=600;
const requestSchema=z.strictObject({mode:z.enum(['signin','link']),next:z.enum(['/staff/apply','/staff/application','/dashboard'])});
export type LineFlowRequest=z.infer<typeof requestSchema>;
const inputSchema=requestSchema.extend({userId:z.uuid().nullable(),pkceFlowId:z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/u).nullable().optional()}).refine(v=>v.mode==='link'?v.userId!==null:v.userId===null);
const cookieSchema=inputSchema.extend({purpose:z.literal('STAFF_LINE_LOGIN'),version:z.literal(1),
 nonce:z.string().regex(/^[A-Za-z0-9_-]{22}$/u),issuedAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 expiresAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export type LineFlowCookie=Pick<z.infer<typeof cookieSchema>,'mode'|'next'|'userId'|'nonce'|'issuedAt'|'expiresAt'|'pkceFlowId'>;

export function parseLineFlowRequest(params:URLSearchParams):LineFlowRequest|null{
 if([...params.keys()].some(key=>!['mode','next'].includes(key)||params.getAll(key).length!==1))return null;
 const parsed=requestSchema.safeParse({mode:params.get('mode')??'signin',next:params.get('next')??'/staff/apply'});
 return parsed.success?parsed.data:null;
}

/** This cookie stores intent only. Supabase still owns PKCE/code validation; it grants no role. */
export function createLineFlowCookie(input:{mode:'signin'|'link';next:string;userId:string|null;pkceFlowId?:string|null},key:string,now:number):string{
 const parsed=inputSchema.safeParse(input);
 if(!parsed.success||!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-LINE_STAFF_FLOW_SECONDS*1000)throw new Error('STAFF_LINE_FLOW_INVALID');
 return encryptValue(JSON.stringify({...parsed.data,purpose:'STAFF_LINE_LOGIN',version:1,nonce:randomBytes(16).toString('base64url'),
  issuedAt:now,expiresAt:now+LINE_STAFF_FLOW_SECONDS*1000}),key);
}

export function readLineFlowCookie(value:string,key:string,now:number):LineFlowCookie|null{
 try{
  if(typeof value!=='string'||value.length>4096||!Number.isSafeInteger(now)||now<0)return null;
  const parsed=cookieSchema.safeParse(JSON.parse(decryptValue(value,key)));
  if(!parsed.success)return null;const v=parsed.data;
  if(v.mode==='link'?!v.userId:v.userId!==null)return null;
  if(v.expiresAt-v.issuedAt!==LINE_STAFF_FLOW_SECONDS*1000||now<v.issuedAt||now>=v.expiresAt)return null;
  return {mode:v.mode,next:v.next,userId:v.userId,nonce:v.nonce,issuedAt:v.issuedAt,expiresAt:v.expiresAt,
   ...(v.pkceFlowId===undefined?{}:{pkceFlowId:v.pkceFlowId})};
 }catch{return null;}
}

export function trustedLineCallbackUrl(value:string):string|null{
 try{
  if(!value||value!==value.trim()||/[\p{Cc}]/u.test(value))return null;
  const base=new URL(value);
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||
   !(base.protocol==='https:'||base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))return null;
  return new URL('/auth/callback',base.origin).toString();
 }catch{return null;}
}
