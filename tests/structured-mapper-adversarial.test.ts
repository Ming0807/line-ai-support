import {expect,it} from 'vitest';
import {createImportSource} from '../lib/imports/source';
import {buildStructuredMappingPlan,computeStructuredExtractionDigest} from '../lib/imports/structured-mapper';
import {canonicalDigest,computeStructuredMappingDigest,StructuredMappingError,validateStructuredMapping} from '../lib/imports/structured-mapping-contract';
import type {ImportSource,LocatedExtraction} from '../lib/imports/types';
import {structuredMappingFixture} from './fixtures/structured-mapping';

type Fixture=ReturnType<typeof structuredMappingFixture>;
type Range={startRowIndex:number;endRowIndex:number};
type ExcludedRange=Range&{reason:'HEADER'|'NON_DATA';note:string};
type FieldBinding=
 | {kind:'COLUMN';columnIndex:number;transform:string;blank:'REJECT'|'NULL';[key:string]:unknown}
 | {kind:'CONSTANT';value:string|number|null;note:string;[key:string]:unknown};
type TableMapping={tableIndex:number;dataRanges:Range[];excludedRanges:ExcludedRange[];fields:Record<string,FieldBinding>;[key:string]:unknown};
type TestMapping={version:number;registryVersion:string;dataset:string;source:Record<string,unknown>;tables:TableMapping[];excludedTables:Array<{tableIndex:number;reason:'NOT_THIS_DATASET'|'NON_DATA';note:string}>;[key:string]:unknown};
type ErrorCode='STRUCTURED_MAPPING_INVALID'|'STRUCTURED_SOURCE_INVALID'|'STRUCTURED_MAPPING_BINDING_MISMATCH'|'STRUCTURED_MAPPING_ROW_INVALID'|'STRUCTURED_MAPPING_LIMIT_EXCEEDED'|'STRUCTURED_MAPPING_UNSAFE_EXTRACTION';

const dataset='academic_calendar_events' as const;
const fixedErrorCodes:ErrorCode[]=['STRUCTURED_MAPPING_INVALID','STRUCTURED_SOURCE_INVALID','STRUCTURED_MAPPING_BINDING_MISMATCH','STRUCTURED_MAPPING_ROW_INVALID','STRUCTURED_MAPPING_LIMIT_EXCEEDED','STRUCTURED_MAPPING_UNSAFE_EXTRACTION'];

function fixture():Fixture{return structuredMappingFixture(dataset,'CSV');}
function copyMapping(value:Record<string,unknown>):TestMapping{return structuredClone(value) as unknown as TestMapping;}
function errorOf(action:()=>unknown,codes:readonly ErrorCode[]=fixedErrorCodes):StructuredMappingError{
 let caught:unknown;
 try{action();}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(StructuredMappingError);
 const error=caught as StructuredMappingError;
 expect(codes).toContain(error.code);
 expect(String(error)).not.toMatch(/(?:undefined|PRIVATE|SECRET|password|token)/iu);
 return error;
}
function build(value:Fixture,mapping:unknown=value.mapping,options:{source?:ImportSource;extraction?:LocatedExtraction;binding?:Fixture['binding']}={}):ReturnType<typeof buildStructuredMappingPlan>{
 return buildStructuredMappingPlan(options.source??value.source,options.extraction??value.extraction,options.binding??value.binding,mapping);
}
function updateCsvExtraction(extraction:LocatedExtraction):void{
 for(const [index,table] of extraction.tables.entries()){
  const location=extraction.locations.tables[index];
  if(location?.kind!=='CSV')throw new Error('TEST_FIXTURE_EXPECTED_CSV');
  location.rowEnd=table.firstRow+table.rows.length-1;
  location.columnEnd=location.columnStart+Math.max(...table.rows.map(row=>row.length))-1;
 }
 const strings=[...extraction.pages.map(page=>page.text),...extraction.tables.flatMap(table=>table.rows.flat())];
 const cells=extraction.tables.reduce((sum,table)=>sum+table.rows.reduce((total,row)=>total+row.length,0),0);
 let replacementCharacters=0;for(const value of strings)for(const character of value)if(character==='\ufffd')replacementCharacters++;
 extraction.report={...extraction.report,tables:extraction.tables.length,cells,textCharacters:strings.reduce((sum,value)=>sum+value.length,0),replacementCharacters};
}
function addCsvDataRows(extraction:LocatedExtraction,count:number):void{
 const table=extraction.tables[0];if(!table)throw new Error('TEST_FIXTURE_MISSING_TABLE');
 const row=table.rows[1];if(!row)throw new Error('TEST_FIXTURE_MISSING_DATA_ROW');
 for(let index=0;index<count;index++)table.rows.push([...row]);
 updateCsvExtraction(extraction);
}
function addSecondCsvTable(extraction:LocatedExtraction):void{
 const first=extraction.tables[0],location=extraction.locations.tables[0];
 if(!first||location?.kind!=='CSV')throw new Error('TEST_FIXTURE_EXPECTED_CSV');
 const second=structuredClone(first);second.firstRow=20;
 extraction.tables.push(second);
 extraction.locations.tables.push({...location,rowStart:second.firstRow,rowEnd:second.firstRow+second.rows.length-1,tableIndex:2});
 updateCsvExtraction(extraction);
}
function bindMappingToExtraction(mapping:TestMapping,source:ImportSource,extraction:LocatedExtraction):void{
 mapping.source.sourceChecksum=source.checksum;
 mapping.source.extractionDigest=computeStructuredExtractionDigest(source,extraction);
}

