import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

function deriveKey(encoded:string,purpose:string):Buffer {
 const master=Buffer.from(encoded,'base64');
 if(master.length!==32 || master.toString('base64')!==encoded) throw new Error('INVALID_ENCRYPTION_KEY');
 return Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1',purpose,32));
}
export function encryptValue(value:string,key:string):string {
 const nonce=randomBytes(12);
 const cipher=createCipheriv('aes-256-gcm',deriveKey(key,'encryption'),nonce);
 cipher.setAAD(Buffer.from('yru:v1'));
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return ['v1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptValue(value:string,key:string):string {
 const parts=value.split('.');
 if(parts.length!==4 || parts[0]!=='v1' || parts.slice(1).some(p=>!/^[A-Za-z0-9_-]*$/.test(p))) throw new Error('INVALID_ENCRYPTED_VALUE');
 const nonce=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[2],'base64url');
 if(nonce.length!==12 || tag.length!==16) throw new Error('INVALID_ENCRYPTED_VALUE');
 const decipher=createDecipheriv('aes-256-gcm',deriveKey(key,'encryption'),nonce);
 decipher.setAAD(Buffer.from('yru:v1'));
 decipher.setAuthTag(tag);
 try{return Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8');}
 catch{throw new Error('INVALID_ENCRYPTED_VALUE');}
}
export function hashLineUserId(value:string,key:string):string {
 return createHmac('sha256',deriveKey(key,'identity-index')).update(value).digest('hex');
}
