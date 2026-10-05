import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';

export interface StagingContext {jobId:string;checksum:string;revision:number;purpose:'SOURCE_METADATA'|'EXTRACTION'|'ANALYSIS'|'REVIEW'}
const contextSchema=z.object({jobId:z.uuid(),checksum:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().min(0).max(1_000_000_000),
 purpose:z.enum(['SOURCE_METADATA','EXTRACTION','ANALYSIS','REVIEW'])}).strict();
const limits={SOURCE_METADATA:32_768,EXTRACTION:32*1024*1024,ANALYSIS:65_536,REVIEW:1024*1024} as const;
const invalid=():never=>{throw new Error('IMPORT_STAGING_INVALID');};
function checkedContext(context:StagingContext):StagingContext {
 const parsed=contextSchema.safeParse(context);if(!parsed.success)return invalid();return parsed.data;
}
function stagingKey(encoded:string,purpose:StagingContext['purpose']):Buffer {
 if(typeof encoded!=='string'||encoded.length!==44)throw new Error('INVALID_ENCRYPTION_KEY');
 const master=Buffer.from(encoded,'base64');if(master.length!==32||master.toString('base64')!==encoded)throw new Error('INVALID_ENCRYPTION_KEY');
 return Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1',`knowledge-staging:v1:${purpose}`,32));
}
function aad(context:StagingContext):Buffer {
 return Buffer.from(JSON.stringify(['yru:knowledge-staging:v1',context.jobId,context.checksum,context.revision,context.purpose]));
}
export function encryptStagingValue(value:string,input:StagingContext,key:string):string {
 const context=checkedContext(input);if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>limits[context.purpose])return invalid();
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',stagingKey(key,context.purpose),nonce);cipher.setAAD(aad(context));
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return ['v1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptStagingValue(value:string,input:StagingContext,key:string):string {
 const context=checkedContext(input);
 if(typeof value!=='string'||value.length>Math.ceil(limits[context.purpose]/3)*4+100)return invalid();
 const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1'||parts.slice(1).some(part=>!/^[A-Za-z0-9_-]*$/.test(part)))return invalid();
 const decoded=parts.slice(1).map(part=>Buffer.from(part,'base64url'));
 if(decoded.some((part,index)=>part.toString('base64url')!==parts[index+1])||decoded[0].length!==12||decoded[1].length!==16||decoded[2].length>limits[context.purpose])return invalid();
 const decipher=createDecipheriv('aes-256-gcm',stagingKey(key,context.purpose),decoded[0]);decipher.setAAD(aad(context));decipher.setAuthTag(decoded[1]);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat([decipher.update(decoded[2]),decipher.final()]));}catch{return invalid();}
}
