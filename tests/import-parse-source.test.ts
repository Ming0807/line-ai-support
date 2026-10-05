import {expect,it} from 'vitest';
import {parseImportSource} from '../lib/imports/parse-source';
import {createImportSource} from '../lib/imports/source';
import {PACKAGE_REL_NS,REL_NS,SHEET_NS,WORD_NS,officeEntries,officeSource} from './fixtures/import-office';
const textSource=(filename:string,text:string)=>createImportSource({bytes:Buffer.from(text),filename,mimeType:'',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
it('runs actual supervised CSV and HTML parsers with validated provenance and measured output',async()=>{
 const csv=await parseImportSource(textSource('controlled.csv','รายการ,จำนวน\nค่าเทอม,001.230\n'));
 expect(csv.tables[0].rows[1][1]).toBe('001.230');expect(csv.locations.tables[0].kind).toBe('CSV');
 const html=await parseImportSource(textSource('controlled.html','<html><body><h1>การลงทะเบียน</h1><p>ขั้นตอนจากมหาวิทยาลัย</p></body></html>'));
 expect(html.pages.some(page=>page.text.includes('ขั้นตอนจากมหาวิทยาลัย'))).toBe(true);expect(html.locations.pages[0].kind).toBe('HTML');
},15000);
it('runs actual supervised Office parsers without treating ZIP containers as CSV',async()=>{
 const docx=await parseImportSource(officeSource('DOCX',officeEntries('DOCX',`<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>คู่มือมหาวิทยาลัย</w:t></w:r></w:p></w:body></w:document>`)));
 expect(docx.locations.pages[0].kind).toBe('DOCX');expect(docx.pages[0].pageNumber).toBeNull();
 const xlsx=await parseImportSource(officeSource('XLSX',officeEntries('XLSX',`<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="ค่าเทอม" sheetId="1" r:id="s"/></sheets></workbook>`,[
  {name:'xl/_rels/workbook.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="s" Type="${REL_NS}/worksheet" Target="worksheets/data.xml"/></Relationships>`},
  {name:'xl/worksheets/data.xml',data:`<worksheet xmlns="${SHEET_NS}"><sheetData><row r="7"><c r="C7"><v>001.23</v></c></row></sheetData></worksheet>`},
 ])));
 expect(xlsx.tables[0].rows).toEqual([['001.23']]);expect(xlsx.locations.tables[0]).toMatchObject({kind:'XLSX',rowStart:7,columnStart:3});
},15000);
it('returns a fixed error for malformed actual parser input and no raw child diagnostics',async()=>{
 await expect(parseImportSource(textSource('invalid.csv','"unterminated'))).rejects.toThrow(/^IMPORT_PARSER_FAILED$/);
 await expect(parseImportSource(textSource('valid.csv','a,b'),AbortSignal.abort())).rejects.toThrow(/^IMPORT_PARSER_ABORTED$/);
});
