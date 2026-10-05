import {expect,it} from 'vitest';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {createImportSource} from '../lib/imports/source';
import type {Extraction} from '../lib/imports/types';
const source=createImportSource({bytes:new TextEncoder().encode('title,date\nfixture,2569'),filename:'calendar.csv',mimeType:'text/csv',sourceUrl:'https://acdservice.yru.ac.th/a',acquiredFrom:'UPLOAD',fetchedAt:null});
const extraction=(text:string,table=false):Extraction=>({title:'ปฏิทินวิชาการ ปีการศึกษา 2569',pages:[{pageNumber:null,text,requiresReview:false,sectionTitle:null}],
 tables:table?[{pageNumber:null,sectionTitle:null,sheetName:null,firstRow:1,rows:[['กิจกรรม','วันที่'],['ลงทะเบียน','1 สิงหาคม 2569']]}]:[],flags:[]});
it('proposes candidates from explicit text without approving or inventing dates/authority',()=>{
 expect(analyzeExtraction(source,extraction('ปฏิทินวิชาการ ปีการศึกษา 2569'))).toMatchObject({familyCode:'ACADEMIC_CALENDAR',academicYear:2569,
  effectiveFrom:null,effectiveTo:null,publishedDate:null,authorityLevel:null,reviewStatus:'PENDING_REVIEW',approved:false});
});
it('preserves candidate tables and recommends BOTH only for installed fixed schemas',()=>{
 const value=extraction('คำอธิบายปฏิทินวิชาการและเงื่อนไข ปีการศึกษา 2569',true);
 expect(analyzeExtraction(source,value)).toMatchObject({datasetCandidate:'academic_calendar_events',recommendedStorageMode:'RAG'});
 expect(analyzeExtraction(source,value).flags).toContain('STRUCTURED_SCHEMA_UNAVAILABLE');
 expect(analyzeExtraction(source,value,{installedDatasets:['academic_calendar_events']})).toMatchObject({recommendedStorageMode:'BOTH',containsTables:true});
 expect(value.tables[0].rows[1][1]).toBe('1 สิงหาคม 2569');
});
it('unknown table dataset remains RAG without arbitrary SQL/table mappings',()=>{
 const value={...extraction('Shuttle bus schedule',true),title:'Shuttle bus schedule'};
 expect(analyzeExtraction(source,value,{installedDatasets:['academic_calendar_events']})).toMatchObject({datasetCandidate:null,recommendedStorageMode:'RAG'});
 expect(analyzeExtraction(source,value).flags).toContain('STRUCTURED_SCHEMA_UNAVAILABLE');
});
it.each([
 ['รายชื่อนักศึกษา รหัสนักศึกษา 12345678901','STUDENT_RECORDS'],['โทรศัพท์ 0812345678','PHONE'],
 ['ติดต่อ person@gmail.com','PERSONAL_EMAIL'],['ผลการเรียน เกรด 3.5','GRADES'],['ประวัติการรักษาโรค','MEDICAL'],['เลขบัญชีธนาคารของนักศึกษา','PERSONAL_FINANCE'],
])('flags sensitivity by safe category without publishing or copying private matches %s',(text,category)=>{
 const result=analyzeExtraction(source,extraction(text));expect(result.sensitiveRisk).toBe(true);expect(result.sensitiveCategories).toContain(category);
 expect(result.reviewStatus).toBe('PENDING_REVIEW');expect(result.approved).toBe(false);expect(JSON.stringify(result)).not.toContain(text);
});
it('preserves quality flags and ambiguous academic years rather than choosing a current version',()=>{
 const value=extraction('ปีการศึกษา 2568 และปีการศึกษา 2569');value.flags=['OCR_REQUIRED'];value.pages[0].requiresReview=true;
 const result=analyzeExtraction(source,value);expect(result.academicYear).toBeNull();expect(result.flags).toContain('ACADEMIC_YEAR_AMBIGUOUS');expect(result.flags).toContain('OCR_REQUIRED');
});
it('missing/external source requires provenance review and recognized amendments remain separate proposals',()=>{
 const absent={...source,sourceUrl:null};expect(analyzeExtraction(absent,extraction('คู่มือ')).flags).toContain('SOURCE_REVIEW_REQUIRED');
 const amended={...extraction('ประกาศแก้ไขเพิ่มเติม ฉบับที่ 2'),title:'ประกาศแก้ไขเพิ่มเติม ฉบับที่ 2'};
 expect(analyzeExtraction(source,amended).amendmentCandidate).toBe(true);expect(analyzeExtraction(source,amended)).not.toHaveProperty('isCurrent');
});
it('rejects malformed/oversized extraction and uninstalled arbitrary dataset names',()=>{
 expect(()=>analyzeExtraction(source,{...extraction('text'),pages:[{pageNumber:0,text:'x',requiresReview:false,sectionTitle:null}]})).toThrow('IMPORT_EXTRACTION_INVALID');
 expect(()=>analyzeExtraction(source,{...extraction('text'),tables:[{pageNumber:null,sectionTitle:null,sheetName:null,firstRow:0,rows:[['x']]}]})).toThrow('IMPORT_EXTRACTION_INVALID');
 expect(()=>analyzeExtraction(source,{...extraction('text'),pages:[]})).toThrow('IMPORT_EXTRACTION_INVALID');
 expect(()=>analyzeExtraction(source,extraction('x'.repeat(5_000_001)))).toThrow('IMPORT_EXTRACTION_INVALID');
 expect(()=>analyzeExtraction(source,extraction('text'),JSON.parse('{"installedDatasets":["arbitrary_table"]}'))).toThrow('IMPORT_EXTRACTION_INVALID');
});
it('does not invent PDF pagination for CSV or use a table reference outside proved pages',()=>{
 expect(()=>analyzeExtraction(source,{...extraction('text'),pages:[{pageNumber:1,text:'x',requiresReview:false,sectionTitle:null}]})).toThrow('IMPORT_EXTRACTION_INVALID');
 const pdf=createImportSource({bytes:new TextEncoder().encode('%PDF-1.7\nfixture'),filename:'rules.pdf',mimeType:'application/pdf',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 expect(()=>analyzeExtraction(pdf,extraction('text'))).toThrow('IMPORT_EXTRACTION_INVALID');
 expect(()=>analyzeExtraction(pdf,{...extraction('text',true),pages:[{pageNumber:1,text:'text',requiresReview:false,sectionTitle:null}],
  tables:[{pageNumber:2,sectionTitle:null,sheetName:null,firstRow:1,rows:[['x']]}]})).toThrow('IMPORT_EXTRACTION_INVALID');
});
it('detects original tampering before analysis and flags ragged table shapes for review',()=>{
 const altered={...source,bytes:Uint8Array.from(source.bytes)};altered.bytes[0]=0;
 expect(()=>analyzeExtraction(altered,extraction('text'))).toThrow('IMPORT_SOURCE_INVALID');
 const value=extraction('text',true);value.tables[0].rows=[['a','b'],['only one']];expect(analyzeExtraction(source,value).flags).toContain('TABLE_SHAPE_REVIEW');
});
