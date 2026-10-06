import {describe,expect,it} from 'vitest';
import {buildStructuredMappingPlan,computeStructuredExtractionDigest} from '../lib/imports/structured-mapper';
import {computeStructuredMappingDigest} from '../lib/imports/structured-mapping-contract';
import {structuredMappingFixture} from './fixtures/structured-mapping';
import {datasetTypes,importFormats} from '../lib/imports/types';

const sourceCoordinates={
 XLSX:{kind:'WORKSHEET_CELL',sourceRow:10,sourceColumnOffset:4},
 CSV:{kind:'CSV_RECORD',sourceRow:5,sourceColumnOffset:3},
 PDF:{kind:'EXTRACTED_LOGICAL',sourceRow:8,sourceColumnOffset:1},
 DOCX:{kind:'EXTRACTED_LOGICAL',sourceRow:14,sourceColumnOffset:1},
 HTML:{kind:'EXTRACTED_LOGICAL',sourceRow:22,sourceColumnOffset:1},
} as const;

describe.each(datasetTypes)('structured mapping payloads for %s',dataset=>{
 it.each(importFormats)('maps a validated synthetic %s extraction with exact values and source evidence',format=>{
  const fixture=structuredMappingFixture(dataset,format);
  const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
  const firstMapping=fixture.mapping.tables instanceof Array?fixture.mapping.tables[0] as {fields:Record<string,{kind:string;columnIndex?:number}>}:undefined;
  const firstColumn=Object.entries(firstMapping?.fields??{}).find(([,binding])=>binding.kind==='COLUMN');
  expect(firstColumn).toBeDefined();
  const [field,columnBinding]=firstColumn!;
  const columnIndex=columnBinding.columnIndex!;
  const coordinates=sourceCoordinates[format];

  expect(plan).toMatchObject({
   schemaVersion:1,mapperVersion:'structured-mapper-v1',registryVersion:'structured-v1',dataset,
   binding:fixture.binding,sourceChecksum:fixture.source.checksum,sourceFormat:format,
   extractionDigest:computeStructuredExtractionDigest(fixture.source,fixture.extraction),
   requiresReview:true,rows:[{index:0,tableIndex:0,rowIndex:1,payload:fixture.expectedPayload}],
  });
  const row=plan.rows[0];
  expect(row.payloadDigest).toMatch(/^[a-f0-9]{64}$/u);
  expect(row.coordinateKind).toBe(coordinates.kind);
  expect(row.sourceRow).toBe(coordinates.sourceRow);
  expect(row.sourceLocation).toEqual(fixture.extraction.locations.tables[0]);
  const cell=row.fields.find(evidence=>evidence.kind==='CELL'&&evidence.field===field);
  expect(cell).toMatchObject({
   kind:'CELL',field,columnIndex,extractedValue:fixture.extraction.tables[0]!.rows[1]![columnIndex],
   sourceColumn:coordinates.sourceColumnOffset+columnIndex,
  });
  expect(plan.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(plan.mappingDigest).toBe(computeStructuredMappingDigest(plan.mapping));
 });
});

describe('structured mapping source-bound review artifact',()=>{
 it('distinguishes labelled constants from cell evidence',()=>{
  const fixture=structuredMappingFixture('academic_calendar_events','CSV');
  const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
  const row=plan.rows[0];
  expect(row.payload).toMatchObject({end_date:null});
  expect(row.fields.find(field=>field.field==='end_date')).toMatchObject({
   kind:'CONSTANT',field:'end_date',value:null,note:'No end date is stated in this synthetic row.',
  });
  expect(row.fields.some(field=>field.field==='end_date'&&field.kind==='CELL')).toBe(false);
  expect(row.fields.find(field=>field.field==='title')).toMatchObject({
   kind:'CELL',field:'title',columnIndex:4,extractedValue:'ลงทะเบียน',transform:'TEXT_V1',
  });
 });

 it('keeps a quoted multiline CSV cell in its logical record coordinate',()=>{
  const fixture=structuredMappingFixture('university_services','CSV');
  expect(fixture.extraction.report.parser).toEqual({name:'synthetic-mapping-fixture',version:'1'});
  const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
  const evidence=plan.rows[0].fields.find(field=>field.field==='description');

  expect(fixture.source.bytes).toContain(13);
  expect(evidence).toMatchObject({kind:'CELL',extractedValue:'first line\r\nsecond line',sourceColumn:5});
  expect(plan.rows[0]).toMatchObject({coordinateKind:'CSV_RECORD',sourceRow:5,rowIndex:1});
 });

 it('canonicalizes object property order and binds the review revision into the artifact digest',()=>{
  const fixture=structuredMappingFixture('tuition_fees','XLSX');
  const canonical=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
  const mapping=fixture.mapping as {version:number;registryVersion:string;dataset:string;source:Record<string,unknown>;tables:Array<Record<string,unknown>>;excludedTables:unknown[]};
  const originalTable=mapping.tables[0]!;
  const originalFields=originalTable.fields as Record<string,unknown>;
  const reordered={
   excludedTables:mapping.excludedTables,
   tables:[{fields:Object.fromEntries(Object.entries(originalFields).reverse()),excludedRanges:originalTable.excludedRanges,dataRanges:originalTable.dataRanges,tableIndex:originalTable.tableIndex}],
   source:{...mapping.source},dataset:mapping.dataset,registryVersion:mapping.registryVersion,version:mapping.version,
  };
  const reorderedPlan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,reordered);
  const laterReview=buildStructuredMappingPlan(fixture.source,fixture.extraction,{...fixture.binding,reviewRevision:fixture.binding.reviewRevision+1},fixture.mapping);

  expect(reorderedPlan.mappingDigest).toBe(canonical.mappingDigest);
  expect(reorderedPlan.digest).toBe(canonical.digest);
  expect(laterReview.mappingDigest).toBe(canonical.mappingDigest);
  expect(laterReview.digest).not.toBe(canonical.digest);
  expect(canonical.rows[0].payload).toMatchObject({fee_amount:'1234.50'});
 });

 it('returns a deeply frozen detached artifact',()=>{
  const fixture=structuredMappingFixture('university_services','HTML');
  const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
  const extractedBefore=fixture.extraction.tables[0]!.rows[1]![1];

  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.binding)).toBe(true);
  expect(Object.isFrozen(plan.mapping)).toBe(true);
  expect(Object.isFrozen(plan.mapping.tables)).toBe(true);
  expect(Object.isFrozen(plan.mapping.tables[0].fields)).toBe(true);
  expect(Object.isFrozen(plan.rows)).toBe(true);
  expect(Object.isFrozen(plan.rows[0])).toBe(true);
  expect(Object.isFrozen(plan.rows[0].payload)).toBe(true);
  expect(Object.isFrozen(plan.rows[0].fields)).toBe(true);
  expect(Object.isFrozen(plan.rows[0].fields[0])).toBe(true);
  expect(plan.mapping).not.toBe(fixture.mapping);
  fixture.extraction.tables[0]!.rows[1]![1]='changed after plan creation';
  const sourceFields=(fixture.mapping.tables as Array<{fields:Record<string,unknown>}>)[0]!.fields;
  sourceFields.name='caller mutation';
  expect(plan.rows[0].payload).toMatchObject({name:extractedBefore});
  expect((plan.mapping.tables[0].fields as Record<string,unknown>).name).not.toBe('caller mutation');
  expect(plan.rows[0].fields.find(field=>field.field==='name')).toMatchObject({extractedValue:extractedBefore});
 });
});
