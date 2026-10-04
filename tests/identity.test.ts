import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptValue, encryptValue, hashLineUserId } from '../lib/security/identity';

describe('protected LINE identifiers', () => {
 const key = randomBytes(32).toString('base64');
 it('roundtrips Thai text and IDs without storing plaintext, with fresh nonces', () => {
  const text='U-user-123 ข้อความ';
  const first=encryptValue(text,key), second=encryptValue(text,key);
  expect(first).not.toContain(text);
  expect(first).not.toEqual(second);
  expect(decryptValue(first,key)).toBe(text);
 });
 it('rejects a changed ciphertext and a wrong key', () => {
  const encrypted=encryptValue('private',key);
  const parts=encrypted.split('.');
  parts[3]=Buffer.from('tampered').toString('base64url');
  expect(()=>decryptValue(parts.join('.'),key)).toThrow();
  expect(()=>decryptValue(encrypted,randomBytes(32).toString('base64'))).toThrow();
 });
 it('indexes consistently without using a public unsalted hash', () => {
  expect(hashLineUserId('U123',key)).toEqual(hashLineUserId('U123',key));
  expect(hashLineUserId('U123',key)).not.toEqual(hashLineUserId('U124',key));
  expect(hashLineUserId('U123',key)).not.toEqual(hashLineUserId('U123',randomBytes(32).toString('base64')));
 });
 it('rejects malformed keys and encrypted envelopes', () => {
  expect(()=>encryptValue('value','weak')).toThrow();
  expect(()=>decryptValue('v1.invalid',key)).toThrow();
 });
});
