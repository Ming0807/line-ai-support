import {describe,expect,it} from 'vitest';
import {buildStructuredMappingPlan,computeStructuredExtractionDigest} from '../lib/imports/structured-mapper';
import {computeStructuredAcknowledgment} from '../lib/imports/structured-preparation';
import {datasetTypes,importFormats,type DatasetType,type ImportFormat,type LocatedExtraction} from '../lib/imports/types';
import type {StructuredMappingBinding} from '../lib/imports/structured-mapping-contract';
import {decryptStructuredRowEvidence} from '../lib/knowledge/structured-row-envelope';
import {prepareStructuredPublication} from '../lib/imports/structured-publication-preparation';
import {structuredMappingFixture} from './fixtures/structured-mapping';

const TEST_KEY=Buffer.alloc(32,0x43).toString('base64');
const DOCUMENT_ID='123e4567-e89b-42d3-a456-426614174002';
const SECRET='PRIVATE_PUBLICATION_TEST_SECRET_59c1';
type Fixture=ReturnType<typeof structuredMappingFixture>;
type MappingCopy={
 source:{jobId:string;jobRevision:number;extractionRevision:number;sourceChecksum:string;extractionDigest:string};
 tables:Array<{dataRanges:Array<{startRowIndex:number;endRowIndex:number}>;excludedRanges:unknown[]}>;
 excludedTables:unknown[];
};

function planFor(fixture:Fixture,binding:StructuredMappingBinding=fixture.binding,mapping:unknown=fixture.mapping,extraction:LocatedExtraction=fixture.extraction){
 return buildStructuredMappingPlan(fixture.source,extraction,binding,mapping);
}
function requestFor(plan:ReturnType<typeof planFor>,documentRevision=0){
 return {documentId:DOCUMENT_ID,documentRevision,acknowledgment:computeStructuredAcknowledgment(plan)};
}
function prepared(fixture:Fixture,key=TEST_KEY,binding:StructuredMappingBinding=fixture.binding,mapping:unknown=fixture.mapping,request?:unknown,extraction:LocatedExtraction=fixture.extraction){
 const plan=planFor(fixture,binding,mapping,extraction),checkedRequest=request??requestFor(plan);
 return {plan,request:checkedRequest,result:prepareStructuredPublication(fixture.source,extraction,binding,mapping,checkedRequest,key)};
}
function invalid(call:()=>unknown,secret?:string):void{
 let caught:unknown;
 try{call();}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(Error);
 expect((caught as Error).message).toBe('STRUCTURED_PUBLICATION_PREPARATION_INVALID');
 if(secret)expect(String(caught)).not.toContain(secret);
}
function mappingCopy(fixture:Fixture):MappingCopy{return structuredClone(fixture.mapping) as MappingCopy;}
function publicationFixture(dataset:DatasetType,format:ImportFormat):Fixture{
 const fixture=structuredMappingFixture(dataset,format),mapping=mappingCopy(fixture);
 const jobRevision=fixture.binding.extractionRevision;
 mapping.source.jobRevision=jobRevision;
 return {...fixture,binding:{...fixture.binding,jobRevision},mapping};
}

