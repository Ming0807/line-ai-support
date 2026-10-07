import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {z} from 'zod';
import {IMPORT_LIMITS,type ImportFormat,type ImportSource} from './types';
import {hasPublicImportQuery} from './url-query-policy';

const invalid=():never=>{throw new Error('IMPORT_SOURCE_INVALID');};
const inputSchema=z.object({bytes:z.instanceof(Uint8Array).refine(value=>value.byteLength>0&&value.byteLength<=IMPORT_LIMITS.originalBytes),
 filename:z.string().min(1).max(180).refine(value=>value.trim()===value&&!/[\\/\x00-\x1f\x7f]/.test(value)),
 mimeType:z.string().max(200),sourceUrl:z.string().max(2048).nullable(),acquiredFrom:z.enum(['UPLOAD','URL']),fetchedAt:z.iso.datetime({offset:true}).nullable(),
}).strict();
const mimes:Record<ImportFormat,string>={PDF:'application/pdf',DOCX:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 XLSX:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',CSV:'text/csv',HTML:'text/html'};
export function provenanceUrl(value:string):string{
 try{
  if(/\s|\\|[\x00-\x1f\x7f]/.test(value))return invalid();
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
   isIP(url.hostname)!==0||url.hostname.length>253||!url.hostname.includes('.')||
   url.hostname.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))||
   !hasPublicImportQuery(url))return invalid();
  return url.href;
 }catch{return invalid();}
}
export function isOfficialYruUrl(value:string):boolean{
 try{const hostname=new URL(provenanceUrl(value)).hostname;return hostname==='yru.ac.th'||hostname.endsWith('.yru.ac.th');}catch{return false;}
}
/** Container sniffing is preliminary; Office parsers must verify ZIP entries/format safely. */
export function createImportSource(input:unknown):ImportSource{
 const parsed=inputSchema.safeParse(input);if(!parsed.success)return invalid();const value=parsed.data;
 const suppliedMime=value.mimeType.split(';',1)[0].trim().toLowerCase();
 const extension=value.filename.split('.').at(-1)?.toLowerCase();
 const format:ImportFormat|undefined=extension==='pdf'?'PDF':extension==='docx'?'DOCX':extension==='xlsx'?'XLSX':extension==='csv'?'CSV':extension==='html'||extension==='htm'?'HTML':undefined;
 if(!format)return invalid();
 const generic=suppliedMime===''||suppliedMime==='application/octet-stream';
 const csvAlias=format==='CSV'&&['text/plain','application/csv','application/vnd.ms-excel'].includes(suppliedMime);
 if(!generic&&!csvAlias&&suppliedMime!==mimes[format])return invalid();
 const mimeType=mimes[format];
 const bytes=Uint8Array.from(value.bytes);
 if(format==='PDF'){
  if(bytes.length<5||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')return invalid();
 }else if(format==='DOCX'||format==='XLSX'){
  if(bytes.length<4||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)return invalid();
 }else{
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return invalid();}
  if(!text.trim()||text.includes('\u0000'))return invalid();
  if(format==='HTML'&&!/^\s*(?:<!doctype\s+html\b|<html\b|<(?:head|body|title|h[1-6]|p|table)\b)/i.test(text))return invalid();
 }
 const sourceUrl=value.sourceUrl===null?null:provenanceUrl(value.sourceUrl);
 if(value.acquiredFrom==='URL'&&(!sourceUrl||!isOfficialYruUrl(sourceUrl)||value.fetchedAt===null))return invalid();
 if(value.acquiredFrom==='UPLOAD'&&value.fetchedAt!==null)return invalid();
 return {bytes,format,filename:value.filename,mimeType,checksum:createHash('sha256').update(bytes).digest('hex'),sourceUrl,acquiredFrom:value.acquiredFrom,fetchedAt:value.fetchedAt};
}
export function verifyImportSource(source:ImportSource):ImportSource{
 const checked=createImportSource({bytes:source.bytes,filename:source.filename,mimeType:source.mimeType,sourceUrl:source.sourceUrl,acquiredFrom:source.acquiredFrom,fetchedAt:source.fetchedAt});
 if(checked.checksum!==source.checksum||checked.format!==source.format)return invalid();return checked;
}
