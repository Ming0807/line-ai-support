import {createHash} from 'node:crypto';
import {types as nativeTypes} from 'node:util';
import {z} from 'zod';
import {getStructuredRegistryEntry,type StructuredFieldKind} from '../knowledge/structured-registry';
import {STRUCTURED_DATASETS,STRUCTURED_REGISTRY_VERSION,structuredPayloadSchemas,type StructuredDataset,type StructuredPayloads} from '../knowledge/structured-payload';
import type {ImportFormat,SourceLocation,ExtractionWarning} from './types';

export const STRUCTURED_MAPPING_LIMITS=Object.freeze({mappingBytes:256*1024,planBytes:16*1024*1024,rows:2000,nodes:20_000,depth:16});
export const structuredTransforms=['TEXT_V1','INTEGER_V1','DECIMAL_V1','DECIMAL_COMMA_V1','DATE_GREGORIAN_V1','DATE_BUDDHIST_V1','DATE_DMY_GREGORIAN_V1','DATE_DMY_BUDDHIST_V1','TIMESTAMP_UTC_V1','TIMESTAMP_PLUS07_V1','DATE_GREGORIAN_PLUS07_MIDNIGHT_V1','DATE_BUDDHIST_PLUS07_MIDNIGHT_V1'] as const;
export type StructuredTransform=typeof structuredTransforms[number];
export type StructuredMappingErrorCode='STRUCTURED_MAPPING_INVALID'|'STRUCTURED_SOURCE_INVALID'|'STRUCTURED_MAPPING_BINDING_MISMATCH'|'STRUCTURED_MAPPING_ROW_INVALID'|'STRUCTURED_MAPPING_LIMIT_EXCEEDED'|'STRUCTURED_MAPPING_UNSAFE_EXTRACTION';
export class StructuredMappingError extends Error {
 readonly location?:Readonly<{tableIndex:number;rowIndex:number;field:string|null}>;
 constructor(readonly code:StructuredMappingErrorCode,location?:{tableIndex:number;rowIndex:number;field:string|null}){super(code);this.name='StructuredMappingError';if(location)this.location=Object.freeze({...location});}
}
const invalid=():never=>{throw new StructuredMappingError('STRUCTURED_MAPPING_INVALID');};
const index=(max:number)=>z.number().int().min(0).max(max);
const revision=index(999_999_999),hash=z.string().regex(/^[a-f0-9]{64}$/u);
const note=z.string().min(1).max(500).refine(value=>value.length<=500&&value.trim().length>0&&value.isWellFormed()&&!/[\u0000-\u001F\u007F]/u.test(value));
export const structuredMappingBindingSchema=z.object({jobId:z.uuid(),jobRevision:revision,extractionRevision:revision.min(1),reviewRevision:revision.min(1)}).strict();
export type StructuredMappingBinding=z.infer<typeof structuredMappingBindingSchema>;
const range=z.object({startRowIndex:index(9999),endRowIndex:index(9999)}).strict().refine(value=>value.endRowIndex>=value.startRowIndex);
const column=z.object({kind:z.literal('COLUMN'),columnIndex:index(255),transform:z.enum(structuredTransforms),blank:z.enum(['REJECT','NULL'])}).strict();
const constant=z.object({kind:z.literal('CONSTANT'),value:z.union([z.string().max(5000).refine(value=>value.length<=5000),z.number(),z.null()]),note}).strict();
export type ColumnBinding=z.infer<typeof column>;
export type FieldBinding=z.infer<typeof column>|z.infer<typeof constant>;
const fields=z.record(z.string().min(1).max(80),z.discriminatedUnion('kind',[column,constant]));
const table=z.object({tableIndex:index(999),dataRanges:z.array(range).min(1).max(100),excludedRanges:z.array(range.safeExtend({reason:z.enum(['HEADER','NON_DATA']),note})).max(100),fields}).strict();
const mappingSchema=z.object({version:z.literal(1),registryVersion:z.literal(STRUCTURED_REGISTRY_VERSION),dataset:z.enum(STRUCTURED_DATASETS),
 source:z.object({jobId:z.uuid(),jobRevision:revision,extractionRevision:revision.min(1),sourceChecksum:hash,extractionDigest:hash}).strict(),
 tables:z.array(table).min(1).max(64),excludedTables:z.array(z.object({tableIndex:index(999),reason:z.enum(['NOT_THIS_DATASET','NON_DATA']),note}).strict()).max(1000),
}).strict();
export type StructuredMapping=z.infer<typeof mappingSchema>;
export type StructuredCoordinateKind='WORKSHEET_CELL'|'CSV_RECORD'|'EXTRACTED_LOGICAL';
export type StructuredFieldEvidence=
 | {kind:'CELL';field:string;columnIndex:number;sourceColumn:number;extractedValue:string;transform:StructuredTransform;blank:'REJECT'|'NULL'}
 | {kind:'CONSTANT';field:string;value:string|number|null;note:string};