describe('private source-derived structured publication preparation',()=>{
 it('bounds the complete encrypted artifact even when the validated mapper plan fits its own limit',()=>{
  function expanded(count:number){
   const fixture=publicationFixture('university_services','CSV'),extraction=structuredClone(fixture.extraction);
   const table=extraction.tables[0]!,sample=[...table.rows[1]!];
   sample[2]='ช'.repeat(2000);
   table.rows=[table.rows[0]!,...Array.from({length:count},()=>[...sample])];
   const location=extraction.locations.tables[0]!;
   if(location.kind!=='CSV')throw new Error('TEST_FIXTURE_EXPECTED_CSV');
   location.rowEnd=table.firstRow+count;
   extraction.report.cells=table.rows.reduce((sum,row)=>sum+row.length,0);
   extraction.report.textCharacters=extraction.pages.reduce((sum,page)=>sum+page.text.length,0)+table.rows.flat().reduce((sum,value)=>sum+value.length,0);
   const mapping=mappingCopy(fixture);
   mapping.tables[0]!.dataRanges=[{startRowIndex:1,endRowIndex:count}];
   mapping.source.extractionDigest=computeStructuredExtractionDigest(fixture.source,extraction);
   const plan=planFor(fixture,fixture.binding,mapping,extraction);
   return {fixture,extraction,mapping,plan};
  }
  const small=expanded(2);
  const accepted=prepareStructuredPublication(small.fixture.source,small.extraction,small.fixture.binding,small.mapping,requestFor(small.plan),TEST_KEY);
  expect(Buffer.byteLength(JSON.stringify(accepted),'utf8')).toBeLessThanOrEqual(16*1024*1024);
  const large=expanded(900);
  expect(Buffer.byteLength(JSON.stringify(large.plan),'utf8')).toBeLessThan(16*1024*1024);
  invalid(()=>prepareStructuredPublication(large.fixture.source,large.extraction,large.fixture.binding,large.mapping,requestFor(large.plan),TEST_KEY));
 },20000);
 it('prepares and decrypts actual mapper output for every dataset and source format',()=>{
  for(const dataset of datasetTypes)for(const format of importFormats){
   const fixture=publicationFixture(dataset as DatasetType,format as ImportFormat);
   const {plan,request,result}=prepared(fixture);
   const acknowledgment=request as ReturnType<typeof requestFor>;
   expect(result).toMatchObject({schemaVersion:1,kind:'PREPARED_STRUCTURED_ROWS',dataset,registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',
    documentId:DOCUMENT_ID,documentRevision:0,binding:fixture.binding,sourceChecksum:plan.sourceChecksum,sourceFormat:format,
    extractionDigest:plan.extractionDigest,mappingDigest:plan.mappingDigest,planDigest:plan.digest,acknowledgment:acknowledgment.acknowledgment,
    rowCount:plan.rows.length,requiresFinalFence:true});
   expect(result.rows).toHaveLength(plan.rows.length);
   expect(new Set(result.rows.map(row=>row.id)).size).toBe(plan.rows.length);
   for(const [index,row] of result.rows.entries()){
    const mapped=plan.rows[index]!;
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(row.payload).toEqual(mapped.payload);
    expect(row.payloadDigest).toBe(mapped.payloadDigest);
    expect(row.context).toMatchObject({schemaVersion:1,dataset,registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:row.id,
     documentId:DOCUMENT_ID,documentRevision:0,jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,
     extractionRevision:fixture.binding.extractionRevision,reviewRevision:fixture.binding.reviewRevision,
     sourceFormat:format,sourceChecksum:plan.sourceChecksum,extractionDigest:plan.extractionDigest,mappingDigest:plan.mappingDigest,
     payloadDigest:mapped.payloadDigest,planDigest:plan.digest,tableIndex:mapped.tableIndex,rowIndex:mapped.rowIndex,
     tableFirstRow:fixture.extraction.tables[mapped.tableIndex]!.firstRow,sourceRow:mapped.sourceRow,coordinateKind:mapped.coordinateKind});
    const evidence=decryptStructuredRowEvidence(row.evidenceEncrypted,row.context,TEST_KEY);
    expect(evidence).toMatchObject({schemaVersion:1,payload:mapped.payload,fields:mapped.fields,sourceLocation:mapped.sourceLocation,sourceUrl:plan.sourceUrl});
   }
  }
 });

 it('assembles multiple selected rows while preserving explicit table exclusions and unique backend IDs',()=>{
  const fixture=publicationFixture('tuition_fees','CSV');
  const extraction=structuredClone(fixture.extraction);
  const first=extraction.tables[0]!;
  first.rows.push([...first.rows[1]!]);
  const firstLocation=extraction.locations.tables[0]!;
  if(firstLocation.kind!=='CSV')throw new Error('TEST_FIXTURE_EXPECTED_CSV_LOCATION');
  firstLocation.rowEnd=firstLocation.rowStart+first.rows.length-1;
  extraction.tables.push({pageNumber:null,sectionTitle:'Explicitly excluded synthetic table',sheetName:null,firstRow:20,rows:[['unmapped table content']]});
  extraction.locations.tables.push({kind:'CSV',rowStart:20,rowEnd:20,columnStart:1,columnEnd:1,tableIndex:2});
  extraction.report.tables=extraction.tables.length;
  extraction.report.cells=extraction.tables.reduce((sum,table)=>sum+table.rows.reduce((n,row)=>n+row.length,0),0);
  extraction.report.textCharacters=extraction.pages.reduce((sum,page)=>sum+page.text.length,0)+extraction.tables.flatMap(table=>table.rows.flat()).reduce((sum,value)=>sum+value.length,0);
  const mapping=mappingCopy(fixture);
  mapping.tables[0]!.dataRanges=[{startRowIndex:1,endRowIndex:2}];
  mapping.excludedTables=[{tableIndex:1,reason:'NOT_THIS_DATASET',note:'Explicit synthetic table exclusion.'}];
  mapping.source.extractionDigest=computeStructuredExtractionDigest(fixture.source,extraction);
  const plan=buildStructuredMappingPlan(fixture.source,extraction,fixture.binding,mapping);
  const request=requestFor(plan);
  const firstPrepared=prepareStructuredPublication(fixture.source,extraction,fixture.binding,mapping,request,TEST_KEY);
  const secondPrepared=prepareStructuredPublication(fixture.source,extraction,fixture.binding,mapping,request,TEST_KEY);

  expect(plan.rows.map(row=>row.sourceRow)).toEqual([5,6]);
  expect(firstPrepared.rows.map(row=>row.payload)).toEqual(plan.rows.map(row=>row.payload));
  expect(firstPrepared.rows.map(row=>row.context.tableIndex)).toEqual([0,0]);
  expect(new Set(firstPrepared.rows.map(row=>row.id)).size).toBe(2);
  expect(firstPrepared.rows.map(row=>row.id)).not.toEqual(secondPrepared.rows.map(row=>row.id));
  for(const row of firstPrepared.rows)expect(decryptStructuredRowEvidence(row.evidenceEncrypted,row.context,TEST_KEY).payload).toEqual(row.payload);
 });

 it('keeps content acknowledgment stable across review counters while changing plan and row contexts',()=>{
  const fixture=publicationFixture('academic_calendar_events','CSV');
  const planA=planFor(fixture),bindingB={...fixture.binding,reviewRevision:fixture.binding.reviewRevision+1},planB=planFor(fixture,bindingB);
  const acknowledgmentA=computeStructuredAcknowledgment(planA),acknowledgmentB=computeStructuredAcknowledgment(planB);
  expect(acknowledgmentB).toEqual(acknowledgmentA);
  const resultA=prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,requestFor(planA),TEST_KEY);
  const resultB=prepareStructuredPublication(fixture.source,fixture.extraction,bindingB,fixture.mapping,requestFor(planB),TEST_KEY);
  expect(resultB.acknowledgment).toEqual(resultA.acknowledgment);
  expect(resultB.planDigest).not.toBe(resultA.planDigest);
  expect(resultB.rows[0]!.context.reviewRevision).toBe(bindingB.reviewRevision);
  expect(resultA.rows[0]!.id).not.toBe(resultB.rows[0]!.id);
 });

 it('rejects stale acknowledgments after source-derived mapping content changes',()=>{
  const fixture=publicationFixture('academic_calendar_events','CSV');
  const originalPlan=planFor(fixture),oldRequest=requestFor(originalPlan);
  const mapping=mappingCopy(fixture) as ReturnType<typeof mappingCopy>&{tables:Array<{fields:Record<string,{kind:string;note?:string}>}>};
  const constant=mapping.tables[0]!.fields.end_date!;
  if(constant.kind!=='CONSTANT')throw new Error('TEST_FIXTURE_EXPECTED_CONSTANT_BINDING');
  constant.note=`${constant.note} Reviewed for the synthetic publication test.`;
  const changedPlan=planFor(fixture,fixture.binding,mapping);
  expect(computeStructuredAcknowledgment(changedPlan).contentDigest).not.toBe(computeStructuredAcknowledgment(originalPlan).contentDigest);
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,mapping,oldRequest,TEST_KEY));
  const result=prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,mapping,requestFor(changedPlan),TEST_KEY);
  expect(result.planDigest).toBe(changedPlan.digest);
 });

 it('rejects changed bytes, stale extraction bindings, mismatched source identities, and storage-incompatible counters',()=>{
  const fixture=publicationFixture('tuition_fees','CSV'),plan=planFor(fixture),request=requestFor(plan);
  const changedSource={...fixture.source,bytes:Uint8Array.from(fixture.source.bytes)};
  changedSource.bytes[0]=changedSource.bytes[0]!^1;
  invalid(()=>prepareStructuredPublication(changedSource,fixture.extraction,fixture.binding,fixture.mapping,request,TEST_KEY),SECRET);
  const changedExtraction=structuredClone(fixture.extraction);
  const oldCell=changedExtraction.tables[0]!.rows[1]![1]!;
  const newCell='changed program';
  changedExtraction.tables[0]!.rows[1]![1]=newCell;
  changedExtraction.report.textCharacters+=newCell.length-oldCell.length;
  invalid(()=>prepareStructuredPublication(fixture.source,changedExtraction,fixture.binding,fixture.mapping,request,TEST_KEY));

  const badMapping=mappingCopy(fixture);
  badMapping.source.sourceChecksum='a'.repeat(64);
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,badMapping,request,TEST_KEY));

  for(const [jobRevision,extractionRevision] of [[0,1],[3,4]] as const){
   const binding={...fixture.binding,jobRevision,extractionRevision};
   const mapping=mappingCopy(fixture);
   mapping.source.jobRevision=jobRevision;
   mapping.source.extractionRevision=extractionRevision;
   const storagePlan=planFor(fixture,binding,mapping);
   invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,binding,mapping,requestFor(storagePlan),TEST_KEY));
  }
 });

 it('validates the strict request before assembly and rejects unknown, accessor, proxy, and supplied-plan input',()=>{
  const fixture=publicationFixture('university_services','HTML'),plan=planFor(fixture),request=requestFor(plan);
  const invalidRequests:unknown[]=[
   null,{}, {...request,approvalToken:SECRET}, {...request,documentId:DOCUMENT_ID.toUpperCase()},
   {...request,documentRevision:-1},{...request,documentRevision:1_000_000_000},
   {...request,acknowledgment:{...request.acknowledgment,contentDigest:'A'.repeat(64)}},
   {...request,acknowledgment:{...request.acknowledgment,mapperVersion:'unrecognized-mapper'}},
  ];
  for(const candidate of invalidRequests)invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,candidate,TEST_KEY),SECRET);

  const accessor={...request};let getterCalls=0;
  Object.defineProperty(accessor,'documentRevision',{enumerable:true,configurable:true,get(){getterCalls++;throw new Error(SECRET);}});
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,accessor,TEST_KEY),SECRET);
  expect(getterCalls).toBe(0);
  let proxyTrapCalls=0;
  const proxy=new Proxy(request,{ownKeys(){proxyTrapCalls++;throw new Error(SECRET);}});
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,proxy,TEST_KEY),SECRET);
  expect(proxyTrapCalls).toBe(0);
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,plan,request,TEST_KEY));
 });

 it('uses only backend row IDs, omits private raw evidence, freezes the detached artifact, and preserves inputs',()=>{
  const fixture=publicationFixture('tuition_fees','CSV'),plan=planFor(fixture),request=requestFor(plan);
  const sourceBytes=Buffer.from(fixture.source.bytes),extractionBefore=structuredClone(fixture.extraction),mappingBefore=structuredClone(fixture.mapping),bindingBefore=structuredClone(fixture.binding),requestBefore=structuredClone(request);
  const result=prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,request,TEST_KEY);
  const serialized=JSON.stringify(result);
  expect(serialized).not.toContain('1,234.50');
  expect(serialized).not.toContain('No major restriction in this synthetic row.');
  expect(serialized).not.toContain('extractedValue');
  expect(serialized).not.toContain('sourceLocation');
  expect(serialized).not.toContain('sourceUrl');
  expect(serialized).not.toContain('"mapping"');
  expect(Object.keys(result.rows[0]!).sort()).toEqual(['context','evidenceEncrypted','id','payload','payloadDigest'].sort());
  expect(result.rows[0]).not.toHaveProperty('fields');
  expect(result.rows[0]).not.toHaveProperty('sourceLocation');
  expect(result.rows[0]).not.toHaveProperty('sourceUrl');
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.binding)).toBe(true);
  expect(Object.isFrozen(result.acknowledgment)).toBe(true);
  expect(Object.isFrozen(result.rows)).toBe(true);
  expect(Object.isFrozen(result.rows[0])).toBe(true);
  expect(Object.isFrozen(result.rows[0]!.payload)).toBe(true);
  expect(Object.isFrozen(result.rows[0]!.context)).toBe(true);
  expect(Reflect.set(result.rows[0]!.payload,'program_name','caller mutation')).toBe(false);
  expect(Buffer.compare(Buffer.from(fixture.source.bytes),sourceBytes)).toBe(0);
  expect(fixture.extraction).toEqual(extractionBefore);
  expect(fixture.mapping).toEqual(mappingBefore);
  expect(fixture.binding).toEqual(bindingBefore);
  expect(request).toEqual(requestBefore);
 });

 it('keeps the acquisition URL and review-only text inside encrypted evidence and rejects bad keys without leaking them',()=>{
  const fixture=publicationFixture('university_services','HTML'),plan=planFor(fixture),request=requestFor(plan);
  const result=prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,request,TEST_KEY);
  expect(JSON.stringify(result)).not.toContain(fixture.source.sourceUrl!);
  const decrypted=decryptStructuredRowEvidence(result.rows[0]!.evidenceEncrypted,result.rows[0]!.context,TEST_KEY);
  expect(decrypted.sourceUrl).toBe(fixture.source.sourceUrl);
  const otherValidKey=Buffer.alloc(32,0x44).toString('base64');
  expect(()=>decryptStructuredRowEvidence(result.rows[0]!.evidenceEncrypted,result.rows[0]!.context,otherValidKey)).toThrowError(/^STRUCTURED_ROW_EVIDENCE_INVALID$/u);
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,request,SECRET),SECRET);
  const shortKey=Buffer.alloc(31,0x43).toString('base64');
  invalid(()=>prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,request,shortKey));
 });
});
