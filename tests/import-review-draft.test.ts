import {expect,it} from 'vitest';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {validateLocatedExtraction} from '../lib/imports/extraction';
import {parseCsvSource} from '../lib/imports/csv-parser';
import {createImportSource} from '../lib/imports/source';
import {applyExtractionEdit} from '../lib/imports/review-draft';
import {IMPORT_LIMITS,type ImportSource} from '../lib/imports/types';

const source:ImportSource=createImportSource({bytes:new TextEncoder().encode('title,value\nrow,old'),filename:'draft.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
const current=validateLocatedExtraction(source,parseCsvSource(source));

it('applies bounded text edits with reason evidence, preserved provenance, shape, and recomputed measurements',()=>{
 const result=applyExtractionEdit(source,current,{reason:'  Corrected extraction typo  ',pages:[{index:0,text:'ช่วยเหลือ โทร 0812345678'}],cells:[{table:0,row:1,column:1,text:'ใหม่'}],title:'แก้ไขชื่อ'});
 expect(result.edit).toEqual({reason:'Corrected extraction typo',changedPages:[0],changedCells:[{table:0,row:1,column:1}],titleChanged:true});
 expect(result.extraction.pages[0].text).toBe('ช่วยเหลือ โทร 0812345678');
 expect(result.extraction.tables[0].rows[1][1]).toBe('ใหม่');
 expect(result.extraction.tables[0].rows).toHaveLength(current.tables[0].rows.length);
 expect(result.extraction.tables[0].rows.map(row=>row.length)).toEqual(current.tables[0].rows.map(row=>row.length));
 expect(result.extraction.title).toBe('แก้ไขชื่อ');
 expect(result.extraction.locations).toEqual(current.locations);
 expect(result.extraction.pages[0].requiresReview).toBe(true);
 expect(result.extraction.flags).toEqual(expect.arrayContaining([...current.flags,'PAGE_REVIEW_REQUIRED']));
 expect(result.extraction.report.warnings).toContainEqual(expect.objectContaining({code:'PAGE_REVIEW_REQUIRED',severity:'REVIEW',disposition:'UNRESOLVED'}));
 const strings=[...result.extraction.pages.map(page=>page.text),...result.extraction.tables.flatMap(table=>table.rows.flat())];
 expect(result.extraction.report.textCharacters).toBe(strings.reduce((sum,value)=>sum+value.length,0));
 expect(result.extraction.report.cells).toBe(strings.length- result.extraction.pages.length);
 expect(result.extraction.report.replacementCharacters).toBe(0);
 expect(result.extraction.report.inputBytes).toBe(source.bytes.length);
 expect(result.extraction.report.parser).toEqual(current.report.parser);
 expect(result.extraction.report.warnings).toEqual(expect.arrayContaining(current.report.warnings));
});

it('deep-copies current extraction and leaves the parser output unchanged',()=>{
 const snapshot=structuredClone(current);
 const result=applyExtractionEdit(source,current,{reason:'Correct the title',title:'Edited'});
 expect(current).toEqual(snapshot);
 expect(result.extraction).not.toBe(current);
 expect(result.extraction.pages).not.toBe(current.pages);
 expect(result.extraction.locations.pages).not.toBe(current.locations.pages);
});

it('rejects malformed, unknown, bypass, duplicate, out-of-range, and no-op edits with one safe error',()=>{
 const invalidInputs:unknown[]=[
  null,{}, {reason:''}, {reason:'x'.repeat(501),title:'x'},
  {reason:'valid',flags:[]}, {reason:'valid',locations:{}}, {reason:'valid',disposition:'CORRECTED'},
  {reason:'valid',pages:[{index:0,text:'new',requiresReview:false}]},
  {reason:'valid',pages:[{index:0,text:'new',location:{kind:'PDF'}}]},
  {reason:'valid',pages:[{index:0,text:'new'},{index:0,text:'again'}]},
  {reason:'valid',pages:[{index:current.pages.length,text:'new'}]},
  {reason:'valid',pages:[{index:0,text:current.pages[0].text}]},
  {reason:'valid',cells:[{table:0,row:1,column:1,text:'new'},{table:0,row:1,column:1,text:'again'}]},
  {reason:'valid',cells:[{table:current.tables.length,row:0,column:0,text:'new'}]},
  {reason:'valid',cells:[{table:0,row:current.tables[0].rows.length,column:0,text:'new'}]},
  {reason:'valid',cells:[{table:0,row:1,column:99,text:'new'}]},
  {reason:'valid',cells:[{table:0,row:1,column:1,text:current.tables[0].rows[1][1]}]},
  {reason:'valid',title:current.title},
  {reason:'valid',cells:[{table:0,row:1,column:1,text:'x'.repeat(IMPORT_LIMITS.cellCharacters+1)}]},
  {reason:'valid',pages:[{index:0,text:'x'.repeat(IMPORT_LIMITS.characters+1)}]},
 ];
 for(const input of invalidInputs){
  expect(()=>applyExtractionEdit(source,current,input),JSON.stringify(input)?.slice(0,100)).toThrow('IMPORT_EDIT_INVALID');
 }
});

it('rejects edits whose combined extracted text exceeds the source limit',()=>{
 const input={reason:'Large replacements',pages:current.pages.map((page,index)=>({index,text:'x'.repeat(IMPORT_LIMITS.characters)}))};
 expect(()=>applyExtractionEdit(source,current,input)).toThrow('IMPORT_EDIT_INVALID');
});

it('keeps sensitive edited text for the caller to reanalyze and never resolves parser warnings',()=>{
 const formula=createImportSource({bytes:new TextEncoder().encode('name,value\nfee,=1+2'),filename:'formula.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const parsed=validateLocatedExtraction(formula,parseCsvSource(formula));
 const result=applyExtractionEdit(formula,parsed,{reason:'Restore the extracted phone number',pages:[{index:0,text:'Contact: 0812345678'}]});
 expect(result.extraction.pages[0].text).toContain('0812345678');
 expect(analyzeExtraction(formula,result.extraction).sensitiveCategories).toContain('PHONE');
 expect(result.extraction.report.warnings.find(warning=>warning.code==='FORMULAS_PRESENT')?.disposition).toBe('UNRESOLVED');
 expect(result.extraction.report.warnings.find(warning=>warning.code==='PAGE_REVIEW_REQUIRED')?.disposition).toBe('UNRESOLVED');
});

it('maps invalid source or current evidence to the same fixed error',()=>{
 expect(()=>applyExtractionEdit({...source,checksum:'bad'},current,{reason:'Fix title',title:'new'})).toThrow('IMPORT_EDIT_INVALID');
 expect(()=>applyExtractionEdit(source,{...current,locations:{...current.locations,pages:[]}}, {reason:'Fix title',title:'new'})).toThrow('IMPORT_EDIT_INVALID');
});
