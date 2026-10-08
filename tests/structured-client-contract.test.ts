import {describe,expect,it} from 'vitest';
import {getStructuredRegistryEntry} from '../lib/knowledge/structured-registry';
import {isStructuredTransformCompatible,structuredTransforms,validateStructuredMapping} from '../lib/imports/structured-mapping-contract';
import {
 STRUCTURED_DATASETS,STRUCTURED_FIELD_REGISTRY,STRUCTURED_TRANSFORMS,StructuredRequestGate,
 buildStructuredMappingFromDecisions,compatibleStructuredTransforms,parseStructuredPreviewEnvelope,parseStructuredSourceEnvelope,
 parseStructuredMappingDraft,partitionRows,structuredColumnLabel,structuredRowLabel,validateStructuredPlanSnapshot,
} from '../app/(dashboard)/knowledge/import/structured-client-contract';
import {structuredClientContractFixture,structuredClientRevalidationFixture} from './fixtures/structured-client-contract';
import {structuredMappingFixture} from './fixtures/structured-mapping';

describe('browser-safe structured mapping contract',()=>{
 it('matches every source registry field and the complete versioned transform vocabulary',()=>{
  expect(STRUCTURED_TRANSFORMS).toEqual(structuredTransforms);
  for(const dataset of STRUCTURED_DATASETS){
   const metadata=(field:{name:string;kind:string;nullable:boolean;maxLength?:number;precision?:number;scale?:number;min?:number;max?:number})=>
    Object.fromEntries(Object.entries(field).filter(([key,value])=>['name','kind','nullable','maxLength','precision','scale','min','max'].includes(key)&&value!==undefined));
   const serverFields=getStructuredRegistryEntry(dataset).fields;
   expect(STRUCTURED_FIELD_REGISTRY[dataset].map(metadata)).toEqual(serverFields.map(metadata));
   for(const field of STRUCTURED_FIELD_REGISTRY[dataset])for(const transform of STRUCTURED_TRANSFORMS){
    expect(compatibleStructuredTransforms(field.kind).includes(transform)).toBe(isStructuredTransformCompatible(transform,field.kind));
   }
  }
 });

 it('partitions every source row around multiple explicit middle exclusions',()=>{
  expect(partitionRows(8,[
   {startRowIndex:2,endRowIndex:3,reason:'HEADER',note:'This is the repeated heading row.'},
   {startRowIndex:6,endRowIndex:6,reason:'NON_DATA',note:'This is the source total row.'},
  ])).toEqual({dataRanges:[{startRowIndex:0,endRowIndex:1},{startRowIndex:4,endRowIndex:5},{startRowIndex:7,endRowIndex:7}],
   excludedRanges:[{startRowIndex:2,endRowIndex:3,reason:'HEADER',note:'This is the repeated heading row.'},
    {startRowIndex:6,endRowIndex:6,reason:'NON_DATA',note:'This is the source total row.'}]});
  expect(partitionRows(8,[{startRowIndex:2,endRowIndex:4,reason:'NON_DATA',note:''}])).toBeNull();
  expect(partitionRows(8,[{startRowIndex:2,endRowIndex:4,reason:'NON_DATA',note:'middle rows'},
   {startRowIndex:4,endRowIndex:5,reason:'HEADER',note:'overlaps'}])).toBeNull();
 });

 it('requires an explicit disposition and human note for every source table',()=>{
  const {fixture,expectedMapping}=structuredClientContractFixture();
  const fields=(expectedMapping as {tables:Array<{fields:Record<string,unknown>}>}).tables[0]!.fields;
  const base={dataset:'tuition_fees' as const,source:expectedMapping.source,
   tables:[{tableIndex:0,rowCount:4,columnCount:9},{tableIndex:1,rowCount:2,columnCount:3}]};
  expect(buildStructuredMappingFromDecisions({...base,decisions:[
   {kind:'MAPPED',tableIndex:0,fields,excludedRanges:[{startRowIndex:1,endRowIndex:1,reason:'NON_DATA',note:'Subtotal row.'}]},
   {kind:'EXCLUDED',tableIndex:1,reason:'NOT_THIS_DATASET',note:'Second table is a document legend.'},
  ]})).toMatchObject({tables:[{tableIndex:0,dataRanges:[{startRowIndex:0,endRowIndex:0},{startRowIndex:2,endRowIndex:3}]}],
   excludedTables:[{tableIndex:1,reason:'NOT_THIS_DATASET',note:'Second table is a document legend.'}]});
  expect(buildStructuredMappingFromDecisions({...base,decisions:[
   {kind:'MAPPED',tableIndex:0,fields,excludedRanges:[]},
   {kind:'EXCLUDED',tableIndex:1,reason:'NON_DATA',note:''},
  ]})).toBeNull();
  const constantFields={...fields,major_name:{kind:'CONSTANT',value:null,note:'ค่านี้ไม่มีในเอกสารต้นทาง'}};
  expect(buildStructuredMappingFromDecisions({...base,decisions:[
   {kind:'MAPPED',tableIndex:0,fields:constantFields,excludedRanges:[]},
   {kind:'EXCLUDED',tableIndex:1,reason:'NOT_THIS_DATASET',note:'This table is a document legend.'},
  ]})).not.toBeNull();
  const undocumentedConstant={...constantFields,major_name:{kind:'CONSTANT',value:null,note:''}};
  expect(buildStructuredMappingFromDecisions({...base,decisions:[
   {kind:'MAPPED',tableIndex:0,fields:undocumentedConstant,excludedRanges:[]},
   {kind:'EXCLUDED',tableIndex:1,reason:'NOT_THIS_DATASET',note:'This table is a document legend.'},
  ]})).toBeNull();
  const constantValues:Record<string,string|number|null>={academic_year:2569,program_name:'หลักสูตรตัวอย่าง',major_name:null,
   student_group:'นักศึกษาทั่วไป',study_type:'ภาคปกติ',fee_amount:'120.00',currency:'THB',effective_from:'2026-01-01',effective_to:null};
  const allConstants=Object.fromEntries(Object.keys(fields).map(name=>[name,{kind:'CONSTANT',value:constantValues[name],note:'ระบุจากเอกสารต้นทาง'}]));
  expect(buildStructuredMappingFromDecisions({...base,decisions:[
   {kind:'MAPPED',tableIndex:0,fields:allConstants,excludedRanges:[]},
   {kind:'EXCLUDED',tableIndex:1,reason:'NOT_THIS_DATASET',note:'This table is a document legend.'},
  ]})).toBeNull();
  const multiple=buildStructuredMappingFromDecisions({...base,tables:[{tableIndex:0,rowCount:4,columnCount:9},{tableIndex:1,rowCount:2,columnCount:9}],decisions:[
   {kind:'MAPPED',tableIndex:0,fields,excludedRanges:[{startRowIndex:1,endRowIndex:1,reason:'NON_DATA',note:'Subtotal row.'}]},
   {kind:'MAPPED',tableIndex:1,fields,excludedRanges:[]},
  ]});
  expect(multiple?.tables.map(table=>table.tableIndex)).toEqual([0,1]);
  expect(multiple?.excludedTables).toEqual([]);
  expect(fixture.extraction.tables).toHaveLength(1);
 });

 it('keeps physical spreadsheet coordinates distinct from extracted logical rows',()=>{
  const csv=structuredMappingFixture('tuition_fees','CSV'),xlsx=structuredMappingFixture('tuition_fees','XLSX'),pdf=structuredMappingFixture('tuition_fees','PDF');
  expect(structuredColumnLabel(csv.extraction.locations.tables[0]!,0)).toBe('CSV · คอลัมน์ 3');
  expect(structuredRowLabel({tableIndex:0,...csv.extraction.tables[0]!,location:csv.extraction.locations.tables[0]!},1)).toBe('CSV · ระเบียน 5');
  expect(structuredColumnLabel(xlsx.extraction.locations.tables[0]!,0)).toBe('Synthetic!D · คอลัมน์ต้นฉบับ 4');
  expect(structuredRowLabel({tableIndex:0,...xlsx.extraction.tables[0]!,location:xlsx.extraction.locations.tables[0]!},1)).toBe('Synthetic · แถว 10');
  expect(structuredRowLabel({tableIndex:0,...pdf.extraction.tables[0]!,location:pdf.extraction.locations.tables[0]!},1)).toBe('PDF หน้า 4 · แถวที่อ่านได้ 8');
 });

 it('rejects a restored mapping with missing field bindings or a malformed source note',()=>{
  const {expectedMapping}=structuredClientContractFixture();
  expect(parseStructuredMappingDraft(expectedMapping)).not.toBeNull();
  const missingField=structuredClone(expectedMapping);
  delete missingField.tables[0]!.fields.academic_year;
  expect(parseStructuredMappingDraft(missingField)).toBeNull();
  const badNote=structuredClone(expectedMapping);
  badNote.tables[0]!.excludedRanges[0]!.note='   ';
  expect(parseStructuredMappingDraft(badNote)).toBeNull();
 });

 it('strictly parses the source and preview envelopes against the requested job',()=>{
  const {fixture,source,preview}=structuredClientContractFixture();
  expect(parseStructuredSourceEnvelope(source,fixture.binding.jobId)).not.toBeNull();
  expect(parseStructuredPreviewEnvelope(preview,fixture.binding.jobId)).not.toBeNull();
  expect(parseStructuredSourceEnvelope({...source,extra:'ignored'},fixture.binding.jobId)).toBeNull();
  expect(parseStructuredSourceEnvelope(source,'323e4567-e89b-42d3-a456-426614174000')).toBeNull();
  expect(parseStructuredPreviewEnvelope(preview,'323e4567-e89b-42d3-a456-426614174000')).toBeNull();
  const malformed=structuredClone(preview);
  if(malformed.preview.extraction.locations.tables[0]?.kind==='XLSX')malformed.preview.extraction.locations.tables[0].columnStart=0;
  expect(parseStructuredPreviewEnvelope(malformed,fixture.binding.jobId)).toBeNull();
 });

 it('validates the server plan, row equality, all digests and the server acknowledgment before restore',async()=>{
  const {fixture,source,preview,snapshot,expectedMapping}=structuredClientContractFixture();
  const parsedSource=parseStructuredSourceEnvelope(source,fixture.binding.jobId);
  const parsedPreview=parseStructuredPreviewEnvelope(preview,fixture.binding.jobId);
  expect(parsedSource).not.toBeNull();expect(parsedPreview).not.toBeNull();
  const expected={source:parsedSource!,preview:parsedPreview!,mapping:validateStructuredMapping(expectedMapping)};
  expect(await validateStructuredPlanSnapshot(snapshot,expected)).not.toBeNull();
  const cases=[
   (body:typeof snapshot)=>{body.snapshot.jobRevision++;},
   (body:typeof snapshot)=>{body.snapshot.plan.rows.pop();},
   (body:typeof snapshot)=>{body.snapshot.plan.rows[0]!.sourceRow++;},
   (body:typeof snapshot)=>{(body.snapshot.plan.rows[0]!.payload as Record<string,unknown>).fee_amount='999.00';},
   (body:typeof snapshot)=>{body.snapshot.acknowledgment.contentDigest='f'.repeat(64);},
   (body:typeof snapshot)=>{body.snapshot.publicationAvailable='true' as unknown as boolean;},
  ];
  for(const mutate of cases){const corrupted=structuredClone(snapshot);mutate(corrupted);expect(await validateStructuredPlanSnapshot(corrupted,expected)).toBeNull();}
 });

 it('revalidates a saved acknowledgment after the review counter advances',async()=>{
  const original=structuredClientContractFixture(),savedAck=original.snapshot.snapshot.acknowledgment;
  const current=structuredClientRevalidationFixture(original.snapshot.snapshot.nextReviewRevision);
  const currentSource=parseStructuredSourceEnvelope(current.source,current.fixture.binding.jobId);
  const currentPreview=parseStructuredPreviewEnvelope(current.preview,current.fixture.binding.jobId);
  expect(currentSource).not.toBeNull();expect(currentPreview).not.toBeNull();
  expect(current.snapshot.snapshot.acknowledgment).toEqual(savedAck);
  expect(await validateStructuredPlanSnapshot(current.snapshot,{source:currentSource!,preview:currentPreview!,mapping:validateStructuredMapping(current.expectedMapping)})).not.toBeNull();
 });

 it('aborts old requests and ignores their out-of-order response after an edit',async()=>{
  const gate=new StructuredRequestGate();
  const resolvers:Array<(value:string)=>void>=[];let accepted:string|null=null;
  const old=gate.begin();const staleResponse=new Promise<string>(resolve=>resolvers.push(resolve)).then(value=>{if(old.isCurrent())accepted=value;});
  const latest=gate.begin();resolvers[0]?.('stale response');await staleResponse;
  expect(old.signal.aborted).toBe(true);expect(old.isCurrent()).toBe(false);expect(latest.isCurrent()).toBe(true);expect(accepted).toBeNull();
  gate.invalidate();expect(latest.signal.aborted).toBe(true);expect(latest.isCurrent()).toBe(false);
 });
});