it('rejects stale source identities, revisions, checksums and extraction snapshots',()=>{
 const value=fixture();
 expect(computeStructuredExtractionDigest(value.source,value.extraction)).toBe(value.mapping.source && (value.mapping.source as Record<string,unknown>).extractionDigest);
 const mutations:Array<(mapping:TestMapping)=>void>=[
  mapping=>{mapping.source.jobId='223e4567-e89b-42d3-a456-426614174000';},
  mapping=>{mapping.source.jobRevision=(mapping.source.jobRevision as number)+1;},
  mapping=>{mapping.source.extractionRevision=(mapping.source.extractionRevision as number)+1;},
  mapping=>{mapping.source.sourceChecksum='a'.repeat(64);},
  mapping=>{mapping.source.extractionDigest='b'.repeat(64);},
 ];
 for(const mutate of mutations){
  const mapping=copyMapping(value.mapping);mutate(mapping);
  errorOf(()=>build(value,mapping),['STRUCTURED_MAPPING_BINDING_MISMATCH']);
 }
 errorOf(()=>build(value,value.mapping,{binding:{...value.binding,jobRevision:value.binding.jobRevision+1}}),['STRUCTURED_MAPPING_BINDING_MISMATCH']);
 errorOf(()=>build(value,value.mapping,{binding:{...value.binding,extractionRevision:value.binding.extractionRevision+1}}),['STRUCTURED_MAPPING_BINDING_MISMATCH']);

 const corruptSource={...value.source,checksum:'0'.repeat(64)};
 errorOf(()=>build(value,value.mapping,{source:corruptSource}),['STRUCTURED_SOURCE_INVALID']);
 const changedBytes=value.source.bytes.slice();changedBytes[0]=changedBytes[0]===65?66:65;
 const newerSource=createImportSource({bytes:changedBytes,filename:value.source.filename,mimeType:value.source.mimeType,sourceUrl:value.source.sourceUrl,acquiredFrom:value.source.acquiredFrom,fetchedAt:value.source.fetchedAt});
 errorOf(()=>build(value,value.mapping,{source:newerSource}),['STRUCTURED_MAPPING_BINDING_MISMATCH']);

 const changedExtraction=structuredClone(value.extraction);
 const title=changedExtraction.tables[0]!.rows[1]![4]!;
 changedExtraction.tables[0]!.rows[1]![4]='x'.repeat(title.length);
 expect(computeStructuredExtractionDigest(value.source,changedExtraction)).not.toBe(value.mapping.source && (value.mapping.source as Record<string,unknown>).extractionDigest);
 errorOf(()=>build(value,value.mapping,{extraction:changedExtraction}),['STRUCTURED_MAPPING_BINDING_MISMATCH']);

 const laterReview=build(value,value.mapping,{binding:{...value.binding,reviewRevision:value.binding.reviewRevision+1}});
 expect(laterReview.binding.reviewRevision).toBe(value.binding.reviewRevision+1);
 expect(laterReview.digest).not.toBe(build(value).digest);
});

