import {createImportZipFixture,type ImportZipEntryFixture} from './import-zip';
import {createImportSource} from '../../lib/imports/source';
export const WORD_NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const SHEET_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PACKAGE_REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
export const CONTENT_NS='http://schemas.openxmlformats.org/package/2006/content-types';
const mainTypes={DOCX:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',XLSX:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'};
export function officeEntries(format:'DOCX'|'XLSX',main:string,extra:ImportZipEntryFixture[]=[],mainPath=format==='DOCX'?'word/document.xml':'xl/workbook.xml'):ImportZipEntryFixture[]{
 return [
  {name:'[Content_Types].xml',data:`<Types xmlns="${CONTENT_NS}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${mainPath}" ContentType="${mainTypes[format]}"/></Types>`},
  {name:'_rels/.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="root" Type="${REL_NS}/officeDocument" Target="${mainPath}"/></Relationships>`},
  {name:mainPath,data:main},...extra,
 ];
}
export function officeSource(format:'DOCX'|'XLSX',entries:ImportZipEntryFixture[]){
 return createImportSource({bytes:createImportZipFixture(entries),filename:`fixture.${format.toLowerCase()}`,mimeType:'',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
}
