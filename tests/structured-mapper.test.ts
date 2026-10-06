import {expect,it} from 'vitest';
import {createImportSource} from '../lib/imports/source';
import {parseCsvSource} from '../lib/imports/csv-parser';
import {buildStructuredMappingPlan,computeStructuredExtractionDigest} from '../lib/imports/structured-mapper';
import {STRUCTURED_MAPPING_LIMITS,type StructuredMapping} from '../lib/imports/structured-mapping-contract';

function fixture(dataRowCount=2){
 const csv=['title,date',...Array.from({length:dataRowCount},(_,index)=>index===1?'สอบ,08/10/2569':'ลงทะเบียน,07/10/2569')].join('\n');
 const source=createImportSource({bytes:new TextEncoder().encode(csv),filename:'calendar.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const extraction=parseCsvSource(source),binding={jobId:'123e4567-e89b-42d3-a456-426614174000',jobRevision:2,extractionRevision:2,reviewRevision:1};
 const constant=(value:string|number|null)=>({kind:'CONSTANT' as const,value,note:'explicit reviewed value'});
 const mapping:StructuredMapping={version:1,registryVersion:'structured-v1',dataset:'academic_calendar_events',source:{jobId:binding.jobId,jobRevision:binding.jobRevision,extractionRevision:binding.extractionRevision,sourceChecksum:source.checksum,extractionDigest:computeStructuredExtractionDigest(source,extraction)},tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:dataRowCount}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'reviewed header'}],fields:{academic_year:constant(2569),semester:constant('1'),student_type:constant('ALL'),event_type:constant('REGISTRATION'),title:{kind:'COLUMN',columnIndex:0,transform:'TEXT_V1',blank:'REJECT'},start_date:{kind:'COLUMN',columnIndex:1,transform:'DATE_DMY_BUDDHIST_V1',blank:'REJECT'},end_date:constant(null),description:constant(null)}}],excludedTables:[]};
 return {source,extraction,binding,mapping};
}
it('maps actual small CSV source rows into exact payloads with private logical-record evidence and labelled constants',()=>{
 const f=fixture(),plan=buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping);
 expect(plan.rows.map(row=>[row.sourceRow,row.payload])).toEqual([[2,{academic_year:2569,semester:'1',student_type:'ALL',event_type:'REGISTRATION',title:'ลงทะเบียน',start_date:'2026-10-07',end_date:null,description:null}],[3,{academic_year:2569,semester:'1',student_type:'ALL',event_type:'REGISTRATION',title:'สอบ',start_date:'2026-10-08',end_date:null,description:null}]]);
 expect(plan.requiresReview).toBe(true);expect(plan.rows[0].coordinateKind).toBe('CSV_RECORD');
 expect(plan.rows[0].fields.find(field=>field.field==='start_date')).toMatchObject({kind:'CELL',columnIndex:1,sourceColumn:2,extractedValue:'07/10/2569',transform:'DATE_DMY_BUDDHIST_V1'});
 expect(plan.rows[0].fields.find(field=>field.field==='academic_year')).toMatchObject({kind:'CONSTANT',value:2569,note:'explicit reviewed value'});
 expect(Object.isFrozen(plan.rows[0].payload)).toBe(true);expect(buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping).digest).toBe(plan.digest);
});
it('rejects changed source binding and uncovered rows rather than silently dropping data',()=>{
 const f=fixture();
 expect(()=>buildStructuredMappingPlan(f.source,f.extraction,{...f.binding,jobRevision:3},f.mapping)).toThrowError(/^STRUCTURED_MAPPING_BINDING_MISMATCH$/);
 expect(()=>buildStructuredMappingPlan(f.source,f.extraction,f.binding,{...f.mapping,tables:[{...f.mapping.tables[0],dataRanges:[{startRowIndex:1,endRowIndex:1}]}]})).toThrowError(/^STRUCTURED_MAPPING_INVALID$/);
});
it('reports only safe table/row/field coordinates for an invalid private source cell',()=>{
 const f=fixture();f.extraction.tables[0].rows[1][1]='PRIVATE_BAD_DATE';
 f.extraction.report.textCharacters=f.extraction.pages.reduce((sum,p)=>sum+p.text.length,0)+f.extraction.tables.flatMap(t=>t.rows.flat()).reduce((sum,c)=>sum+c.length,0);
 f.mapping.source.extractionDigest=computeStructuredExtractionDigest(f.source,f.extraction);
 let error:unknown;try{buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping);}catch(caught){error=caught;}
 expect(error).toMatchObject({code:'STRUCTURED_MAPPING_ROW_INVALID',location:{tableIndex:0,rowIndex:1,field:'start_date'}});
 expect(String(error)).not.toContain('PRIVATE_BAD_DATE');
});
it('bounds the complete private artifact including its digest at the actual UTF-8 byte boundary',()=>{
 const f=fixture(2000),description=f.mapping.tables[0].fields.description;
 if(description.kind!=='CONSTANT')throw new Error('TEST_CONSTANT_EXPECTED');
 description.value='x';
 const baseline=Buffer.byteLength(JSON.stringify(buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping)),'utf8');
 // A reviewed constant appears once in the mapping and twice per output row.
 const coefficient=1+2*2000,targetBytes=STRUCTURED_MAPPING_LIMITS.planBytes+1;
 const addedCharacters=Math.floor((targetBytes-baseline)/coefficient);
 description.value='x'.repeat(1+addedCharacters);
 let remainder=targetBytes-baseline-addedCharacters*coefficient;
 for(let index=1;remainder>=2;index++){
  const padding=Math.min(450,Math.floor(remainder/2));
  // One extracted title contributes once to the payload and once to its evidence.
  f.extraction.tables[0].rows[index][0]+='x'.repeat(padding);remainder-=2*padding;
 }
 if(remainder)f.mapping.tables[0].excludedRanges[0].note+='x';
 f.extraction.report.textCharacters=f.extraction.pages.reduce((sum,page)=>sum+page.text.length,0)+f.extraction.tables.flatMap(table=>table.rows.flat()).reduce((sum,cell)=>sum+cell.length,0);
 f.mapping.source.extractionDigest=computeStructuredExtractionDigest(f.source,f.extraction);
 expect(()=>buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping)).toThrowError(/^STRUCTURED_MAPPING_LIMIT_EXCEEDED$/);
 f.mapping.tables[0].excludedRanges[0].note=f.mapping.tables[0].excludedRanges[0].note.slice(0,-1);
 const accepted=buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping);
 expect(Buffer.byteLength(JSON.stringify(accepted),'utf8')).toBe(STRUCTURED_MAPPING_LIMITS.planBytes);
},15000);
