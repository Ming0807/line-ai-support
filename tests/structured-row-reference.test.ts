import {expect,it} from 'vitest';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {validateStructuredRowReference,structuredRowReferencesEqual} from '../lib/knowledge/structured-row-reference';
import {STRUCTURED_DATASETS} from '../lib/knowledge/structured-payload';
import {importFormats} from '../lib/imports/types';
import {buildStructuredMappingPlan} from '../lib/imports/structured-mapper';
import {structuredMappingFixture} from './fixtures/structured-mapping';

const payload={service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:null,phone:null,email:null,url:null};
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64);
const reference=()=>({schemaVersion:1,dataset:'university_services',registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:uuid,documentId:uuid,documentRevision:0,jobId:uuid,jobRevision:0,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload}),planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:7,sourceRow:8,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:7,rowEnd:9,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:uuid,baseDocumentId:uuid,versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-07',contextDigest:hash}});
it.each(STRUCTURED_DATASETS)('retains actual prepared all-format reference/hash compatibility for %s',dataset=>{
 for(const format of importFormats){
  const fixture=structuredMappingFixture(dataset,format),plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping),row=plan.rows[0];
  const actual={...reference(),dataset:plan.dataset,...plan.binding,sourceChecksum:plan.sourceChecksum,extractionDigest:plan.extractionDigest,mappingDigest:plan.mappingDigest,payloadDigest:row.payloadDigest,planDigest:plan.digest,tableIndex:row.tableIndex,rowIndex:row.rowIndex,tableFirstRow:fixture.extraction.tables[row.tableIndex].firstRow,sourceRow:row.sourceRow,coordinateKind:row.coordinateKind,sourceLocation:row.sourceLocation};
  expect(validateStructuredRowReference(actual,row.payload)).toEqual(actual);
 }
});
it('validates a detached frozen row reference against its exact payload digest',()=>{
 const input=reference(),parsed=validateStructuredRowReference(input,payload);expect(parsed).toEqual(input);expect(parsed).not.toBe(input);expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.ruleProof)).toBe(true);input.sourceLocation.rowStart=6;expect(parsed.sourceLocation).toMatchObject({rowStart:7});
});
it('rejects payload/hash/dataset mismatches without leaking source text',()=>{
 expect(()=>validateStructuredRowReference(reference(),{...payload,name:'private source text'})).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
 expect(()=>validateStructuredRowReference({...reference(),payloadDigest:'f'.repeat(64)},payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
 expect(()=>validateStructuredRowReference({...reference(),dataset:'tuition_fees'},payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
});
it('validates all source coordinate kinds and logical firstRow fragments',()=>{
 const variants=[
  {coordinateKind:'WORKSHEET_CELL',sourceLocation:{kind:'XLSX',sheetName:'Sheet1',sheetIndex:1,rowStart:7,rowEnd:9,columnStart:1,columnEnd:8,tableIndex:1}},
  {coordinateKind:'CSV_RECORD',sourceLocation:reference().sourceLocation},
  {coordinateKind:'EXTRACTED_LOGICAL',sourceLocation:{kind:'PDF',pageNumber:2,blockStart:7,blockEnd:12,tableIndex:1}},
  {coordinateKind:'EXTRACTED_LOGICAL',sourceLocation:{kind:'DOCX',blockStart:7,blockEnd:12,headingPath:['Header'],tableIndex:1}},
  {coordinateKind:'EXTRACTED_LOGICAL',sourceLocation:{kind:'HTML',sourceUrl:'https://www.yru.ac.th/example',blockStart:7,blockEnd:12,headingPath:[],tableIndex:1}},
 ];
 for(const variant of variants)expect(validateStructuredRowReference({...reference(),...variant},payload)).toMatchObject({sourceRow:8,tableFirstRow:7});
});
it('rejects coordinate relabeling, impossible offsets/ranges and absent table evidence',()=>{
 for(const patch of [{coordinateKind:'WORKSHEET_CELL'},{sourceRow:9},{tableFirstRow:6},{tableIndex:1},{rowIndex:10000},{tableIndex:1000},{sourceLocation:{...reference().sourceLocation,tableIndex:null}},{sourceLocation:{...reference().sourceLocation,rowEnd:7}},{sourceLocation:{...reference().sourceLocation,rowStart:8}},{sourceLocation:{...reference().sourceLocation,columnEnd:0}}])expect(()=>validateStructuredRowReference({...reference(),...patch},payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
});
it('rejects noncanonical identities, impossible counters and malformed complete rule proof',()=>{
 for(const patch of [{rowId:uuid.toUpperCase()},{documentId:'bad'},{jobRevision:-1},{reviewRevision:0},{extractionRevision:0},{documentRevision:1.5},{registryVersion:'future'},{mapperVersion:'future'},{ruleProof:{...reference().ruleProof,ruleRevision:'01'}},{ruleProof:{...reference().ruleProof,evaluationDate:'2026-02-30'}}])expect(()=>validateStructuredRowReference({...reference(),...patch},payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
});
it('rejects hidden/accessor/proxy/unknown inputs without invoking getters',()=>{
 let reads=0;const input=Object.defineProperty(reference(),'sourceChecksum',{get(){reads++;return hash;},enumerable:true});expect(()=>validateStructuredRowReference(input,payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);expect(reads).toBe(0);
 expect(()=>validateStructuredRowReference({...reference(),role:'SUPER_ADMIN'},payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
 const hidden=Object.defineProperty(reference(),'secret',{value:'hidden',enumerable:false});expect(()=>validateStructuredRowReference(hidden,payload)).toThrow(/^STRUCTURED_ROW_REFERENCE_INVALID$/);
});
it('compares every proof/provenance identity and rejects malformed references',()=>{
 const original=reference();expect(structuredRowReferencesEqual(original,structuredClone(original))).toBe(true);
 for(const key of ['sourceChecksum','extractionDigest','mappingDigest','payloadDigest','planDigest'] as const)expect(structuredRowReferencesEqual(original,{...original,[key]:'b'.repeat(64)})).toBe(false);
 expect(structuredRowReferencesEqual(original,{...original,documentRevision:1})).toBe(false);expect(structuredRowReferencesEqual(original,{...original,ruleProof:{...original.ruleProof,contextDigest:'b'.repeat(64)}})).toBe(false);
 expect(structuredRowReferencesEqual(original,{...original,sourceLocation:{...original.sourceLocation,columnStart:2}})).toBe(false);expect(structuredRowReferencesEqual(original,{...original,technicalLineId:'bad'})).toBe(false);
});
