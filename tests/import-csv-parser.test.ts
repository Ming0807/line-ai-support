import {expect,it} from 'vitest';
import {parseCsvSource} from '../lib/imports/csv-parser';
import {createImportSource} from '../lib/imports/source';
import {analyzeExtraction} from '../lib/imports/analyzer';
const csv=(text:string)=>createImportSource({bytes:new TextEncoder().encode(text),filename:'academic calendar.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
it('preserves exact quoted cells, comma, escaped quote, embedded CRLF and blank cells with original row provenance',()=>{
 const source=csv('\ufeffหัวข้อ,วัน,หมายเหตุ\r\n"ลงทะเบียน,ภาคปกติ",2569,"คำว่า ""วัน""\r\nบรรทัดสอง"\r\nค่าธรรมเนียม,1000,\r\n');
 const result=parseCsvSource(source);
 expect(result.tables[0]).toMatchObject({pageNumber:null,sheetName:null,firstRow:1,rows:[['หัวข้อ','วัน','หมายเหตุ'],['ลงทะเบียน,ภาคปกติ','2569','คำว่า "วัน"\r\nบรรทัดสอง'],['ค่าธรรมเนียม','1000','']]});
 expect(result.pages[0]).toMatchObject({pageNumber:null,text:''});expect(analyzeExtraction(source,result)).toMatchObject({reviewStatus:'PENDING_REVIEW',approved:false});
});
it('keeps suspicious formulas as literal strings and requires review without evaluating them',()=>{
 const result=parseCsvSource(csv('name,value\nfee,=SUM(A1:A2)\nlink,"@HYPERLINK(""x"")"'));
 expect(result.flags).toContain('FORMULAS_PRESENT');expect(result.tables[0].rows[1][1]).toBe('=SUM(A1:A2)');
});
it('preserves ragged rows but explicitly marks their quality warning',()=>{
 const result=parseCsvSource(csv('a,b\nonly one\n1,2,3'));expect(result.flags).toContain('TABLE_SHAPE_REVIEW');expect(result.tables[0].rows[1]).toEqual(['only one']);
});
it.each(['"unterminated,b','a,"closed"trailer','a,unquoted"quote','a,"line\nnever closes'])('rejects malformed quote boundaries with fixed errors %#',text=>{
 expect(()=>parseCsvSource(csv(text))).toThrow('IMPORT_PARSE_INVALID');
});
it('enforces cell/column/row/total character limits during parsing before unbounded output',()=>{
 for(const text of ['x'.repeat(10_001),Array(257).fill('x').join(','),Array(10_001).fill('x').join('\n'),'a'.repeat(5_000_001)])expect(()=>parseCsvSource(csv(text))).toThrow('IMPORT_PARSE_INVALID');
 expect(()=>parseCsvSource(csv(Array(5001).fill(Array(20).fill('x').join(',')).join('\n')))).toThrow('IMPORT_PARSE_INVALID');
});
it('never treats PDF bytes as CSV and checks the original checksum again',()=>{
 const pdf=createImportSource({bytes:new TextEncoder().encode('%PDF-1.7\nfixture'),filename:'a.pdf',mimeType:'application/pdf',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 expect(()=>parseCsvSource(pdf)).toThrow('IMPORT_PARSE_INVALID');
 const changed=csv('a,b');changed.bytes[0]=0;expect(()=>parseCsvSource(changed)).toThrow('IMPORT_PARSE_INVALID');
});
