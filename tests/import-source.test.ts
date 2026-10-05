import {expect,it} from 'vitest';
import {createImportSource,isOfficialYruUrl} from '../lib/imports/source';
const bytes=(text:string)=>new TextEncoder().encode(text);
const input={bytes:bytes('หัวข้อ,วันที่\nลงทะเบียน,2569'),filename:'calendar.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD' as const,fetchedAt:null};
it('identifies supported source formats without pretending ZIP validates an Office document',()=>{
 expect(createImportSource(input)).toMatchObject({format:'CSV',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 expect(createImportSource({...input,bytes:bytes('%PDF-1.7\nfixture'),filename:'rules.pdf',mimeType:'application/pdf'}).format).toBe('PDF');
 expect(createImportSource({...input,bytes:bytes('<!doctype html><html><h1>คู่มือ</h1></html>'),filename:'guide.html',mimeType:'text/html'}).format).toBe('HTML');
 for(const [filename,mimeType,format] of [['rules.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','DOCX'],['calendar.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','XLSX']]){
  expect(createImportSource({...input,filename,mimeType,bytes:new Uint8Array([80,75,3,4,1])}).format).toBe(format);
 }
});
it('auto-detects supported upload bytes when a browser supplies empty/generic or legacy CSV media type',()=>{
 for(const mimeType of ['', 'application/octet-stream','text/plain','application/vnd.ms-excel'])expect(createImportSource({...input,mimeType}).mimeType).toBe('text/csv');
});
it('copies immutable original bytes and computes SHA256 of exactly the original including UTF8 BOM',()=>{
 const original=bytes('\ufeffหัวข้อ,วันที่');const result=createImportSource({...input,bytes:original});
 const snapshot=result.bytes[0];original[0]=0;expect(result.bytes[0]).toBe(snapshot);expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
 expect(result.checksum).not.toBe(createImportSource({...input,bytes:bytes('หัวข้อ,วันที่')}).checksum);
});
it('rejects canonicalizing numeric hostnames or malformed FQDN labels as reviewed provenance',()=>{
 for(const sourceUrl of ['https://127.1/a','https://-bad.yru.ac.th/a','https://bad-.yru.ac.th/a'])expect(()=>createImportSource({...input,sourceUrl})).toThrow('IMPORT_SOURCE_INVALID');
});
it.each([
 {filename:'../secret.csv'},{filename:'C:\\private\\secret.csv'},{filename:'bad\u0000.csv'},
 {filename:'legacy.doc',mimeType:'application/msword'},{filename:'calendar.csv',mimeType:'application/pdf'},
 {bytes:bytes('not a PDF'),filename:'rules.pdf',mimeType:'application/pdf'},
 {bytes:new Uint8Array()},{bytes:new Uint8Array([0xff,0xfe])},
 {bytes:new Uint8Array(20*1024*1024+1)},
])('rejects unsafe/mismatched/empty/oversized originals %#',change=>{
 expect(()=>createImportSource({...input,...change})).toThrow('IMPORT_SOURCE_INVALID');
});
it('requires official URL acquisition provenance without using its fetch time as a content date',()=>{
 const result=createImportSource({...input,acquiredFrom:'URL',sourceUrl:'https://acdservice.yru.ac.th/calendar.csv',fetchedAt:'2026-10-05T08:00:00.000Z'});
 expect(result.fetchedAt).toBe('2026-10-05T08:00:00.000Z');expect(result).not.toHaveProperty('effectiveFrom');
 for(const sourceUrl of [null,'http://yru.ac.th/a','https://yru.ac.th.evil.com/a','https://127.0.0.1/a','https://user:pass@yru.ac.th/a','https://yru.ac.th:444/a','https://yru.ac.th/a?token=secret']){
  expect(()=>createImportSource({...input,acquiredFrom:'URL',sourceUrl,fetchedAt:'2026-10-05T08:00:00.000Z'})).toThrow('IMPORT_SOURCE_INVALID');
 }
 expect(()=>createImportSource({...input,acquiredFrom:'URL',sourceUrl:'https://yru.ac.th/a',fetchedAt:null})).toThrow('IMPORT_SOURCE_INVALID');
});
it('allows missing/external uploaded provenance only as staged metadata, with official suffix boundaries',()=>{
 expect(createImportSource({...input,sourceUrl:'https://drive.google.com/file/d/fixture/view?usp=sharing'}).sourceUrl).toContain('drive.google.com');
 expect(isOfficialYruUrl('https://library.yru.ac.th/guide')).toBe(true);expect(isOfficialYruUrl('https://yru.ac.th.evil.com/guide')).toBe(false);
 expect(isOfficialYruUrl('https://fake-yru.ac.th/guide')).toBe(false);
});