export interface StructuredMappedRow {
 index:number;tableIndex:number;rowIndex:number;sourceRow:number;coordinateKind:StructuredCoordinateKind;sourceLocation:SourceLocation;
 payload:StructuredPayloads[StructuredDataset];payloadDigest:string;fields:StructuredFieldEvidence[];
}
export interface StructuredMappingPlan {
 schemaVersion:1;mapperVersion:'structured-mapper-v1';registryVersion:typeof STRUCTURED_REGISTRY_VERSION;dataset:StructuredDataset;
 binding:StructuredMappingBinding;sourceChecksum:string;sourceFormat:ImportFormat;sourceUrl:string|null;extractionDigest:string;mappingDigest:string;mapping:StructuredMapping;
 rows:StructuredMappedRow[];warnings:ExtractionWarning[];flags:string[];requiresReview:true;digest:string;
}

/** Snapshot JSON values through own descriptors; never invoke getters or serialization callbacks. */
export function copyStructuredJson(input:unknown,maxBytes:number=STRUCTURED_MAPPING_LIMITS.mappingBytes,maxNodes:number=STRUCTURED_MAPPING_LIMITS.nodes):unknown {
 let nodes=0,bytes=0;const ancestors=new Set<object>();
 const copy=(value:unknown,depth:number):unknown=>{
  if(++nodes>maxNodes||depth>STRUCTURED_MAPPING_LIMITS.depth)throw new StructuredMappingError('STRUCTURED_MAPPING_LIMIT_EXCEEDED');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))return invalid();return value;}
  if(typeof value==='string'){if(!value.isWellFormed())return invalid();bytes+=Buffer.byteLength(value,'utf8');if(bytes>maxBytes)throw new StructuredMappingError('STRUCTURED_MAPPING_LIMIT_EXCEEDED');return value;}
  if(typeof value!=='object'||nativeTypes.isProxy(value))return invalid();
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return invalid();
  if(ancestors.has(value))return invalid();ancestors.add(value);
  const keys=Reflect.ownKeys(value),output:Record<string,unknown>={};
  if(array){
   const lengthDescriptor=Object.getOwnPropertyDescriptor(value,'length');
   if(!lengthDescriptor||!('value' in lengthDescriptor)||!Number.isSafeInteger(lengthDescriptor.value)||lengthDescriptor.value<0||keys.length!==lengthDescriptor.value+1||lengthDescriptor.value>maxNodes)return invalid();
  }
  for(const key of keys){
   if(array&&key==='length')continue;
   if(typeof key!=='string'||!key.isWellFormed()||array&&!/^(?:0|[1-9][0-9]*)$/u.test(key))return invalid();
   const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!descriptor.enumerable||!('value' in descriptor))return invalid();
   Object.defineProperty(output,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
  }
  ancestors.delete(value);
  if(array){const length=Object.getOwnPropertyDescriptor(value,'length')?.value;const result:unknown[]=[];for(let i=0;i<length;i++){if(!Object.hasOwn(output,String(i)))return invalid();result.push(output[String(i)]);}return result;}
  return output;
 };
 try{const result=copy(input,0);if(Buffer.byteLength(JSON.stringify(result),'utf8')>maxBytes)throw new StructuredMappingError('STRUCTURED_MAPPING_LIMIT_EXCEEDED');return result;}
 catch(error){if(error instanceof StructuredMappingError)throw error;return invalid();}
}
export function isStructuredTransformCompatible(transform:StructuredTransform,kind:StructuredFieldKind):boolean {
 if(transform==='TEXT_V1')return ['TEXT','CURRENCY','EMAIL','URL'].includes(kind);
 if(transform==='INTEGER_V1')return kind==='INTEGER';
 if(transform==='DECIMAL_V1'||transform==='DECIMAL_COMMA_V1')return kind==='DECIMAL';
 if(['DATE_GREGORIAN_V1','DATE_BUDDHIST_V1','DATE_DMY_GREGORIAN_V1','DATE_DMY_BUDDHIST_V1'].includes(transform))return kind==='DATE';
 return structuredTransforms.includes(transform)&&kind==='TIMESTAMP';
}
export function validateStructuredMapping(input:unknown):StructuredMapping {
 try{
  const parsed=mappingSchema.safeParse(copyStructuredJson(input));if(!parsed.success)return invalid();const mapping=parsed.data;
  const registry=getStructuredRegistryEntry(mapping.dataset),shape:Record<string,z.ZodType>=structuredPayloadSchemas[mapping.dataset].shape;
  const seen=new Set<number>();
  for(const selected of mapping.tables){
   if(seen.has(selected.tableIndex))return invalid();seen.add(selected.tableIndex);
   if(Object.keys(selected.fields).length!==registry.fields.length||Object.keys(selected.fields).some(key=>!Object.hasOwn(shape,key)))return invalid();
   let sourceBacked=false;
   for(const target of registry.fields){
    const binding=selected.fields[target.name];if(!binding)return invalid();
    if(binding.kind==='COLUMN'){
     if(!isStructuredTransformCompatible(binding.transform,target.kind)||binding.blank==='NULL'&&!target.nullable)return invalid();
     if(!target.nullable)sourceBacked=true;
    }else if(!shape[target.name].safeParse(binding.value).success)return invalid();
   }
   if(!sourceBacked)return invalid();
   const ranges=[...selected.dataRanges,...selected.excludedRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex||a.endRowIndex-b.endRowIndex);
   for(let i=1;i<ranges.length;i++)if(ranges[i].startRowIndex<=ranges[i-1].endRowIndex)return invalid();
   selected.dataRanges.sort((a,b)=>a.startRowIndex-b.startRowIndex);selected.excludedRanges.sort((a,b)=>a.startRowIndex-b.startRowIndex);
   selected.fields=Object.fromEntries(registry.fields.map(field=>[field.name,selected.fields[field.name]]));
  }
  for(const excluded of mapping.excludedTables){if(seen.has(excluded.tableIndex))return invalid();seen.add(excluded.tableIndex);}
  mapping.tables.sort((a,b)=>a.tableIndex-b.tableIndex);mapping.excludedTables.sort((a,b)=>a.tableIndex-b.tableIndex);
  return mapping;
 }catch(error){if(error instanceof StructuredMappingError)throw error;return invalid();}
}
/** Inputs are already copied/validated internal artifacts, never a browser's rows. */
export function canonicalDigest(domain:string,input:unknown):string {
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(Reflect.get(value,key))])):value;
 return createHash('sha256').update(JSON.stringify({domain,value:canonical(copyStructuredJson(input,32*1024*1024,500_000))}),'utf8').digest('hex');
}
export function computeStructuredMappingDigest(mapping:StructuredMapping):string {return canonicalDigest('structured-mapping-v1',validateStructuredMapping(mapping));}
export function freezeStructuredData<T>(value:T):T {
 if(value!==null&&typeof value==='object'){for(const nested of Object.values(value))freezeStructuredData(nested);Object.freeze(value);}return value;
}
