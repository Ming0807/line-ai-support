import type {z} from 'zod';
import {verifyImportSource} from './source';
import {validateLocatedExtraction} from './extraction';
import type {ImportSource,LocatedExtraction} from './types';
import {STRUCTURED_REGISTRY_VERSION,structuredPayloadSchemas,validateStructuredPayload} from '../knowledge/structured-payload';
import {getStructuredRegistryEntry} from '../knowledge/structured-registry';
import {transformStructuredCell} from './structured-transforms';
import {STRUCTURED_MAPPING_LIMITS,StructuredMappingError,canonicalDigest,copyStructuredJson,freezeStructuredData,computeStructuredMappingDigest,structuredMappingBindingSchema,validateStructuredMapping,type StructuredMappingBinding,type StructuredMappingPlan,type StructuredMappedRow,type StructuredFieldEvidence} from './structured-mapping-contract';

const fail=(code:ConstructorParameters<typeof StructuredMappingError>[0]):never=>{throw new StructuredMappingError(code);};
function sourceSnapshot(source:ImportSource,extraction:LocatedExtraction){
 try{
  const checkedSource=verifyImportSource(source),copied=copyStructuredJson(extraction,32*1024*1024,500_000);
  const checkedExtraction=validateLocatedExtraction(checkedSource,copied);
  for(const table of checkedExtraction.tables){
   const end=table.firstRow+table.rows.length-1;
   if(!Number.isSafeInteger(end)||!['CSV','XLSX'].includes(checkedSource.format)&&end>100_000)fail('STRUCTURED_SOURCE_INVALID');
  }
  return {source:checkedSource,extraction:checkedExtraction};
 }catch(error){if(error instanceof StructuredMappingError&&error.code==='STRUCTURED_MAPPING_LIMIT_EXCEEDED')throw error;return fail('STRUCTURED_SOURCE_INVALID');}
}
function extractionDigest(source:ImportSource,extraction:LocatedExtraction):string {
 return canonicalDigest('structured-extraction-v1',{format:source.format,sourceChecksum:source.checksum,sourceUrl:source.sourceUrl,extraction});
}
/** Binds an exact saved extraction; it cannot prove authorization or that a caller ran a parser. */
export function computeStructuredExtractionDigest(source:ImportSource,extraction:LocatedExtraction):string {
 const checked=sourceSnapshot(source,extraction);return extractionDigest(checked.source,checked.extraction);
}
/** Pure private preparation, not a receipt, approval, installed mapper or publication command. */
export function buildStructuredMappingPlan(source:ImportSource,extraction:LocatedExtraction,binding:StructuredMappingBinding,input:unknown):StructuredMappingPlan {
 const mapping=validateStructuredMapping(input);
 const checkedBinding=structuredMappingBindingSchema.safeParse(copyStructuredJson(binding));if(!checkedBinding.success)return fail('STRUCTURED_MAPPING_INVALID');
 const context=checkedBinding.data,checked=sourceSnapshot(source,extraction),verified=checked.source,located=checked.extraction;
 const sourceDigest=extractionDigest(verified,located),expected=mapping.source;
 if(expected.jobId!==context.jobId||expected.jobRevision!==context.jobRevision||expected.extractionRevision!==context.extractionRevision||expected.sourceChecksum!==verified.checksum||expected.extractionDigest!==sourceDigest)return fail('STRUCTURED_MAPPING_BINDING_MISMATCH');
 const flags=new Set([...located.flags,...located.report.warnings.map(warning=>warning.code)]);
 if(['FORMULAS_PRESENT','HIDDEN_DATA_REVIEW','UNSUPPORTED_TABLES','ENCRYPTED_SOURCE'].some(flag=>flags.has(flag))||verified.format==='DOCX'&&flags.has('TABLE_SHAPE_REVIEW'))return fail('STRUCTURED_MAPPING_UNSAFE_EXTRACTION');
 const selectedTables=[...mapping.tables.map(table=>table.tableIndex),...mapping.excludedTables.map(table=>table.tableIndex)];
 if(selectedTables.length!==located.tables.length||selectedTables.some(index=>index>=located.tables.length))return fail('STRUCTURED_MAPPING_INVALID');
 let count=0;
 for(const selected of mapping.tables){
  const table=located.tables[selected.tableIndex],all=[...selected.dataRanges,...selected.excludedRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex);let cursor=0;
  for(const range of all){if(range.startRowIndex!==cursor||range.endRowIndex>=table.rows.length)return fail('STRUCTURED_MAPPING_INVALID');cursor=range.endRowIndex+1;}
  if(cursor!==table.rows.length)return fail('STRUCTURED_MAPPING_INVALID');
  count+=selected.dataRanges.reduce((sum,range)=>sum+range.endRowIndex-range.startRowIndex+1,0);
  if(count>STRUCTURED_MAPPING_LIMITS.rows)return fail('STRUCTURED_MAPPING_LIMIT_EXCEEDED');
 }
 const registry=getStructuredRegistryEntry(mapping.dataset),shape:Record<string,z.ZodType>=structuredPayloadSchemas[mapping.dataset].shape,rows:StructuredMappedRow[]=[];
 for(const selected of mapping.tables){
  const table=located.tables[selected.tableIndex],sourceLocation=located.locations.tables[selected.tableIndex],width=Math.max(...table.rows.map(row=>row.length));
  for(const range of selected.dataRanges)for(let rowIndex=range.startRowIndex;rowIndex<=range.endRowIndex;rowIndex++){
   const values=table.rows[rowIndex],payload:Record<string,unknown>={},fields:StructuredFieldEvidence[]=[];
   const invalidRow=(field:string|null):never=>{throw new StructuredMappingError('STRUCTURED_MAPPING_ROW_INVALID',{tableIndex:selected.tableIndex,rowIndex,field});};
   if(values.length!==width)invalidRow(null);
   for(const target of registry.fields){
    const fieldBinding=selected.fields[target.name];let value:string|number|null;
    if(fieldBinding.kind==='CONSTANT'){
     value=fieldBinding.value;fields.push({kind:'CONSTANT',field:target.name,value,note:fieldBinding.note});
    }else{
     if(fieldBinding.columnIndex>=values.length)invalidRow(target.name);
     const extractedValue=values[fieldBinding.columnIndex];
     try{value=transformStructuredCell(fieldBinding,extractedValue);}catch{return invalidRow(target.name);}
     const sourceColumn=(sourceLocation.kind==='CSV'||sourceLocation.kind==='XLSX'?sourceLocation.columnStart:1)+fieldBinding.columnIndex;
     fields.push({kind:'CELL',field:target.name,columnIndex:fieldBinding.columnIndex,sourceColumn,extractedValue,transform:fieldBinding.transform,blank:fieldBinding.blank});
    }
    if(!shape[target.name].safeParse(value).success)invalidRow(target.name);payload[target.name]=value;
   }
   let validated:ReturnType<typeof validateStructuredPayload>;try{validated=validateStructuredPayload(mapping.dataset,payload);}catch{return invalidRow(null);}
   rows.push({index:rows.length,tableIndex:selected.tableIndex,rowIndex,sourceRow:table.firstRow+rowIndex,
    coordinateKind:sourceLocation.kind==='XLSX'?'WORKSHEET_CELL':sourceLocation.kind==='CSV'?'CSV_RECORD':'EXTRACTED_LOGICAL',sourceLocation,
    payload:validated,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:mapping.dataset,payload:validated}),fields});
  }
 }
 const body={schemaVersion:1 as const,mapperVersion:'structured-mapper-v1' as const,registryVersion:STRUCTURED_REGISTRY_VERSION,dataset:mapping.dataset,binding:context,
  sourceChecksum:verified.checksum,sourceFormat:verified.format,sourceUrl:verified.sourceUrl,extractionDigest:sourceDigest,mappingDigest:computeStructuredMappingDigest(mapping),mapping,
  rows,warnings:located.report.warnings,flags:located.flags,requiresReview:true as const};
 // SHA-256 hex has a fixed length; include the digest field in the artifact bound.
 if(Buffer.byteLength(JSON.stringify({...body,digest:'0'.repeat(64)}),'utf8')>STRUCTURED_MAPPING_LIMITS.planBytes)return fail('STRUCTURED_MAPPING_LIMIT_EXCEEDED');
 return freezeStructuredData({...body,digest:canonicalDigest('structured-plan-v1',body)});
}
