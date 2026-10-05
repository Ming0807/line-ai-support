import {expect,it} from 'vitest';
import {validateLocatedExtraction} from '../lib/imports/extraction';
import {parseCsvSource} from '../lib/imports/csv-parser';
import {createImportSource} from '../lib/imports/source';
const source=createImportSource({bytes:new TextEncoder().encode('กิจกรรม,วันที่\nลงทะเบียน,1 สิงหาคม 2569'),filename:'calendar.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
it('retains CSV logical record ranges and measured report through validated parser output',()=>{
 const output=validateLocatedExtraction(source,parseCsvSource(source));
 expect(output.locations.tables[0]).toMatchObject({kind:'CSV',rowStart:1,rowEnd:2,columnStart:1,columnEnd:2,tableIndex:1});
 expect(output.report).toMatchObject({schemaVersion:1,inputBytes:source.bytes.length,tables:1,cells:4,truncated:false});
});
it('fails closed on omitted/fabricated/cross-format locations and false output measurements',()=>{
 const parsed=parseCsvSource(source);
 for(const change of [{locations:{pages:[],tables:parsed.locations.tables}},
  {locations:{pages:parsed.locations.pages,tables:[{kind:'PDF',pageNumber:1,blockStart:1,blockEnd:1,tableIndex:1}]}},
  {report:{...parsed.report,cells:0}},{report:{...parsed.report,inputBytes:1}},{report:{...parsed.report,truncated:true}},
  {locations:{pages:parsed.locations.pages,tables:[{...parsed.locations.tables[0],rowEnd:0}]}}]){
  expect(()=>validateLocatedExtraction(source,{...parsed,...change})).toThrow('IMPORT_EXTRACTION_INVALID');
 }
});
it('parser quality warnings retain unresolved status and cannot assert reviewer disposition',()=>{
 const formula=createImportSource({bytes:new TextEncoder().encode('name,value\nfee,=1+2'),filename:'formula.csv',mimeType:source.mimeType,sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const parsed=validateLocatedExtraction(formula,parseCsvSource(formula));
 expect(parsed.report.warnings).toContainEqual(expect.objectContaining({code:'FORMULAS_PRESENT',disposition:'UNRESOLVED'}));
 const warnings=parsed.report.warnings.map(item=>({...item,disposition:'FALSE_POSITIVE'}));
 expect(()=>validateLocatedExtraction(formula,{...parsed,report:{...parsed.report,warnings}})).toThrow('IMPORT_EXTRACTION_INVALID');
});
it('blank table content requires a low-quality warning and review instead of clean parser success',()=>{
 const blank=createImportSource({bytes:new TextEncoder().encode(',,\n,,'),filename:'blank.csv',mimeType:source.mimeType,sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const parsed=parseCsvSource(blank);
 expect(parsed.flags).toContain('LOW_TEXT_QUALITY');expect(parsed.pages[0].requiresReview).toBe(true);
 expect(parsed.report.warnings).toContainEqual(expect.objectContaining({code:'LOW_TEXT_QUALITY',disposition:'UNRESOLVED'}));
 expect(()=>validateLocatedExtraction(blank,{...parsed,flags:[],report:{...parsed.report,warnings:[]},pages:parsed.pages.map(page=>({...page,requiresReview:false}))})).toThrow('IMPORT_EXTRACTION_INVALID');
});
