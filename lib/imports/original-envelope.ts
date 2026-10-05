import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {verifyImportSource} from './source';
import {IMPORT_LIMITS,importFormats,type ImportSource,type OriginalRef} from './types';

export interface OriginalContext {jobId:string;id:string;backend:OriginalRef['backend']}
export interface EncryptedOriginal {ref:OriginalRef;envelope:Uint8Array}

const refSchema=z.object({id:z.uuid(),backend:z.enum(['PRIVATE_DATABASE','PRIVATE_STORAGE']),byteLength:z.number().int().min(1).max(IMPORT_LIMITS.originalBytes),
 format:z.enum(importFormats),checksum:z.string().regex(/^[a-f0-9]{64}$/),keyVersion:z.literal(1)}).strict();
const contextSchema=z.object({jobId:z.uuid(),id:z.uuid(),backend:z.enum(['PRIVATE_DATABASE','PRIVATE_STORAGE'])}).strict();
const header=Buffer.from([89,82,85,79,1]);
const overhead=header.length+12+16;
const invalid=():never=>{throw new Error('IMPORT_ORIGINAL_INVALID');};

function originalKey(encoded:string):Buffer {
 if(typeof encoded!=='string'||encoded.length!==44)throw new Error('INVALID_ENCRYPTION_KEY');
 const master=Buffer.from(encoded,'base64');
 if(master.length!==32||master.toString('base64')!==encoded)throw new Error('INVALID_ENCRYPTION_KEY');
 return Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','knowledge-original:v1',32));
}
function checkedRef(jobId:string,ref:OriginalRef):OriginalRef {
 const parsed=refSchema.safeParse(ref);
 if(!z.uuid().safeParse(jobId).success||!parsed.success)return invalid();
 return parsed.data;
}
function associatedData(jobId:string,ref:OriginalRef):Buffer {
 return Buffer.from(JSON.stringify(['yru:knowledge-original:v1',jobId,ref.id,ref.backend,ref.format,ref.byteLength,ref.checksum,ref.keyVersion]));
}

/** Binary envelope: fixed version header, 12-byte nonce, 16-byte tag, exact ciphertext. */
export function encryptOriginal(source:ImportSource,context:OriginalContext,key:string):EncryptedOriginal {
 const parsed=contextSchema.safeParse(context);if(!parsed.success)return invalid();
 let checked:ImportSource;try{checked=verifyImportSource(source);}catch{return invalid();}
 const ref:OriginalRef={id:parsed.data.id,backend:parsed.data.backend,byteLength:checked.bytes.byteLength,format:checked.format,checksum:checked.checksum,keyVersion:1};
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',originalKey(key),nonce);
 cipher.setAAD(associatedData(parsed.data.jobId,ref));
 const ciphertext=Buffer.concat([cipher.update(checked.bytes),cipher.final()]);
 return {ref,envelope:Buffer.concat([header,nonce,cipher.getAuthTag(),ciphertext])};
}

export function decryptOriginal(envelope:Uint8Array,jobId:string,reference:OriginalRef,key:string):Uint8Array {
 const ref=checkedRef(jobId,reference);
 if(!(envelope instanceof Uint8Array)||envelope.byteLength!==ref.byteLength+overhead)return invalid();
 const bytes=Buffer.from(envelope.buffer,envelope.byteOffset,envelope.byteLength);
 if(!bytes.subarray(0,header.length).equals(header))return invalid();
 const decipher=createDecipheriv('aes-256-gcm',originalKey(key),bytes.subarray(header.length,header.length+12));
 decipher.setAAD(associatedData(jobId,ref));decipher.setAuthTag(bytes.subarray(header.length+12,overhead));
 try{
  const original=Buffer.concat([decipher.update(bytes.subarray(overhead)),decipher.final()]);
  if(original.byteLength!==ref.byteLength||createHash('sha256').update(original).digest('hex')!==ref.checksum)return invalid();
  return original;
 }catch{return invalid();}
}
