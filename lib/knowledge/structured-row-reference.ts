import {z} from 'zod';
import {sourceLocationSchema} from '../imports/extraction';
import {canonicalDigest,copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {STRUCTURED_DATASETS,STRUCTURED_REGISTRY_VERSION,validateStructuredPayload} from './structured-payload';
import {ruleProofSchema} from './rule-proof';

export class StructuredRowReferenceError extends Error {
 constructor(){super('STRUCTURED_ROW_REFERENCE_INVALID');this.name='StructuredRowReferenceError';}
}
const uuid=z.uuid().refine(value=>value===value.toLowerCase());
const revision=z.number().int().min(0).max(999_999_999),hash=z.string().regex(/^[a-f0-9]{64}$/u);
const schema=z.object({
 schemaVersion:z.literal(1),dataset:z.enum(STRUCTURED_DATASETS),registryVersion:z.literal(STRUCTURED_REGISTRY_VERSION),mapperVersion:z.literal('structured-mapper-v1'),
 rowId:uuid,documentId:uuid,documentRevision:revision,jobId:uuid,jobRevision:revision,extractionRevision:revision.min(1),reviewRevision:revision.min(1),
 sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:hash,planDigest:hash,
 tableIndex:z.number().int().min(0).max(999),rowIndex:z.number().int().min(0).max(9999),tableFirstRow:z.number().int().min(1).max(1_048_576),sourceRow:z.number().int().min(1).max(1_048_576),
 coordinateKind:z.enum(['WORKSHEET_CELL','CSV_RECORD','EXTRACTED_LOGICAL']),sourceLocation:sourceLocationSchema,ruleProof:ruleProofSchema,
}).strict();
export type StructuredRowReference=z.infer<typeof schema>;
function parse(input:unknown):StructuredRowReference {
 try{
  const value=schema.parse(copyStructuredJson(input,32*1024,256)),location=value.sourceLocation;
  if(location.tableIndex!==value.tableIndex+1||value.sourceRow!==value.tableFirstRow+value.rowIndex)throw new StructuredRowReferenceError();
  const kind=location.kind==='XLSX'?'WORKSHEET_CELL':location.kind==='CSV'?'CSV_RECORD':'EXTRACTED_LOGICAL';
  if(value.coordinateKind!==kind)throw new StructuredRowReferenceError();
  if(location.kind==='XLSX'||location.kind==='CSV'){
   if(value.tableFirstRow!==location.rowStart||value.sourceRow>location.rowEnd)throw new StructuredRowReferenceError();
  }else if(value.tableFirstRow>100_000||value.sourceRow>100_000)throw new StructuredRowReferenceError();
  return freezeStructuredData(value);
 }catch{throw new StructuredRowReferenceError();}
}
/** Internal consistency only: neither a permission token nor proof of live persisted provenance. */
export function validateStructuredRowReference(input:unknown,payloadInput:unknown):StructuredRowReference {
 try{
  const value=parse(input),payload=validateStructuredPayload(value.dataset,copyStructuredJson(payloadInput,64*1024,256));
  if(canonicalDigest('structured-payload-v1',{dataset:value.dataset,payload})!==value.payloadDigest)throw new StructuredRowReferenceError();
  return value;
 }catch{throw new StructuredRowReferenceError();}
}
/** Compare strictly shaped references. Live retrieval/finalization must re-read the underlying rows. */
export function structuredRowReferencesEqual(left:unknown,right:unknown):boolean {
 try{return canonicalDigest('structured-row-reference-v1',parse(left))===canonicalDigest('structured-row-reference-v1',parse(right));}catch{return false;}
}
