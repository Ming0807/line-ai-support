import {randomBytes} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {decryptStagingValue,encryptStagingValue,type StagingContext} from '../lib/imports/staging-envelope';
const key=randomBytes(32).toString('base64'),context:StagingContext={jobId:'11111111-1111-4111-8111-111111111111',checksum:'a'.repeat(64),revision:0,purpose:'SOURCE_METADATA'};
describe('private staged value envelope',()=>{
 it('preserves staged Thai JSON without plaintext and uses fresh nonces',()=>{
  const value=JSON.stringify({filename:'คู่มือ.csv',sourceUrl:'https://library.yru.ac.th/guide'}),first=encryptStagingValue(value,context,key);
  expect(first).not.toContain('filename');expect(first).not.toEqual(encryptStagingValue(value,context,key));
  expect(decryptStagingValue(first,context,key)).toBe(value);
 });
 it.each([{jobId:'22222222-2222-4222-8222-222222222222'},{checksum:'b'.repeat(64)},{revision:1},{purpose:'EXTRACTION' as const}])('rejects cross-job/content/revision/purpose substitution %j',change=>{
  const encrypted=encryptStagingValue('private fixture',context,key);
  expect(()=>decryptStagingValue(encrypted,{...context,...change},key)).toThrow(/^IMPORT_STAGING_INVALID$/);
 });
 it('rejects tampering and wrong keys with a fixed error',()=>{
  const encrypted=encryptStagingValue('private fixture',context,key),parts=encrypted.split('.');parts[3]=Buffer.from('tampered').toString('base64url');
  expect(()=>decryptStagingValue(parts.join('.'),context,key)).toThrow(/^IMPORT_STAGING_INVALID$/);
  expect(()=>decryptStagingValue(encrypted,context,randomBytes(32).toString('base64'))).toThrow(/^IMPORT_STAGING_INVALID$/);
 });
 it('rejects malformed envelopes, context and noncanonical keys',()=>{
  for(const value of ['','v2.a.b.c','v1.a.b.c','v1.AA=.AA.AA'])expect(()=>decryptStagingValue(value,context,key)).toThrow(/^IMPORT_STAGING_INVALID$/);
  expect(()=>encryptStagingValue('x',{...context,revision:-1},key)).toThrow(/^IMPORT_STAGING_INVALID$/);
  expect(()=>encryptStagingValue('x',context,'weak')).toThrow(/^INVALID_ENCRYPTION_KEY$/);
 });
});
