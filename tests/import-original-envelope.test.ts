import {randomBytes} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {decryptOriginal,encryptOriginal} from '../lib/imports/original-envelope';
import {createImportSource} from '../lib/imports/source';
import type {OriginalRef} from '../lib/imports/types';

const source=createImportSource({bytes:Buffer.from('\ufeffหัวข้อ,ข้อความ\r\nคู่มือ,ข้อมูลต้นฉบับ\r\n'),filename:'original.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
const context={jobId:'11111111-1111-4111-8111-111111111111',id:'22222222-2222-4222-8222-222222222222',backend:'PRIVATE_DATABASE' as const};
const key=randomBytes(32).toString('base64');
const otherId='33333333-3333-4333-8333-333333333333';

describe('immutable private original envelope',()=>{
 it('preserves exact original bytes including BOM and line endings with an opaque reference',()=>{
  const encrypted=encryptOriginal(source,context,key);
  expect(encrypted.ref).toEqual({id:context.id,backend:'PRIVATE_DATABASE',byteLength:source.bytes.byteLength,format:'CSV',checksum:source.checksum,keyVersion:1});
  expect(Buffer.from(decryptOriginal(encrypted.envelope,context.jobId,encrypted.ref,key))).toEqual(Buffer.from(source.bytes));
  expect(Buffer.from(encrypted.envelope).includes(Buffer.from(source.bytes))).toBe(false);
  expect(Object.keys(encrypted.ref).sort()).toEqual(['backend','byteLength','checksum','format','id','keyVersion']);
 });
 it('uses fresh nonces while preserving the immutable content checksum',()=>{
  const first=encryptOriginal(source,context,key),second=encryptOriginal(source,context,key);
  expect(first.envelope).not.toEqual(second.envelope);expect(first.ref).toEqual(second.ref);
 });
 it('authenticates the import job identity',()=>{
  const encrypted=encryptOriginal(source,context,key);
  expect(()=>decryptOriginal(encrypted.envelope,otherId,encrypted.ref,key)).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
 });
 it.each([
  {id:otherId},{backend:'PRIVATE_STORAGE'}, {format:'PDF'}, {byteLength:source.bytes.byteLength+1}, {checksum:'0'.repeat(64)},
 ])('rejects a substituted immutable reference %j',change=>{
  const encrypted=encryptOriginal(source,context,key);
  expect(()=>decryptOriginal(encrypted.envelope,context.jobId,{...encrypted.ref,...change} as OriginalRef,key)).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
 });
 it('rejects another key without exposing authentication details',()=>{
  const encrypted=encryptOriginal(source,context,key);
  expect(()=>decryptOriginal(encrypted.envelope,context.jobId,encrypted.ref,randomBytes(32).toString('base64'))).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
 });
 it('rejects modified header, nonce, tag and ciphertext',()=>{
  const encrypted=encryptOriginal(source,context,key);
  for(const index of [0,4,5,17,encrypted.envelope.length-1]){
   const changed=Uint8Array.from(encrypted.envelope);changed[index]^=1;
   expect(()=>decryptOriginal(changed,context.jobId,encrypted.ref,key)).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
  }
 });
 it('rejects truncated and extended envelopes',()=>{
  const encrypted=encryptOriginal(source,context,key);
  for(const changed of [encrypted.envelope.subarray(0,20),encrypted.envelope.subarray(0,-1),Buffer.concat([encrypted.envelope,Buffer.from([0])])]){
   expect(()=>decryptOriginal(changed,context.jobId,encrypted.ref,key)).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
  }
 });
 it('rejects invalid references and unsupported key versions',()=>{
  const encrypted=encryptOriginal(source,context,key);
  for(const change of [{id:'not-a-uuid'},{checksum:'A'.repeat(64)},{byteLength:0},{byteLength:20*1024*1024+1},{keyVersion:2},{publicUrl:'https://example.com/original'}]){
   expect(()=>decryptOriginal(encrypted.envelope,context.jobId,{...encrypted.ref,...change} as OriginalRef,key)).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
  }
 });
 it('rejects a changed source before creating encrypted original bytes',()=>{
  expect(()=>encryptOriginal({...source,checksum:'0'.repeat(64)},context,key)).toThrow(/^IMPORT_ORIGINAL_INVALID$/);
 });
 it.each(['weak',Buffer.alloc(31).toString('base64'),key.replace(/=+$/,'')])('rejects malformed or noncanonical encryption keys',invalidKey=>{
  expect(()=>encryptOriginal(source,context,invalidKey)).toThrow(/^INVALID_ENCRYPTION_KEY$/);
 });
});
