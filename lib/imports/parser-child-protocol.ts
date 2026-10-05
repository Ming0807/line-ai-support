import {z} from 'zod';
import {IMPORT_LIMITS,importFormats,type ImportSource} from './types';
import {createImportSource,verifyImportSource} from './source';
const invalid=():never=>{throw new Error('IMPORT_PARSE_INVALID');};
const metadataSchema=z.object({format:z.enum(importFormats),checksum:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().min(1).max(IMPORT_LIMITS.originalBytes),
 filename:z.string().min(1).max(180),mimeType:z.string().max(200),sourceUrl:z.string().max(2048).nullable(),acquiredFrom:z.enum(['UPLOAD','URL']),fetchedAt:z.string().max(100).nullable()}).strict();
export function encodeParserRequest(source:ImportSource):Uint8Array{
 try{
  const verified=verifyImportSource(source),header=Buffer.from(JSON.stringify({format:verified.format,checksum:verified.checksum,byteLength:verified.bytes.length,
   filename:verified.filename,mimeType:verified.mimeType,sourceUrl:verified.sourceUrl,acquiredFrom:verified.acquiredFrom,fetchedAt:verified.fetchedAt})+'\n');
  if(header.length>8192)return invalid();return Buffer.concat([header,verified.bytes]);
 }catch{return invalid();}
}
export function decodeParserRequest(input:Uint8Array):ImportSource{
 try{
  if(!(input instanceof Uint8Array)||input.length>IMPORT_LIMITS.originalBytes+8192)return invalid();
  const index=input.subarray(0,8192).indexOf(10);if(index<1)return invalid();
  const metadata=metadataSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.subarray(0,index))));
  const raw=input.subarray(index+1);if(raw.length!==metadata.byteLength)return invalid();
  const source=createImportSource({bytes:raw,filename:metadata.filename,mimeType:metadata.mimeType,sourceUrl:metadata.sourceUrl,acquiredFrom:metadata.acquiredFrom,fetchedAt:metadata.fetchedAt});
  if(source.format!==metadata.format||source.checksum!==metadata.checksum)return invalid();return source;
 }catch{return invalid();}
}