it('requires selected/excluded tables and row ranges to cover every source position exactly once',()=>{
 const value=fixture();
 const omittedHeader=copyMapping(value.mapping);
 omittedHeader.tables[0]!.excludedRanges=[];
 errorOf(()=>build(value,omittedHeader),['STRUCTURED_MAPPING_INVALID','STRUCTURED_MAPPING_ROW_INVALID']);

 const overlapping=copyMapping(value.mapping);
 overlapping.tables[0]!.excludedRanges.push({startRowIndex:1,endRowIndex:1,reason:'NON_DATA',note:'Overlaps a selected row.'});
 errorOf(()=>build(value,overlapping),['STRUCTURED_MAPPING_INVALID']);

 const outside=copyMapping(value.mapping);
 outside.tables[0]!.dataRanges=[{startRowIndex:1,endRowIndex:2}];
 errorOf(()=>build(value,outside),['STRUCTURED_MAPPING_INVALID','STRUCTURED_MAPPING_ROW_INVALID']);

 const extraction=structuredClone(value.extraction);addSecondCsvTable(extraction);
 const mapping=copyMapping(value.mapping);bindMappingToExtraction(mapping,value.source,extraction);
 errorOf(()=>build(value,mapping,{extraction}),['STRUCTURED_MAPPING_INVALID']);
 mapping.excludedTables=[{tableIndex:1,reason:'NOT_THIS_DATASET',note:'Second synthetic table belongs to another dataset.'}];
 expect(build(value,mapping,{extraction}).rows).toHaveLength(1);

 const duplicate=copyMapping(value.mapping);duplicate.tables.push(structuredClone(duplicate.tables[0]!));
 errorOf(()=>validateStructuredMapping(duplicate),['STRUCTURED_MAPPING_INVALID']);
});

it('canonicalizes reordered table, row-range and exclusion selections without reordering source rows',()=>{
 const value=fixture();
 const extraction=structuredClone(value.extraction);addCsvDataRows(extraction,2);addSecondCsvTable(extraction);
 const sorted=copyMapping(value.mapping),table0=structuredClone(sorted.tables[0]!);
 table0.dataRanges=[{startRowIndex:1,endRowIndex:1},{startRowIndex:2,endRowIndex:2}];
 table0.excludedRanges=[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'Header.'},{startRowIndex:3,endRowIndex:3,reason:'NON_DATA',note:'Footer.'}];
 const table1=structuredClone(table0);table1.tableIndex=1;
 sorted.tables=[table0,table1];bindMappingToExtraction(sorted,value.source,extraction);
 const canonical=build(value,sorted,{extraction});

 const reversed=copyMapping(value.mapping);
 const reversedTable0=structuredClone(table0);
 reversedTable0.dataRanges.reverse();reversedTable0.excludedRanges.reverse();
 const reversedTable1=structuredClone(table1);
 reversedTable1.dataRanges.reverse();reversedTable1.excludedRanges.reverse();
 reversed.tables=[reversedTable1,reversedTable0];bindMappingToExtraction(reversed,value.source,extraction);
 const reordered=build(value,reversed,{extraction});

 expect(reordered.mappingDigest).toBe(canonical.mappingDigest);
 expect(reordered.digest).toBe(canonical.digest);
 expect(reordered.rows.map(row=>[row.tableIndex,row.rowIndex])).toEqual([[0,1],[0,2],[1,1],[1,2]]);
});

it('rejects globally unsafe extraction flags, ragged selected rows and missing mapped columns',()=>{
 const unsafeFlags=['FORMULAS_PRESENT','HIDDEN_DATA_REVIEW','UNSUPPORTED_TABLES','ENCRYPTED_SOURCE'] as const;
 for(const flag of unsafeFlags){
  const value=fixture(),extraction=structuredClone(value.extraction);
  extraction.flags.push(flag);
  extraction.report.warnings.push({code:flag,severity:'BLOCKING',location:extraction.locations.tables[0]!,count:1,disposition:'UNRESOLVED'});
  const mapping=copyMapping(value.mapping);bindMappingToExtraction(mapping,value.source,extraction);
  errorOf(()=>build(value,mapping,{extraction}),['STRUCTURED_MAPPING_UNSAFE_EXTRACTION']);
 }

 const ragged=fixture(),raggedExtraction=structuredClone(ragged.extraction);
 const shortRow=[...raggedExtraction.tables[0]!.rows[1]!];shortRow.pop();raggedExtraction.tables[0]!.rows.push(shortRow);updateCsvExtraction(raggedExtraction);
 const raggedMapping=copyMapping(ragged.mapping);raggedMapping.tables[0]!.dataRanges=[{startRowIndex:1,endRowIndex:2}];bindMappingToExtraction(raggedMapping,ragged.source,raggedExtraction);
 errorOf(()=>build(ragged,raggedMapping,{extraction:raggedExtraction}),['STRUCTURED_MAPPING_ROW_INVALID','STRUCTURED_MAPPING_INVALID']);

 const missing=fixture(),missingMapping=copyMapping(missing.mapping);
 const titleBinding=missingMapping.tables[0]!.fields.title;
 if(titleBinding.kind!=='COLUMN')throw new Error('TEST_FIXTURE_TITLE_MUST_BE_COLUMN');
 titleBinding.columnIndex=255;
 errorOf(()=>build(missing,missingMapping),['STRUCTURED_MAPPING_ROW_INVALID','STRUCTURED_MAPPING_INVALID']);
});

