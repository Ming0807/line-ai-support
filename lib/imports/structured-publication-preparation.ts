import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {encryptStructuredRowEvidence} from '../knowledge/structured-row-envelope';
import {computeStructuredAcknowledgment} from './structured-acknowledgment';
import {buildStructuredMappingPlan} from './structured-mapper';
import {copyStructuredJson,freezeStructuredData,structuredMappingBindingSchema,type StructuredMappingBinding} from './structured-mapping-contract';
import type {ImportSource,LocatedExtraction} from './types';

const artifactLimit=16*1024*1024;
const invalid=():never=>{throw new Error('STRUCTURED_PUBLICATION_PREPARATION_INVALID');};
const uuid=z.uuid().refine(value=>value===value.toLowerCase());
const requestSchema=z.object({documentId:uuid,documentRevision:z.number().int().min(0).max(999_999_999),
 acknowledgment:z.object({contentDigest:z.string().regex(/^[a-f0-9]{64}$/u),mapperVersion:z.literal('structured-mapper-v1')}).strict(),
}).strict();

/** Private unused assembly. Caller must load actual saved inputs and enforce the final atomic authorization/revision fence. */
export function prepareStructuredPublication(source:ImportSource,extraction:LocatedExtraction,binding:StructuredMappingBinding,mapping:unknown,request:unknown,key:string){
 try{
  const target=requestSchema.parse(copyStructuredJson(request,16*1024,256));
  const checkedBinding=structuredMappingBindingSchema.parse(copyStructuredJson(binding,16*1024,256));
  if(checkedBinding.jobId!==checkedBinding.jobId.toLowerCase()||checkedBinding.jobRevision<1
   ||checkedBinding.extractionRevision>checkedBinding.jobRevision)return invalid();
  const plan=buildStructuredMappingPlan(source,extraction,checkedBinding,mapping);
  const acknowledgment=computeStructuredAcknowledgment(plan);
  if(target.acknowledgment.contentDigest!==acknowledgment.contentDigest||target.acknowledgment.mapperVersion!==acknowledgment.mapperVersion)return invalid();

  const header={schemaVersion:1 as const,kind:'PREPARED_STRUCTURED_ROWS' as const,
   registryVersion:plan.registryVersion,mapperVersion:plan.mapperVersion,dataset:plan.dataset,
   documentId:target.documentId,documentRevision:target.documentRevision,binding:plan.binding,
   sourceChecksum:plan.sourceChecksum,sourceFormat:plan.sourceFormat,extractionDigest:plan.extractionDigest,
   mappingDigest:plan.mappingDigest,planDigest:plan.digest,acknowledgment,rowCount:plan.rows.length,requiresFinalFence:true as const};
  const ids=new Set<string>();
  let artifactBytes=Buffer.byteLength(JSON.stringify({...header,rows:[]}),'utf8');
  const rows=plan.rows.map(row=>{
   const id=randomUUID();if(ids.has(id))return invalid();ids.add(id);
   const context={schemaVersion:1 as const,registryVersion:plan.registryVersion,mapperVersion:plan.mapperVersion,
    dataset:plan.dataset,rowId:id,documentId:target.documentId,documentRevision:target.documentRevision,
    jobId:plan.binding.jobId,jobRevision:plan.binding.jobRevision,extractionRevision:plan.binding.extractionRevision,
    reviewRevision:plan.binding.reviewRevision,sourceFormat:plan.sourceFormat,sourceChecksum:plan.sourceChecksum,
    extractionDigest:plan.extractionDigest,mappingDigest:plan.mappingDigest,payloadDigest:row.payloadDigest,planDigest:plan.digest,
    tableIndex:row.tableIndex,rowIndex:row.rowIndex,tableFirstRow:row.sourceRow-row.rowIndex,sourceRow:row.sourceRow,coordinateKind:row.coordinateKind};
   const evidenceEncrypted=encryptStructuredRowEvidence({schemaVersion:1,payload:row.payload,fields:row.fields,sourceLocation:row.sourceLocation,sourceUrl:plan.sourceUrl},context,key);
   const prepared={id,payload:row.payload,payloadDigest:row.payloadDigest,context,evidenceEncrypted};
   artifactBytes+=Buffer.byteLength(JSON.stringify(prepared),'utf8')+(row.index>0?1:0);
   if(artifactBytes>artifactLimit)return invalid();
   return prepared;
  });
  return freezeStructuredData({...header,rows});
 }catch{return invalid();}
}

export type PreparedStructuredPublication=ReturnType<typeof prepareStructuredPublication>;
