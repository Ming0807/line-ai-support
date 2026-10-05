import {IMPORT_LIMITS,type LocatedExtraction} from '../lib/imports/types';
import {decodeParserRequest} from '../lib/imports/parser-child-protocol';
// Libraries cannot emit extracted data or diagnostics into the result protocol.
console.log=()=>{};console.info=()=>{};console.warn=()=>{};console.error=()=>{};console.debug=()=>{};
try{
 const chunks:Buffer[]=[];let length=0;
 for await(const value of process.stdin){
  const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);length+=chunk.length;
  if(length>IMPORT_LIMITS.originalBytes+8192)throw new Error('IMPORT_PARSE_INVALID');chunks.push(chunk);
 }
 const source=decodeParserRequest(Buffer.concat(chunks,length));let extraction:LocatedExtraction;
 switch(source.format){
  case 'CSV':extraction=(await import('../lib/imports/csv-parser')).parseCsvSource(source);break;
  case 'HTML':extraction=(await import('../lib/imports/html-parser')).parseHtmlSource(source);break;
  case 'DOCX':extraction=await(await import('../lib/imports/docx-parser')).parseDocxSource(source);break;
  case 'XLSX':extraction=await(await import('../lib/imports/xlsx-parser')).parseXlsxSource(source);break;
  case 'PDF':extraction=await(await import('../lib/imports/pdf-parser')).parsePdfSource(source);break;
 }
 const result=JSON.stringify({schemaVersion:1,extraction});if(Buffer.byteLength(result)>32*1024*1024)throw new Error('IMPORT_PARSE_INVALID');
 process.stdout.write(result);
}catch{
 process.stdout.write('{"error":"IMPORT_PARSE_INVALID"}');process.exitCode=1;
}