it('preserves unresolved non-DOCX table-shape evidence while rejecting DOCX ambiguity',()=>{
 for(const format of ['PDF','CSV','HTML','XLSX'] as const){
  const value=structuredMappingFixture(dataset,format),extraction=structuredClone(value.extraction);
  extraction.flags.push('TABLE_SHAPE_REVIEW');
  extraction.report.warnings.push({code:'TABLE_SHAPE_REVIEW',severity:'REVIEW',location:extraction.locations.tables[0]!,count:1,disposition:'UNRESOLVED'});
  const mapping=copyMapping(value.mapping);bindMappingToExtraction(mapping,value.source,extraction);
  const plan=build(value,mapping,{extraction});
  expect(plan.requiresReview).toBe(true);
  expect(plan.flags).toContain('TABLE_SHAPE_REVIEW');
  expect(plan.warnings.map(warning=>warning.code)).toContain('TABLE_SHAPE_REVIEW');
 }

 const docx=structuredMappingFixture(dataset,'DOCX'),docxExtraction=structuredClone(docx.extraction);
 docxExtraction.flags.push('TABLE_SHAPE_REVIEW');
 docxExtraction.report.warnings.push({code:'TABLE_SHAPE_REVIEW',severity:'REVIEW',location:docxExtraction.locations.tables[0]!,count:1,disposition:'UNRESOLVED'});
 const docxMapping=copyMapping(docx.mapping);bindMappingToExtraction(docxMapping,docx.source,docxExtraction);
 errorOf(()=>build(docx,docxMapping,{extraction:docxExtraction}),['STRUCTURED_MAPPING_UNSAFE_EXTRACTION']);
});

it('requires a source column bound to a nonnullable target and rejects backend-owned DTO fields',()=>{
 const nullableOnly=structuredMappingFixture('university_services','CSV'),nullableOnlyMapping=copyMapping(nullableOnly.mapping);
 for(const field of Object.keys(nullableOnlyMapping.tables[0]!.fields)){
  if(field==='description')continue;
  nullableOnlyMapping.tables[0]!.fields[field]={kind:'CONSTANT',value:nullableOnly.expectedPayload[field]??null,note:'Explicit adversarial test constant.'};
 }
 expect(nullableOnlyMapping.tables[0]!.fields.description?.kind).toBe('COLUMN');
 errorOf(()=>build(nullableOnly,nullableOnlyMapping),['STRUCTURED_MAPPING_INVALID']);

 const value=fixture(),constantOnly=copyMapping(value.mapping);
 for(const field of Object.keys(constantOnly.tables[0]!.fields)){
  constantOnly.tables[0]!.fields[field]={kind:'CONSTANT',value:value.expectedPayload[field]??null,note:'Explicit adversarial test constant.'};
 }
 errorOf(()=>build(value,constantOnly),['STRUCTURED_MAPPING_INVALID']);

 for(const field of ['id','document_id','department_id','created_at','updated_at','active','is_current','rows','payload','tableName','sql']){
  const mapping=copyMapping(value.mapping);mapping[field]='backend-owned';
  errorOf(()=>validateStructuredMapping(mapping),['STRUCTURED_MAPPING_INVALID']);
 }
 const nested=copyMapping(value.mapping);nested.source.document_id='backend-owned';
 errorOf(()=>validateStructuredMapping(nested),['STRUCTURED_MAPPING_INVALID']);
 const extraTarget=copyMapping(value.mapping);extraTarget.tables[0]!.fields.document_id={kind:'CONSTANT',value:'private',note:'Backend field.'};
 errorOf(()=>validateStructuredMapping(extraTarget),['STRUCTURED_MAPPING_INVALID']);
 const extraBinding=copyMapping(value.mapping);extraBinding.tables[0]!.fields.title!.sourceColumn='caller-selected';
 errorOf(()=>validateStructuredMapping(extraBinding),['STRUCTURED_MAPPING_INVALID']);
});

