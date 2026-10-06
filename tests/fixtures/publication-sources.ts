import {createImportSource} from '../../lib/imports/source';
import {officeEntries,officeSource,WORD_NS,SHEET_NS,REL_NS,PACKAGE_REL_NS} from './import-office';
import {createPdfFixture} from './import-pdf';
/** Synthetic, bounded, original-byte fixtures only; a nonce prevents unrelated import-checksum reuse. */
export function publicationSources(nonce:string){
 const bytes=(text:string)=>new TextEncoder().encode(text);
 const source=(data:Uint8Array,filename:string)=>createImportSource({bytes:data,filename,mimeType:'',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const paragraph=(text:string)=>`<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
 const docx=officeSource('DOCX',officeEntries('DOCX',`<w:document xmlns:w="${WORD_NS}"><w:body>${paragraph('Synthetic university service '+nonce)}${paragraph('ขั้นตอนการใช้บริการห้องสมุด '.repeat(60))}<w:tbl><w:tr><w:tc>${paragraph('บริการ')}</w:tc><w:tc>${paragraph('')}</w:tc></w:tr><w:tr><w:tc>${paragraph('ห้องสมุด')}</w:tc><w:tc>${paragraph('001.20')}</w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`));
 const xlsx=officeSource('XLSX',officeEntries('XLSX',`<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="บริการ" sheetId="1" r:id="s1"/></sheets></workbook>`,[
  {name:'xl/_rels/workbook.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="s1" Type="${REL_NS}/worksheet" Target="worksheets/data.xml"/></Relationships>`},
  {name:'xl/worksheets/data.xml',data:`<worksheet xmlns="${SHEET_NS}"><sheetData><row r="3"><c r="B3" t="inlineStr"><is><t>${nonce}</t></is></c><c r="D3"><v>001.20</v></c></row><row r="5"><c r="B5" t="inlineStr"><is><t>ห้องสมุด</t></is></c></row></sheetData></worksheet>`},
 ]));
 return [source(createPdfFixture([{lines:[{text:'Reviewed synthetic service '+nonce}],tables:[[['Service','Fee'],['Library','001.20']]]}]),'publication.pdf'),docx,xlsx,
  source(bytes(`บริการ,ค่าใช้จ่าย,หมายเหตุ\r\n${nonce},001.20,""\r\nห้องสมุด,,วันเปิดทำการ\r\n`),'publication.csv'),
  source(bytes(`<html><h1>Synthetic service ${nonce}</h1><p>${'ขั้นตอนการใช้บริการห้องสมุด '.repeat(60)}</p><table><tr><td>บริการ</td><td></td></tr><tr><td>ห้องสมุด</td><td>001.20</td></tr></table></html>`),'publication.html')];
}
