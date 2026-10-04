import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifyLineSignature(body:Uint8Array,signature:string|null,secret:string):boolean {
 if(!signature || !secret || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
 const actual=Buffer.from(signature,'base64');
 const expected=createHmac('sha256',secret).update(body).digest();
 return actual.length===expected.length && timingSafeEqual(actual,expected);
}