it('rejects descriptor, proxy, prototype, symbol and cyclic DTO attacks with fixed errors',()=>{
 const value=fixture();let getterCalls=0;let proxyTrapCalls=0;let toJsonCalls=0;
 const accessor=copyMapping(value.mapping);
 Object.defineProperty(accessor,'dataset',{enumerable:true,configurable:true,get(){getterCalls++;throw new Error('PRIVATE_MAPPING_GETTER');}});
 errorOf(()=>validateStructuredMapping(accessor),['STRUCTURED_MAPPING_INVALID']);
 expect(getterCalls).toBe(0);

 const proxied=new Proxy(copyMapping(value.mapping),{ownKeys(){proxyTrapCalls++;throw new Error('PRIVATE_PROXY_TRAP');}});
 errorOf(()=>validateStructuredMapping(proxied),['STRUCTURED_MAPPING_INVALID']);
 expect(proxyTrapCalls).toBe(0);

 const inherited=Object.assign(Object.create({private:'prototype'}),copyMapping(value.mapping));
 errorOf(()=>validateStructuredMapping(inherited),['STRUCTURED_MAPPING_INVALID']);
 const symbolExtra=copyMapping(value.mapping);Object.defineProperty(symbolExtra,Symbol('backend'),{value:'private',enumerable:true});
 errorOf(()=>validateStructuredMapping(symbolExtra),['STRUCTURED_MAPPING_INVALID']);
 const hiddenExtra=copyMapping(value.mapping);Object.defineProperty(hiddenExtra,'privateHidden',{value:'private',enumerable:false});
 errorOf(()=>validateStructuredMapping(hiddenExtra),['STRUCTURED_MAPPING_INVALID']);
 const cyclic=copyMapping(value.mapping);cyclic.untrusted=cyclic;
 errorOf(()=>validateStructuredMapping(cyclic),['STRUCTURED_MAPPING_INVALID']);
 const withToJson=copyMapping(value.mapping);Object.defineProperty(withToJson,'toJSON',{enumerable:true,value(){toJsonCalls++;return {};}});
 errorOf(()=>validateStructuredMapping(withToJson),['STRUCTURED_MAPPING_INVALID']);
 expect(toJsonCalls).toBe(0);
});

it('returns sanitized row failures with only safe zero-based source coordinates',()=>{
 const value=fixture(),extraction=structuredClone(value.extraction),secret='SECRET_X99';
 extraction.tables[0]!.rows[1]![5]=secret;
 const mapping=copyMapping(value.mapping);bindMappingToExtraction(mapping,value.source,extraction);
 const error=errorOf(()=>build(value,mapping,{extraction}),['STRUCTURED_MAPPING_ROW_INVALID']);
 expect(error.message).not.toContain(secret);
 expect(String(error)).not.toContain(secret);
 expect(JSON.stringify(error)).not.toContain(secret);
 if(error.location){
  expect(Object.keys(error.location).sort()).toEqual(['field','rowIndex','tableIndex']);
  expect(error.location).toMatchObject({tableIndex:0,rowIndex:1,field:'start_date'});
 }
});

