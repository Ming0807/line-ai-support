import {expect,it} from 'vitest';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {parseCsvSource} from '../lib/imports/csv-parser';
import {createImportSource} from '../lib/imports/source';
import type {ImportPreview} from '../lib/imports/import-extraction';

async function warningApi(){
 const api=await import('../lib/imports/review-warnings').catch(()=>null);
 expect(api).not.toBeNull();
 return api;
}

const source=createImportSource({bytes:new TextEncoder().encode('heading,value\nFee,100'),filename:'private-fixture.csv',mimeType:'text/csv',
 sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
const baseExtraction=parseCsvSource(source);

function makePreview(changes:Partial<ImportPreview>={}):ImportPreview {
 const extraction=structuredClone(baseExtraction);
 extraction.report.warnings=[
  {code:'FORMULAS_PRESENT',severity:'REVIEW',location:extraction.locations.tables[0],count:2,disposition:'UNRESOLVED'},
  {code:'LOW_TEXT_QUALITY',severity:'BLOCKING',location:null,count:1,disposition:'UNRESOLVED'},
 ];
 const analysis={...analyzeExtraction(source,extraction),flags:[
  'FORMULAS_PRESENT','SOURCE_REVIEW_REQUIRED','ACADEMIC_YEAR_AMBIGUOUS','FAMILY_AMBIGUOUS',
  'SENSITIVE_DATA_REVIEW_REQUIRED','STRUCTURED_SCHEMA_UNAVAILABLE','OTHER_REVIEW','SOURCE_REVIEW_REQUIRED',
 ]};
 return {
  job:{id:'9e8be7b2-2d2d-4f1e-8e5f-6330ac9d7780',status:'READY',revision:4,filename:'private-fixture.csv',format:'CSV',
   mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null,acquisition:null,byteLength:source.bytes.length,
   createdAt:'2026-10-06T00:00:00.000Z',errorCode:null},
  extractionRevision:3,kind:'PARSED',extraction,analysis,edit:null,...changes,
 };
}

it('preserves parser warning order and evidence, then appends unique analysis flags with source-aware severity',async()=>{
 const api=await warningApi();if(!api)return;
 const preview=makePreview();
 const warnings=api.buildReviewWarnings(preview);
 expect(warnings.slice(0,2)).toEqual([
  {key:expect.stringMatching(/^[a-f0-9]{64}$/),source:'PARSER',code:'FORMULAS_PRESENT',severity:'REVIEW',
   location:preview.extraction.report.warnings[0].location,count:2},
  {key:expect.stringMatching(/^[a-f0-9]{64}$/),source:'PARSER',code:'LOW_TEXT_QUALITY',severity:'BLOCKING',location:null,count:1},
 ]);
 expect(warnings.slice(2).map(({source,code,severity,location,count})=>({source,code,severity,location,count}))).toEqual([
  {source:'ANALYSIS',code:'SOURCE_REVIEW_REQUIRED',severity:'BLOCKING',location:null,count:1},
  {source:'ANALYSIS',code:'ACADEMIC_YEAR_AMBIGUOUS',severity:'BLOCKING',location:null,count:1},
  {source:'ANALYSIS',code:'FAMILY_AMBIGUOUS',severity:'BLOCKING',location:null,count:1},
  {source:'ANALYSIS',code:'SENSITIVE_DATA_REVIEW_REQUIRED',severity:'BLOCKING',location:null,count:1},
  {source:'ANALYSIS',code:'STRUCTURED_SCHEMA_UNAVAILABLE',severity:'REVIEW',location:null,count:1},
  {source:'ANALYSIS',code:'OTHER_REVIEW',severity:'REVIEW',location:null,count:1},
 ]);
 expect(warnings.map(warning=>warning.code)).toEqual([
  'FORMULAS_PRESENT','LOW_TEXT_QUALITY','SOURCE_REVIEW_REQUIRED','ACADEMIC_YEAR_AMBIGUOUS',
  'FAMILY_AMBIGUOUS','SENSITIVE_DATA_REVIEW_REQUIRED','STRUCTURED_SCHEMA_UNAVAILABLE','OTHER_REVIEW',
 ]);
 expect(warnings[0].location).toEqual(preview.extraction.locations.tables[0]);
});

it('creates stable opaque warning references without mutating preview or exposing original bytes/checksum/text',async()=>{
 const api=await warningApi();if(!api)return;
 const preview=makePreview();
 const before=structuredClone(preview);
 const first=api.buildReviewWarnings(preview);
 const second=api.buildReviewWarnings(preview);
 expect(first).toEqual(second);
 expect(first.every(warning=>/^[a-f0-9]{64}$/.test(warning.key))).toBe(true);
 const serialized=JSON.stringify(first);
 expect(serialized).not.toContain(source.checksum);
 expect(serialized).not.toContain('heading,value');
 expect(preview).toEqual(before);
});

it('binds references to job and exact extraction revision',async()=>{
 const api=await warningApi();if(!api)return;
 const preview=makePreview();
 const original=api.buildReviewWarnings(preview);
 const changedJob=api.buildReviewWarnings({...preview,job:{...preview.job,id:'e4e6964e-39f1-431f-88b8-a87f643d55fc'}});
 const changedExtraction=api.buildReviewWarnings({...preview,extractionRevision:preview.extractionRevision+1});
 expect(changedJob.map(warning=>warning.key)).not.toEqual(original.map(warning=>warning.key));
 expect(changedExtraction.map(warning=>warning.key)).not.toEqual(original.map(warning=>warning.key));
});

it('binds each reference to its source-array index',async()=>{
 const api=await warningApi();if(!api)return;
 const preview=makePreview();
 const original=api.buildReviewWarnings(preview);
 const reversed=structuredClone(preview);
 reversed.extraction.report.warnings.reverse();
 const reversedWarnings=api.buildReviewWarnings(reversed);
 expect(reversedWarnings[1].code).toBe(original[0].code);
 expect(reversedWarnings[1].key).not.toBe(original[0].key);
 const shiftedAnalysis=structuredClone(preview);
 shiftedAnalysis.analysis.flags.unshift('FORMULAS_PRESENT');
 const oldSource=original.find(warning=>warning.code==='SOURCE_REVIEW_REQUIRED');
 const newSource=api.buildReviewWarnings(shiftedAnalysis).find(warning=>warning.code==='SOURCE_REVIEW_REQUIRED');
 expect(newSource?.key).not.toBe(oldSource?.key);
});

it('invalidates parser warning keys when its code, location, severity, count, or disposition changes',async()=>{
 const api=await warningApi();if(!api)return;
 const preview=makePreview();
 const first=api.buildReviewWarnings(preview)[0];
 const mutations:Array<(warning:ImportPreview['extraction']['report']['warnings'][number])=>void>=[
  warning=>{warning.code='TABLE_SHAPE_REVIEW';},
  warning=>{warning.location={kind:'CSV',rowStart:1,rowEnd:1,columnStart:1,columnEnd:2,tableIndex:1};},
  warning=>{warning.severity='BLOCKING';},
  warning=>{warning.count++;},
  warning=>{warning.disposition='CORRECTED';},
 ];
 for(const mutate of mutations){
  const changed=makePreview();mutate(changed.extraction.report.warnings[0]);
  expect(api.buildReviewWarnings(changed)[0].key).not.toBe(first.key);
 }
});

it('allows omitted dispositions but rejects duplicate or unknown warning keys with one fixed error',async()=>{
 const api=await warningApi();if(!api)return;
 const warnings=api.buildReviewWarnings(makePreview());
 expect(()=>api.assertReviewWarningBindings(warnings,[])).not.toThrow();
 expect(()=>api.assertReviewWarningBindings(warnings,[{warningKey:warnings[0].key}])).not.toThrow();
 expect(()=>api.assertReviewWarningBindings(warnings,[{warningKey:'f'.repeat(64)}])).toThrow('IMPORT_REVIEW_WARNING_INVALID');
 expect(()=>api.assertReviewWarningBindings(warnings,[{warningKey:warnings[0].key},{warningKey:warnings[0].key}]))
  .toThrow('IMPORT_REVIEW_WARNING_INVALID');
 const duplicateEntries=[warnings[0],warnings[0]];
 expect(()=>api.assertReviewWarningBindings(duplicateEntries,[])).toThrow('IMPORT_REVIEW_WARNING_INVALID');
});
