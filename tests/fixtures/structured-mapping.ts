import {computeStructuredExtractionDigest} from '../../lib/imports/structured-mapper';
import {createImportSource} from '../../lib/imports/source';
import {getStructuredRegistryEntry} from '../../lib/knowledge/structured-registry';
import type {DatasetType,ImportFormat,ImportSource,LocatedExtraction,SourceLocation} from '../../lib/imports/types';

export interface StructuredMappingFixture {
 source:ImportSource;
 extraction:LocatedExtraction;
 binding:{jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number};
 mapping:Record<string,unknown>;
 expectedPayload:Record<string,string|number|null>;
}

const id='123e4567-e89b-42d3-a456-426614174000';
const defaultTransform=(kind:'TEXT'|'INTEGER'|'DATE'|'TIMESTAMP'|'DECIMAL'|'CURRENCY'|'EMAIL'|'URL')=>kind==='INTEGER'?'INTEGER_V1':kind==='DECIMAL'?'DECIMAL_V1':kind.startsWith('DATE')?'DATE_GREGORIAN_V1':kind==='TIMESTAMP'?'TIMESTAMP_UTC_V1':'TEXT_V1';

function fixtureRows(dataset:DatasetType):{header:string[];values:Record<string,string|number|null>;transforms:Record<string,string>;constantFields:Record<string,{value:string|number|null;note:string}>}{
 switch(dataset){
  case 'academic_calendar_events':return {header:['year','semester','student_type','event_type','title','start','end','description'],values:{academic_year:'2569',semester:'1',student_type:'ภาคปกติ',event_type:'REGISTRATION',title:'ลงทะเบียน',start_date:'07/10/2569',end_date:'',description:'กำหนดการมหาวิทยาลัย'},transforms:{academic_year:'INTEGER_V1',semester:'TEXT_V1',student_type:'TEXT_V1',event_type:'TEXT_V1',title:'TEXT_V1',start_date:'DATE_DMY_BUDDHIST_V1',end_date:'TEXT_V1',description:'TEXT_V1'},constantFields:{end_date:{value:null,note:'No end date is stated in this synthetic row.'}}};
  case 'tuition_fees':return {header:['year','program','major','group','study','fee','currency','from','to'],values:{academic_year:'2569',program_name:'วิทยาการคอมพิวเตอร์',major_name:'',student_group:'NEW',study_type:'ภาคปกติ',fee_amount:'1,234.50',currency:'THB',effective_from:'07/10/2569',effective_to:''},transforms:{academic_year:'INTEGER_V1',program_name:'TEXT_V1',major_name:'TEXT_V1',student_group:'TEXT_V1',study_type:'TEXT_V1',fee_amount:'DECIMAL_COMMA_V1',currency:'TEXT_V1',effective_from:'DATE_DMY_BUDDHIST_V1',effective_to:'TEXT_V1'},constantFields:{major_name:{value:null,note:'No major restriction in this synthetic row.'},effective_to:{value:null,note:'The synthetic source gives no end date.'}}};
  case 'transfer_courses':return {header:['source program','source code','source name','source credits','target program','target code','target name','target credits','conditions'],values:{source_program:'หลักสูตรเดิม',source_course_code:'CS101',source_course_name:'การเขียนโปรแกรม',source_credits:'3.000',target_program:'หลักสูตรใหม่',target_course_code:'CSC101',target_course_name:'การเขียนโปรแกรมพื้นฐาน',target_credits:'3',conditions:''},transforms:{source_program:'TEXT_V1',source_course_code:'TEXT_V1',source_course_name:'TEXT_V1',source_credits:'DECIMAL_V1',target_program:'TEXT_V1',target_course_code:'TEXT_V1',target_course_name:'TEXT_V1',target_credits:'DECIMAL_V1',conditions:'TEXT_V1'},constantFields:{conditions:{value:null,note:'No additional transfer condition in this synthetic row.'}}};
  case 'university_services':return {header:['code','name','description','location','hours','phone','email','url'],values:{service_code:'LIB-01',name:'ห้องสมุดกลาง',description:'บริการยืมหนังสือ',location:'อาคาร 1',opening_hours:'จันทร์–ศุกร์',phone:'073000000',email:'library@example.org',url:'https://example.org/library'},transforms:{service_code:'TEXT_V1',name:'TEXT_V1',description:'TEXT_V1',location:'TEXT_V1',opening_hours:'TEXT_V1',phone:'TEXT_V1',email:'TEXT_V1',url:'TEXT_V1'},constantFields:{}};
  case 'university_systems':return {header:['code','name','description','url','support url'],values:{code:'REG-01',name:'ระบบลงทะเบียน',description:'ระบบสำหรับนักศึกษา',url:'https://example.org/register',support_url:'https://example.org/help'},transforms:{code:'TEXT_V1',name:'TEXT_V1',description:'TEXT_V1',url:'TEXT_V1',support_url:'TEXT_V1'},constantFields:{}};
  case 'service_forms':return {header:['name','description','url','requirements'],values:{name:'คำร้องทั่วไป',description:'แบบฟอร์มสำหรับนักศึกษา',form_url:'https://example.org/form',requirements:'บัตรนักศึกษา'},transforms:{name:'TEXT_V1',description:'TEXT_V1',form_url:'TEXT_V1',requirements:'TEXT_V1'},constantFields:{}};
  case 'announcements':return {header:['title','summary','publish at','effective from','effective to','priority'],values:{title:'ปิดระบบชั่วคราว',summary:'ระบบจะหยุดให้บริการตามกำหนด',publish_at:'2026-10-07 08:00:00.000',effective_from:'2026-10-07 08:00:00.000',effective_to:'',priority:'2'},transforms:{title:'TEXT_V1',summary:'TEXT_V1',publish_at:'TIMESTAMP_PLUS07_V1',effective_from:'TIMESTAMP_PLUS07_V1',effective_to:'TEXT_V1',priority:'INTEGER_V1'},constantFields:{effective_to:{value:null,note:'This synthetic announcement has no ending timestamp.'}}};
 }
}