it('canonicalizes DTO and digest order while binding semantic changes and separating domains',()=>{
 const value=fixture(),mapping=copyMapping(value.mapping);
 const parsed=validateStructuredMapping(mapping);
 const table=mapping.tables[0]!;
 const reordered={excludedTables:mapping.excludedTables,tables:[{fields:Object.fromEntries(Object.entries(table.fields).reverse()),excludedRanges:table.excludedRanges,dataRanges:table.dataRanges,tableIndex:table.tableIndex}],
  source:{extractionDigest:mapping.source.extractionDigest,sourceChecksum:mapping.source.sourceChecksum,extractionRevision:mapping.source.extractionRevision,jobRevision:mapping.source.jobRevision,jobId:mapping.source.jobId},
  dataset:mapping.dataset,registryVersion:mapping.registryVersion,version:mapping.version};
 const parsedReordered=validateStructuredMapping(reordered);
 expect(Object.keys(parsedReordered.tables[0]!.fields)).toEqual(Object.keys(parsed.tables[0]!.fields));
 expect(computeStructuredMappingDigest(parsedReordered)).toBe(computeStructuredMappingDigest(parsed));
 expect(canonicalDigest('same-domain',{a:1,b:2})).toBe(canonicalDigest('same-domain',{b:2,a:1}));
 expect(canonicalDigest('same-domain',[1,2])).not.toBe(canonicalDigest('same-domain',[2,1]));
 expect(canonicalDigest('same-domain',{a:1})).not.toBe(canonicalDigest('other-domain',{a:1}));

 const changedConstant=copyMapping(value.mapping);const constant=changedConstant.tables[0]!.fields.end_date;
 if(constant.kind!=='CONSTANT')throw new Error('TEST_FIXTURE_EXPECTED_CONSTANT');
 constant.note=`${constant.note} Reviewed. `;
 expect(computeStructuredMappingDigest(validateStructuredMapping(changedConstant))).not.toBe(computeStructuredMappingDigest(parsed));
 const changedExclusion=copyMapping(value.mapping);changedExclusion.tables[0]!.excludedRanges[0]!.reason='NON_DATA';
 expect(computeStructuredMappingDigest(validateStructuredMapping(changedExclusion))).not.toBe(computeStructuredMappingDigest(parsed));
});

it('enforces DTO byte, node, depth and selected-row limits with fixed errors',()=>{
 const value=fixture();
 const bytes=copyMapping(value.mapping);bytes.untrusted='x'.repeat(256*1024+1);
 errorOf(()=>validateStructuredMapping(bytes),['STRUCTURED_MAPPING_LIMIT_EXCEEDED']);
 const nodes=copyMapping(value.mapping);nodes.untrusted=Array.from({length:10_000},()=>[0,0]);
 errorOf(()=>validateStructuredMapping(nodes),['STRUCTURED_MAPPING_LIMIT_EXCEEDED']);
 const deep=copyMapping(value.mapping);let nested:unknown=0;for(let index=0;index<32;index++)nested=[nested];deep.untrusted=nested;
 errorOf(()=>validateStructuredMapping(deep),['STRUCTURED_MAPPING_LIMIT_EXCEEDED']);

 const tooMany=fixture(),extraction=structuredClone(tooMany.extraction);
 addCsvDataRows(extraction,2_000);
 const mapping=copyMapping(tooMany.mapping);mapping.tables[0]!.dataRanges=[{startRowIndex:1,endRowIndex:2_001}];bindMappingToExtraction(mapping,tooMany.source,extraction);
 errorOf(()=>build(tooMany,mapping,{extraction}),['STRUCTURED_MAPPING_LIMIT_EXCEEDED']);
});

it('returns a detached frozen artifact that does not change when callers mutate their inputs',()=>{
 const value=fixture(),mapping=copyMapping(value.mapping),extraction=structuredClone(value.extraction);
 const beforeMapping=structuredClone(mapping),beforeCell=extraction.tables[0]!.rows[1]![4]!;
 const plan=build(value,mapping,{extraction});const digest=plan.digest;
 const title=mapping.tables[0]!.fields.title;
 if(title.kind!=='COLUMN')throw new Error('TEST_FIXTURE_TITLE_MUST_BE_COLUMN');
 title.transform='DATE_GREGORIAN_V1';
 extraction.tables[0]!.rows[1]![4]='caller mutation';

 expect(plan.digest).toBe(digest);
 expect(plan.mapping).toEqual(beforeMapping);
 expect(plan.rows[0]!.payload).toHaveProperty('title',beforeCell);
 expect(Object.isFrozen(plan)).toBe(true);
 expect(Object.isFrozen(plan.mapping)).toBe(true);
 expect(Object.isFrozen(plan.mapping.tables)).toBe(true);
 expect(Object.isFrozen(plan.rows)).toBe(true);
 expect(Object.isFrozen(plan.rows[0]!.payload)).toBe(true);
 expect(Reflect.set(plan.rows[0]!.payload,'title','tampered')).toBe(false);
});
