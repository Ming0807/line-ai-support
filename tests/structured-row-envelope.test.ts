import {describe,expect,it} from 'vitest';
import {buildStructuredMappingPlan} from '../lib/imports/structured-mapper';
import {datasetTypes,importFormats} from '../lib/imports/types';
import {getStructuredRegistryEntry} from '../lib/knowledge/structured-registry';
import {decryptStructuredRowEvidence,encryptStructuredRowEvidence} from '../lib/knowledge/structured-row-envelope';
import {structuredMappingFixture} from './fixtures/structured-mapping';

type RowEvidence={schemaVersion:1;payload:Record<string,unknown>;fields:unknown[];sourceLocation:Record<string,unknown>;sourceUrl:string|null};
type Prepared={context:Record<string,unknown>;evidence:RowEvidence};

// Deliberately deterministic test material. Never read keys from environment or project secrets.
const TEST_KEY=Buffer.alloc(32,0x41).toString('base64');
const OTHER_KEY=Buffer.alloc(32,0x42).toString('base64');
const UUIDS={row:'123e4567-e89b-42d3-a456-426614174001',document:'123e4567-e89b-42d3-a456-426614174002',job:'123e4567-e89b-42d3-a456-426614174003'};

function prepare(dataset:'academic_calendar_events'|'tuition_fees'|'transfer_courses'|'university_services'|'university_systems'|'service_forms'|'announcements'='academic_calendar_events',format:'PDF'|'DOCX'|'XLSX'|'CSV'|'HTML'='CSV'):Prepared{
 const fixture=structuredMappingFixture(dataset,format);
 const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
 const row=plan.rows[0]!;
 const context={
  schemaVersion:1,
  registryVersion:plan.registryVersion,
  mapperVersion:plan.mapperVersion,
  dataset:plan.dataset,
  rowId:UUIDS.row,
  documentId:UUIDS.document,
  documentRevision:4,
  jobId:plan.binding.jobId,
  jobRevision:plan.binding.jobRevision,
  extractionRevision:plan.binding.extractionRevision,
  reviewRevision:plan.binding.reviewRevision,
  sourceFormat:plan.sourceFormat,
  sourceChecksum:plan.sourceChecksum,
  extractionDigest:plan.extractionDigest,
  mappingDigest:plan.mappingDigest,
  payloadDigest:row.payloadDigest,
  planDigest:plan.digest,
  tableIndex:row.tableIndex,
  rowIndex:row.rowIndex,
  tableFirstRow:fixture.extraction.tables[row.tableIndex]!.firstRow,
  sourceRow:row.sourceRow,
  coordinateKind:row.coordinateKind,
 };
 return {context,evidence:{schemaVersion:1,payload:row.payload as Record<string,unknown>,fields:row.fields,sourceLocation:row.sourceLocation as unknown as Record<string,unknown>,sourceUrl:plan.sourceUrl}};
}

function invalid(call:()=>unknown,secret?:string):void{
 let caught:unknown;
 try{call();}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(Error);
 expect((caught as Error).message).toBe('STRUCTURED_ROW_EVIDENCE_INVALID');
 if(secret)expect(String(caught)).not.toContain(secret);
}
function flipEncodedByte(segment:string):string{
 const bytes=Buffer.from(segment,'base64url');
 bytes[0]=bytes[0]!^1;
 return bytes.toString('base64url');
}
function changedHash(value:string):string{return `${value[0]==='a'?'b':'a'}${value.slice(1)}`;}

