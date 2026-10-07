import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {sourceLocationSchema} from '../imports/extraction';
import {canonicalDigest,copyStructuredJson,freezeStructuredData,isStructuredTransformCompatible,structuredTransforms} from '../imports/structured-mapping-contract';
import {transformStructuredCell} from '../imports/structured-transforms';
import {importFormats} from '../imports/types';
import {getStructuredRegistryEntry} from './structured-registry';
import {STRUCTURED_DATASETS,STRUCTURED_REGISTRY_VERSION,validateStructuredPayload} from './structured-payload';

const bytesLimit=1024*1024,envelopeLimit=1_398_200;
const invalid=():never=>{throw new Error('STRUCTURED_ROW_EVIDENCE_INVALID');};
const uuid=z.uuid().refine(value=>value===value.toLowerCase());
const revision=z.number().int().min(0).max(999_999_999),hash=z.string().regex(/^[a-f0-9]{64}$/u);
const contextSchema=z.object({
 schemaVersion:z.literal(1),registryVersion:z.literal(STRUCTURED_REGISTRY_VERSION),mapperVersion:z.literal('structured-mapper-v1'),
 dataset:z.enum(STRUCTURED_DATASETS),rowId:uuid,documentId:uuid,documentRevision:revision,jobId:uuid,jobRevision:revision,
 extractionRevision:revision.min(1),reviewRevision:revision.min(1),sourceFormat:z.enum(importFormats),
 sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:hash,planDigest:hash,
 tableIndex:z.number().int().min(0).max(999),rowIndex:z.number().int().min(0).max(9999),
 tableFirstRow:z.number().int().min(1).max(1_048_576),sourceRow:z.number().int().min(1).max(1_048_576),
 coordinateKind:z.enum(['WORKSHEET_CELL','CSV_RECORD','EXTRACTED_LOGICAL']),
}).strict();
type Context=z.infer<typeof contextSchema>;
const note=z.string().min(1).max(500).refine(value=>value.trim().length>0&&!/[\u0000-\u001F\u007F]/u.test(value));
const fieldName=z.string().min(1).max(80);
const cell=z.object({kind:z.literal('CELL'),field:fieldName,columnIndex:z.number().int().min(0).max(255),
 sourceColumn:z.number().int().min(1).max(16_384),extractedValue:z.string().max(10_000),
 transform:z.enum(structuredTransforms),blank:z.enum(['REJECT','NULL'])}).strict();
const constant=z.object({kind:z.literal('CONSTANT'),field:fieldName,value:z.union([z.string().max(5000),z.number(),z.null()]),note}).strict();
const evidenceSchema=z.object({schemaVersion:z.literal(1),payload:z.record(z.string(),z.unknown()),
 fields:z.array(z.discriminatedUnion('kind',[cell,constant])).min(1).max(32),sourceLocation:sourceLocationSchema,
 sourceUrl:z.url().max(2048).refine(value=>value.startsWith('https://')).nullable(),
}).strict();

function checkedContext(input:unknown):Context {
 const value=contextSchema.parse(copyStructuredJson(input,16*1024,256));
 const kind=value.sourceFormat==='XLSX'?'WORKSHEET_CELL':value.sourceFormat==='CSV'?'CSV_RECORD':'EXTRACTED_LOGICAL';
 if(value.sourceRow!==value.tableFirstRow+value.rowIndex||value.coordinateKind!==kind)return invalid();
 if(kind==='EXTRACTED_LOGICAL'&&(value.tableFirstRow>100_000||value.sourceRow>100_000))return invalid();
 return value;
}

function checkedEvidence(input:unknown,context:Context){
 const data=evidenceSchema.parse(copyStructuredJson(input,bytesLimit,4096)),location=data.sourceLocation;
 const payload:Record<string,unknown>=validateStructuredPayload(context.dataset,data.payload);
 if(canonicalDigest('structured-payload-v1',{dataset:context.dataset,payload})!==context.payloadDigest)return invalid();
 if(location.kind!==context.sourceFormat||location.tableIndex!==context.tableIndex+1)return invalid();
 if(location.kind==='HTML'&&location.sourceUrl!==data.sourceUrl)return invalid();
 const tabular=location.kind==='CSV'||location.kind==='XLSX';
 if(tabular&&(context.tableFirstRow!==location.rowStart||context.sourceRow>location.rowEnd))return invalid();
 const targets=getStructuredRegistryEntry(context.dataset).fields;
 if(data.fields.length!==targets.length||new Set(data.fields.map(field=>field.field)).size!==targets.length)return invalid();
 let sourceRequired=false;
 for(const target of targets){
  const field=data.fields.find(field=>field.field===target.name);if(!field)return invalid();
  let value:string|number|null;
  if(field.kind==='CELL'){
   if(!isStructuredTransformCompatible(field.transform,target.kind)||!target.nullable&&field.blank==='NULL')return invalid();
   const start=tabular?location.columnStart:1;
   if(field.sourceColumn!==start+field.columnIndex||tabular&&field.sourceColumn>location.columnEnd)return invalid();
   value=transformStructuredCell({kind:'COLUMN',columnIndex:field.columnIndex,transform:field.transform,blank:field.blank},field.extractedValue);
   if(!target.nullable)sourceRequired=true;
  }else value=field.value;
  if(value!==payload[target.name])return invalid();
 }
 if(!sourceRequired)return invalid();
 const evidence={...data,payload};
 if(Buffer.byteLength(JSON.stringify(evidence),'utf8')>bytesLimit)return invalid();
 return freezeStructuredData(evidence);
}

function derivedKey(encoded:string):Buffer {
 if(typeof encoded!=='string'||encoded.length!==44)return invalid();
 const master=Buffer.from(encoded,'base64');if(master.length!==32||master.toString('base64')!==encoded)return invalid();
 return Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','knowledge-structured-row-evidence:v1',32));
}
function aad(context:Context):Buffer{return Buffer.from(JSON.stringify(['yru:structured-row-evidence:v1',context]));}

/** Unused private component: authenticated content/context is not source, approval or live authorization proof. */
export function encryptStructuredRowEvidence(input:unknown,contextInput:unknown,key:string):string {
 try{
  const context=checkedContext(contextInput),evidence=checkedEvidence(input,context),nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',derivedKey(key),nonce);cipher.setAAD(aad(context));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(evidence),'utf8'),cipher.final()]);
  const envelope=['sr1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
  if(envelope.length>envelopeLimit)return invalid();return envelope;
 }catch{return invalid();}
}

/** Authenticate before JSON parsing; verify payload/source-cell consistency before returning detached frozen data. */
export function decryptStructuredRowEvidence(input:unknown,contextInput:unknown,key:string){
 try{
  const context=checkedContext(contextInput);
  if(typeof input!=='string'||input.length>envelopeLimit)return invalid();
  const parts=input.split('.');if(parts.length!==4||parts[0]!=='sr1'||parts.slice(1).some(part=>!/^[A-Za-z0-9_-]+$/u.test(part)))return invalid();
  const decoded=parts.slice(1).map(part=>Buffer.from(part,'base64url'));
  if(decoded.some((part,index)=>part.toString('base64url')!==parts[index+1])||decoded[0].length!==12||decoded[1].length!==16||decoded[2].length>bytesLimit)return invalid();
  const decipher=createDecipheriv('aes-256-gcm',derivedKey(key),decoded[0]);decipher.setAAD(aad(context));decipher.setAuthTag(decoded[1]);
  const plaintext=Buffer.concat([decipher.update(decoded[2]),decipher.final()]);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
  return checkedEvidence(JSON.parse(text),context);
 }catch{return invalid();}
}
