import 'server-only';
import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';

const dataSchema=z.strictObject({attachmentId:z.uuid().refine(value=>value===value.toLowerCase()),
 userHash:z.string().regex(/^[a-f0-9]{64}$/u),issuedAt:z.number().int().safe().positive(),expiresAt:z.number().int().safe().positive()});
const aad=Buffer.from('yru:student-media-session:v1');
const invalid=():never=>{throw new Error('INVALID_STUDENT_MEDIA_SESSION');};
function material(key:string):Buffer {
 if(typeof key!=='string')return invalid();const master=Buffer.from(key,'base64');
 if(master.length!==32||master.toString('base64')!==key)return invalid();
 return Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','student-media-session:v1',32));
}
/** Only verified server-side identity may be supplied; subsequent access still requires a DB authorization check. */
export function createStudentMediaSession(input:{attachmentId:string;userHash:string;identityExpiresAt:number},key:string,now=Math.floor(Date.now()/1000)):string {
 if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(input?.identityExpiresAt)||input.identityExpiresAt<=now)return invalid();
 const expiresAt=Math.min(now+300,input.identityExpiresAt),parsed=dataSchema.safeParse({attachmentId:input.attachmentId,userHash:input.userHash,issuedAt:now,expiresAt});
 if(!parsed.success)return invalid();
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',material(key),nonce);cipher.setAAD(aad);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(parsed.data),'utf8'),cipher.final()]);
 return ['v1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
/** Decryption verifies the identity envelope, not case ownership, revocation, or delivery permission. */
export function openStudentMediaSession(value:string,attachmentId:string,key:string,now=Math.floor(Date.now()/1000)):{userHash:string;expiresAt:number} {
 try{
  if(typeof value!=='string'||value.length>1024||!Number.isSafeInteger(now)||now<=0)return invalid();
  const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1'||parts.slice(1).some(part=>!/^[A-Za-z0-9_-]+$/u.test(part)))return invalid();
  const bytes=parts.slice(1).map(part=>Buffer.from(part,'base64url'));
  if(bytes.some((part,index)=>part.toString('base64url')!==parts[index+1])||bytes[0].length!==12||bytes[1].length!==16)return invalid();
  const decipher=createDecipheriv('aes-256-gcm',material(key),bytes[0]);decipher.setAAD(aad);decipher.setAuthTag(bytes[1]);
  const parsed=dataSchema.safeParse(JSON.parse(Buffer.concat([decipher.update(bytes[2]),decipher.final()]).toString('utf8')));
  if(!parsed.success||parsed.data.attachmentId!==attachmentId||parsed.data.issuedAt>now||parsed.data.expiresAt<=now||
   parsed.data.expiresAt<=parsed.data.issuedAt||parsed.data.expiresAt-parsed.data.issuedAt>300)return invalid();
  return {userHash:parsed.data.userHash,expiresAt:parsed.data.expiresAt};
 }catch{return invalid();}
}