describe('authenticated private structured row evidence',()=>{
 it('round-trips actual mapper output for all seven datasets and five source formats',()=>{
  for(const dataset of datasetTypes)for(const format of importFormats){
   const {context,evidence}=prepare(dataset,format);
   const envelope=encryptStructuredRowEvidence(evidence,context,TEST_KEY);
   expect(envelope.startsWith('sr1.')).toBe(true);
   expect(decryptStructuredRowEvidence(envelope,context,TEST_KEY)).toEqual(evidence);
   expect(getStructuredRegistryEntry(dataset).fields.map(field=>field.name)).toEqual(Object.keys(evidence.payload));
  }
 });

 it('uses a canonical four-part sr1 envelope with a fresh nonce and authenticated ciphertext',()=>{
  const {context,evidence}=prepare('tuition_fees','XLSX');
  const first=encryptStructuredRowEvidence(evidence,context,TEST_KEY);
  const second=encryptStructuredRowEvidence(evidence,context,TEST_KEY);
  const parts=first.split('.');
  expect(parts).toHaveLength(4);
  expect(parts[0]).toBe('sr1');
  for(const part of parts.slice(1)){
   expect(part).toMatch(/^[A-Za-z0-9_-]+$/u);
   expect(Buffer.from(part,'base64url').toString('base64url')).toBe(part);
  }
  expect(Buffer.from(parts[1] as string,'base64url')).toHaveLength(12);
  expect(Buffer.from(parts[2] as string,'base64url')).toHaveLength(16);
  expect(Buffer.from(parts[3] as string,'base64url').length).toBeGreaterThan(0);
  expect(second).not.toBe(first);
  expect(decryptStructuredRowEvidence(second,context,TEST_KEY)).toEqual(evidence);
 });

 it('rejects wrong or malformed keys and altered, truncated, padded, or noncanonical envelope segments',()=>{
  const {context,evidence}=prepare();
  const envelope=encryptStructuredRowEvidence(evidence,context,TEST_KEY),parts=envelope.split('.');
  invalid(()=>decryptStructuredRowEvidence(envelope,context,OTHER_KEY));
  for(const malformedKey of ['', 'not-a-key', Buffer.alloc(31,0x41).toString('base64'), Buffer.alloc(32,0x41).toString('base64url')]){
   invalid(()=>encryptStructuredRowEvidence(evidence,context,malformedKey));
   invalid(()=>decryptStructuredRowEvidence(envelope,context,malformedKey));
  }
  const malformed=[
   `sr2.${parts[1]}.${parts[2]}.${parts[3]}`,
   `${parts[0]}.${parts[1]}.${parts[2]}`,
   `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}.extra`,
   `${parts[0]}.${parts[1]}=.${parts[2]}.${parts[3]}`,
   `${parts[0]}.${flipEncodedByte(parts[1]!)}.${parts[2]}.${parts[3]}`,
   `${parts[0]}.${parts[1]}.${flipEncodedByte(parts[2]!)}.${parts[3]}`,
   `${parts[0]}.${parts[1]}.${parts[2]}.${flipEncodedByte(parts[3]!)}`,
   'sr1....',
  ];
  for(const candidate of malformed)invalid(()=>decryptStructuredRowEvidence(candidate,context,TEST_KEY));
  invalid(()=>decryptStructuredRowEvidence(`sr1.${'A'.repeat(1_400_000)}.AAAAAAAAAAAAAAAAAAAAAA.A`,context,TEST_KEY));
 });

 it('authenticates every mutable context field as associated data',()=>{
  const {context,evidence}=prepare('academic_calendar_events','CSV');
  const envelope=encryptStructuredRowEvidence(evidence,context,TEST_KEY);
  const alternatives:Record<string,unknown>={
   dataset:'announcements',rowId:'123e4567-e89b-42d3-a456-426614174004',documentId:'123e4567-e89b-42d3-a456-426614174005',
   documentRevision:context.documentRevision as number+1,jobId:'123e4567-e89b-42d3-a456-426614174006',
   jobRevision:context.jobRevision as number+1,extractionRevision:context.extractionRevision as number+1,
   reviewRevision:context.reviewRevision as number+1,sourceChecksum:changedHash(context.sourceChecksum as string),
   extractionDigest:changedHash(context.extractionDigest as string),mappingDigest:changedHash(context.mappingDigest as string),
   payloadDigest:changedHash(context.payloadDigest as string),planDigest:changedHash(context.planDigest as string),
   tableIndex:(context.tableIndex as number)+1,
  };
  for(const [field,value] of Object.entries(alternatives)){
   invalid(()=>decryptStructuredRowEvidence(envelope,{...context,[field]:value},TEST_KEY));
  }
  invalid(()=>decryptStructuredRowEvidence(envelope,{...context,sourceFormat:'XLSX',coordinateKind:'WORKSHEET_CELL'},TEST_KEY));
  // The coordinate arithmetic is itself strict, so rowIndex/sourceRow and tableFirstRow/sourceRow
  // must move together to create a different valid AAD context.
  invalid(()=>decryptStructuredRowEvidence(envelope,{...context,rowIndex:(context.rowIndex as number)+1,sourceRow:(context.sourceRow as number)+1},TEST_KEY));
  invalid(()=>decryptStructuredRowEvidence(envelope,{...context,tableFirstRow:(context.tableFirstRow as number)+1,sourceRow:(context.sourceRow as number)+1},TEST_KEY));
  invalid(()=>decryptStructuredRowEvidence(envelope,{...context,rowIndex:(context.rowIndex as number)+1},TEST_KEY));
  invalid(()=>decryptStructuredRowEvidence(envelope,{...context,sourceRow:(context.sourceRow as number)+1},TEST_KEY));
  for(const [field,value] of [['schemaVersion',2],['registryVersion','structured-v2'],['mapperVersion','structured-mapper-v2']] as const){
   invalid(()=>decryptStructuredRowEvidence(envelope,{...context,[field]:value},TEST_KEY));
  }
 });

 it('rejects payload, transformed cell, registry field, source coordinate, and private URL mismatches',()=>{
  const {context,evidence}=prepare('tuition_fees','CSV');
  const mutate=(change:(copy:RowEvidence)=>void)=>{const copy=structuredClone(evidence);change(copy);invalid(()=>encryptStructuredRowEvidence(copy,context,TEST_KEY));};
  mutate(copy=>{copy.payload.program_name='different program';});
  mutate(copy=>{const field=copy.fields.find(item=>(item as {field?:string}).field==='program_name') as {extractedValue:string};field.extractedValue='different program';});
  mutate(copy=>{const field=copy.fields.find(item=>(item as {field?:string}).field==='fee_amount') as {transform:string};field.transform='DECIMAL_V1';});
  mutate(copy=>{copy.fields.pop();});
  mutate(copy=>{copy.fields.push(structuredClone(copy.fields[0]));});
  mutate(copy=>{const field=copy.fields.find(item=>(item as {field?:string}).field==='program_name') as {sourceColumn:number};field.sourceColumn=999;});
  mutate(copy=>{copy.sourceLocation.rowStart=3;});

  const html=prepare('university_services','HTML');
  const differentUrl=structuredClone(html.evidence);differentUrl.sourceUrl='https://example.org/another-source';
  invalid(()=>encryptStructuredRowEvidence(differentUrl,html.context,TEST_KEY));
  const unsafeUrl=structuredClone(html.evidence);unsafeUrl.sourceUrl='http://example.org/source';
  invalid(()=>encryptStructuredRowEvidence(unsafeUrl,html.context,TEST_KEY));

  const badContext={...context,payloadDigest:changedHash(context.payloadDigest as string)};
  invalid(()=>encryptStructuredRowEvidence(evidence,badContext,TEST_KEY));
  invalid(()=>encryptStructuredRowEvidence(evidence,{...context,sourceRow:(context.sourceRow as number)+1},TEST_KEY));
 });

 it('requires reviewed, well-formed constants and at least one nonnullable source cell',()=>{
  const sample=prepare('academic_calendar_events','CSV');
  for(const note of ['', '   ', `unsafe\nconstant`]){
   const changed=structuredClone(sample.evidence);
   const constant=changed.fields.find(item=>(item as {kind?:string}).kind==='CONSTANT') as {note:string};
   constant.note=note;
   invalid(()=>encryptStructuredRowEvidence(changed,sample.context,TEST_KEY));
  }
  const badConstant=structuredClone(sample.evidence);
  const constant=badConstant.fields.find(item=>(item as {kind?:string}).kind==='CONSTANT') as {value:unknown};
  constant.value='not the payload value';
  invalid(()=>encryptStructuredRowEvidence(badConstant,sample.context,TEST_KEY));

  const allConstants=structuredClone(sample.evidence);
  allConstants.fields=Object.entries(allConstants.payload).map(([field,value])=>({kind:'CONSTANT',field,value,note:'Reviewed synthetic test constant.'}));
  invalid(()=>encryptStructuredRowEvidence(allConstants,sample.context,TEST_KEY));
 });

 it('rejects accessor, proxy, cyclic, and oversized evidence without invoking caller code or leaking values',()=>{
  const {context,evidence}=prepare();
  const secret='PRIVATE_ROW_SOURCE_DO_NOT_LEAK';
  const accessor=structuredClone(evidence);let getterCalls=0;
  Object.defineProperty(accessor,'sourceUrl',{enumerable:true,configurable:true,get(){getterCalls++;throw new Error(secret);}});
  invalid(()=>encryptStructuredRowEvidence(accessor,context,TEST_KEY),secret);
  expect(getterCalls).toBe(0);
  let proxyTrapCalls=0;
  const proxy=new Proxy(evidence,{ownKeys(){proxyTrapCalls++;throw new Error(secret);}});
  invalid(()=>encryptStructuredRowEvidence(proxy,context,TEST_KEY),secret);
  expect(proxyTrapCalls).toBe(0);
  const cyclic=structuredClone(evidence) as RowEvidence&{extra?:unknown};cyclic.extra=cyclic;
  invalid(()=>encryptStructuredRowEvidence(cyclic,context,TEST_KEY));
  const oversized=structuredClone(evidence);oversized.payload.title='x'.repeat(1_100_000);
  invalid(()=>encryptStructuredRowEvidence(oversized,context,TEST_KEY));
 });

 it('returns detached deeply frozen verified evidence and does not expose serialized caller mutations',()=>{
  const sample=prepare('university_services','HTML');
  const context=sample.context,evidence=structuredClone(sample.evidence);
  const before=structuredClone(evidence);
  const envelope=encryptStructuredRowEvidence(evidence,context,TEST_KEY);
  evidence.payload.name='caller mutation';
  const decoded=decryptStructuredRowEvidence(envelope,context,TEST_KEY) as RowEvidence;
  expect(decoded).toEqual(before);
  expect(Object.isFrozen(decoded)).toBe(true);
  expect(Object.isFrozen(decoded.payload)).toBe(true);
  expect(Object.isFrozen(decoded.fields)).toBe(true);
  expect(Object.isFrozen(decoded.fields[0])).toBe(true);
  expect(Object.isFrozen(decoded.sourceLocation)).toBe(true);
  expect(Reflect.set(decoded.payload,'name','tampered')).toBe(false);
  expect(Reflect.set(decoded.sourceLocation,'blockStart',0)).toBe(false);
 });
});