function sourceBytes(format:ImportFormat,rows:string[][]):Uint8Array{
 const quoteCsv=(value:string)=>/[",\r\n]/u.test(value)?`"${value.replaceAll('"','""')}"`:value;
 const text=format==='CSV'?rows.map(row=>row.map(quoteCsv).join(',')).join('\r\n'):format==='HTML'?'<html><body><table><tr><td>synthetic</td></tr></table></body></html>':format==='PDF'?'%PDF-1.7\nSynthetic fixture only':format==='DOCX'?'PK\u0003\u0004synthetic docx signature':'PK\u0003\u0004synthetic xlsx signature';
 return new TextEncoder().encode(text);
}

function pageLocation(format:ImportFormat,sourceUrl:string|null):SourceLocation{
 switch(format){
  case 'PDF':return {kind:'PDF',pageNumber:4,blockStart:20,blockEnd:23,tableIndex:null};
  case 'DOCX':return {kind:'DOCX',blockStart:31,blockEnd:34,headingPath:['Synthetic section'],tableIndex:null};
  case 'XLSX':return {kind:'XLSX',sheetName:'Synthetic',sheetIndex:2,rowStart:9,rowEnd:9,columnStart:4,columnEnd:4,tableIndex:null};
  case 'CSV':return {kind:'CSV',rowStart:4,rowEnd:4,columnStart:3,columnEnd:3,tableIndex:null};
  case 'HTML':return {kind:'HTML',sourceUrl,blockStart:41,blockEnd:44,headingPath:['Synthetic section'],tableIndex:null};
 }
}

function tableLocation(format:ImportFormat,sourceUrl:string|null,width:number):SourceLocation{
 switch(format){
  case 'PDF':return {kind:'PDF',pageNumber:4,blockStart:22,blockEnd:23,tableIndex:1};
  case 'DOCX':return {kind:'DOCX',blockStart:33,blockEnd:34,headingPath:['Synthetic section','Synthetic table'],tableIndex:1};
  case 'XLSX':return {kind:'XLSX',sheetName:'Synthetic',sheetIndex:2,rowStart:9,rowEnd:10,columnStart:4,columnEnd:3+width,tableIndex:1};
  case 'CSV':return {kind:'CSV',rowStart:4,rowEnd:5,columnStart:3,columnEnd:2+width,tableIndex:1};
  case 'HTML':return {kind:'HTML',sourceUrl,blockStart:42,blockEnd:44,headingPath:['Synthetic section','Synthetic table'],tableIndex:1};
 }
}

export function structuredMappingFixture(dataset:DatasetType,format:ImportFormat):StructuredMappingFixture{
 const values=fixtureRows(dataset),sourceUrl=format==='HTML'?'https://example.org/synthetic-table':null;
 const entry=getStructuredRegistryEntry(dataset);
 if(format==='CSV'&&dataset==='university_services')values.values.description='first line\r\nsecond line';
 const rows=[entry.fields.map(field=>values.header[entry.fields.findIndex(candidate=>candidate.name===field.name)]??field.name),entry.fields.map(field=>String(values.values[field.name]??''))];
 const source=createImportSource({bytes:sourceBytes(format,rows),filename:`synthetic.${format.toLowerCase()}`,mimeType:'',sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null});
 const expectedPayload:Record<string,string|number|null>={};
 const tableValues=entry.fields.map(field=>{
  if(Object.hasOwn(values.constantFields,field.name)){
   expectedPayload[field.name]=values.constantFields[field.name]!.value;
   return '';
  }
  const value=values.values[field.name];if(value===undefined)throw new Error(`SYNTHETIC_FIXTURE_FIELD_MISSING:${dataset}:${field.name}`);
  if(field.kind==='INTEGER')expectedPayload[field.name]=Number(value);
  else if(field.kind==='DATE'&&values.transforms[field.name]==='DATE_DMY_BUDDHIST_V1')expectedPayload[field.name]=`2026-${String(value).slice(3,5)}-${String(value).slice(0,2)}`;
  else if(field.kind==='DECIMAL'&&values.transforms[field.name]==='DECIMAL_COMMA_V1')expectedPayload[field.name]=String(value).replaceAll(',','');
  else if(field.kind==='TIMESTAMP'&&values.transforms[field.name]==='TIMESTAMP_PLUS07_V1')expectedPayload[field.name]='2026-10-07T01:00:00.000Z';
  else expectedPayload[field.name]=value;
  return String(value);
 });
 if(rows[0]!.length!==tableValues.length)throw new Error('SYNTHETIC_FIXTURE_HEADER_WIDTH');
 const firstRow=format==='XLSX'?9:format==='CSV'?4:format==='PDF'?7:format==='DOCX'?13:21;
 rows[1]=tableValues;
 const pages=[{pageNumber:format==='PDF'?4:null,text:'Synthetic mapping fixture; parser execution is not represented.',requiresReview:true,sectionTitle:'Synthetic fixture'}];
 const extraction:LocatedExtraction={title:'Synthetic mapping fixture',pages,tables:[{pageNumber:format==='PDF'?4:null,sectionTitle:'Synthetic table',sheetName:format==='XLSX'?'Synthetic':null,firstRow,rows}],flags:[],locations:{pages:[pageLocation(format,sourceUrl)],tables:[tableLocation(format,sourceUrl,entry.fields.length)]},report:{schemaVersion:1,parser:{name:'synthetic-mapping-fixture',version:'1'},inputBytes:source.bytes.length,pages:1,tables:1,cells:rows.reduce((sum,row)=>sum+row.length,0),textCharacters:pages.reduce((sum,page)=>sum+page.text.length,0)+rows.flat().reduce((sum,cell)=>sum+cell.length,0),replacementCharacters:0,truncated:false,warnings:[]}};
 const binding={jobId:id,jobRevision:3,extractionRevision:7,reviewRevision:11};
 const extractionDigest=computeStructuredExtractionDigest(source,extraction);
 const fields:Record<string,unknown>={};
 for(const field of entry.fields){
  const constant=values.constantFields[field.name];
  if(constant)fields[field.name]={kind:'CONSTANT',value:constant.value,note:constant.note};
  else fields[field.name]={kind:'COLUMN',columnIndex:entry.fields.findIndex(candidate=>candidate.name===field.name),transform:values.transforms[field.name]??defaultTransform(field.kind),blank:field.nullable?'NULL':'REJECT'};
 }
 const mapping={version:1,registryVersion:'structured-v1',dataset,source:{jobId:id,jobRevision:binding.jobRevision,extractionRevision:binding.extractionRevision,sourceChecksum:source.checksum,extractionDigest},tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:1}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'Synthetic header row; explicitly excluded.'}],fields}],excludedTables:[]};
 return {source,extraction,binding,mapping,expectedPayload};
}
