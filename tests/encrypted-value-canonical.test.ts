import {expect,it} from 'vitest';
import {decryptValue,encryptValue} from '@/lib/security/identity';
const key=Buffer.alloc(32,79).toString('base64');
it('rejects a noncanonical auth-tag encoding even if its decoded bytes equal the authentic tag',()=>{
 const encrypted=encryptValue('complete reviewed message',key),parts=encrypted.split('.');
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const tag=parts[2],alias=tag.slice(0,-1)+alphabet[alphabet.indexOf(tag.at(-1)!)+1];
 expect(Buffer.from(alias,'base64url').equals(Buffer.from(tag,'base64url'))).toBe(true);
 parts[2]=alias;expect(()=>decryptValue(parts.join('.'),key)).toThrow('INVALID_ENCRYPTED_VALUE');
});
it('retains complete Unicode and empty plaintext with canonical encryption',()=>{
 for(const text of ['', 'คำตอบครบถ้วน 👩🏽‍💻\n'.repeat(1000)])expect(decryptValue(encryptValue(text,key),key)).toBe(text);
});
