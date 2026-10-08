import {z} from 'zod';

export const STRUCTURED_DATASETS=['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'] as const;
export type StructuredDataset=(typeof STRUCTURED_DATASETS)[number];
export const STRUCTURED_TRANSFORMS=['TEXT_V1','INTEGER_V1','DECIMAL_V1','DECIMAL_COMMA_V1','DATE_GREGORIAN_V1','DATE_BUDDHIST_V1','DATE_DMY_GREGORIAN_V1','DATE_DMY_BUDDHIST_V1','TIMESTAMP_UTC_V1','TIMESTAMP_PLUS07_V1','DATE_GREGORIAN_PLUS07_MIDNIGHT_V1','DATE_BUDDHIST_PLUS07_MIDNIGHT_V1'] as const;
export type StructuredTransform=(typeof STRUCTURED_TRANSFORMS)[number];
export type StructuredFieldKind='TEXT'|'INTEGER'|'DATE'|'TIMESTAMP'|'DECIMAL'|'CURRENCY'|'EMAIL'|'URL';
export type StructuredRange={startRowIndex:number;endRowIndex:number};
export type StructuredExcludedRange=StructuredRange&{reason:'HEADER'|'NON_DATA';note:string};
export type StructuredColumnBinding={kind:'COLUMN';columnIndex:number;transform:StructuredTransform;blank:'REJECT'|'NULL'};
export type StructuredConstantBinding={kind:'CONSTANT';value:string|number|null;note:string};
export type StructuredFieldBinding=StructuredColumnBinding|StructuredConstantBinding;
export type StructuredMapping={version:1;registryVersion:'structured-v1';dataset:StructuredDataset;
 source:{jobId:string;jobRevision:number;extractionRevision:number;sourceChecksum:string;extractionDigest:string};
 tables:Array<{tableIndex:number;dataRanges:StructuredRange[];excludedRanges:StructuredExcludedRange[];fields:Record<string,StructuredFieldBinding>}>;
 excludedTables:Array<{tableIndex:number;reason:'NOT_THIS_DATASET'|'NON_DATA';note:string}>};
export type StructuredMappingAcknowledgment={contentDigest:string;mapperVersion:'structured-mapper-v1'};
export type StructuredMappingChange={mapping:StructuredMapping|null;acknowledgment:StructuredMappingAcknowledgment|null};

export interface StructuredFieldDefinition {
 name:string;label:string;kind:StructuredFieldKind;nullable:boolean;maxLength?:number;precision?:number;scale?:number;min?:number;max?:number;
}
const field=(name:string,label:string,kind:StructuredFieldKind,nullable=false,bounds:Omit<StructuredFieldDefinition,'name'|'label'|'kind'|'nullable'>={}):StructuredFieldDefinition=>({name,label,kind,nullable,...bounds});
export const STRUCTURED_FIELD_REGISTRY:Record<StructuredDataset,StructuredFieldDefinition[]>={
 academic_calendar_events:[field('academic_year','ปีการศึกษา','INTEGER',false,{min:2400,max:3000}),field('semester','ภาคเรียน','TEXT',false,{maxLength:80}),field('student_type','ประเภทนักศึกษา','TEXT',false,{maxLength:80}),field('event_type','ประเภทกิจกรรม','TEXT',false,{maxLength:200}),field('title','ชื่องานหรือกิจกรรม','TEXT',false,{maxLength:500}),field('start_date','วันที่เริ่มต้น','DATE'),field('end_date','วันที่สิ้นสุด','DATE',true),field('description','รายละเอียด','TEXT',true,{maxLength:5000})],
 tuition_fees:[field('academic_year','ปีการศึกษา','INTEGER',false,{min:2400,max:3000}),field('program_name','ชื่อหลักสูตร','TEXT',false,{maxLength:500}),field('major_name','ชื่อสาขาวิชา','TEXT',true,{maxLength:500}),field('student_group','กลุ่มนักศึกษา','TEXT',false,{maxLength:200}),field('study_type','รูปแบบการศึกษา','TEXT',false,{maxLength:200}),field('fee_amount','ค่าธรรมเนียม','DECIMAL',false,{precision:12,scale:2}),field('currency','สกุลเงิน','CURRENCY',false,{maxLength:3}),field('effective_from','วันที่เริ่มมีผล','DATE'),field('effective_to','วันที่สิ้นสุดผล','DATE',true)],
 transfer_courses:[field('source_program','หลักสูตรต้นทาง','TEXT',false,{maxLength:500}),field('source_course_code','รหัสวิชาต้นทาง','TEXT',false,{maxLength:200}),field('source_course_name','ชื่อวิชาต้นทาง','TEXT',false,{maxLength:500}),field('source_credits','หน่วยกิตต้นทาง','DECIMAL',false,{precision:6,scale:3}),field('target_program','หลักสูตรปลายทาง','TEXT',false,{maxLength:500}),field('target_course_code','รหัสวิชาปลายทาง','TEXT',false,{maxLength:200}),field('target_course_name','ชื่อวิชาปลายทาง','TEXT',false,{maxLength:500}),field('target_credits','หน่วยกิตปลายทาง','DECIMAL',false,{precision:6,scale:3}),field('conditions','เงื่อนไข','TEXT',true,{maxLength:5000})],
 university_services:[field('service_code','รหัสบริการ','TEXT',false,{maxLength:200}),field('name','ชื่อบริการ','TEXT',false,{maxLength:500}),field('description','รายละเอียด','TEXT',true,{maxLength:5000}),field('location','สถานที่','TEXT',true,{maxLength:500}),field('opening_hours','เวลาทำการ','TEXT',true,{maxLength:2000}),field('phone','เบอร์โทรศัพท์','TEXT',true,{maxLength:100}),field('email','อีเมล','EMAIL',true,{maxLength:254}),field('url','ลิงก์บริการ','URL',true,{maxLength:2000})],
 university_systems:[field('code','รหัสระบบ','TEXT',false,{maxLength:200}),field('name','ชื่อระบบ','TEXT',false,{maxLength:500}),field('description','รายละเอียด','TEXT',true,{maxLength:5000}),field('url','ลิงก์ระบบ','URL',false,{maxLength:2000}),field('support_url','ลิงก์ช่วยเหลือ','URL',true,{maxLength:2000})],
 service_forms:[field('name','ชื่อแบบฟอร์ม','TEXT',false,{maxLength:500}),field('description','รายละเอียด','TEXT',true,{maxLength:5000}),field('form_url','ลิงก์แบบฟอร์ม','URL',false,{maxLength:2000}),field('requirements','เอกสารที่ต้องใช้','TEXT',true,{maxLength:5000})],
 announcements:[field('title','หัวข้อประกาศ','TEXT',false,{maxLength:500}),field('summary','สรุปประกาศ','TEXT',true,{maxLength:5000}),field('publish_at','วันเวลาที่ประกาศ','TIMESTAMP'),field('effective_from','วันเวลาเริ่มมีผล','TIMESTAMP'),field('effective_to','วันเวลาสิ้นสุดผล','TIMESTAMP',true),field('priority','ลำดับความสำคัญ','INTEGER',false,{min:0,max:100})],
};

const importFormats=['PDF','DOCX','XLSX','CSV','HTML'] as const;
const extractionFlags=['OCR_REQUIRED','LOW_TEXT_QUALITY','UNSUPPORTED_TABLES','ENCRYPTED_SOURCE','FORMULAS_PRESENT','HIDDEN_DATA_REVIEW','EXTERNAL_LINKS_REVIEW','PAGE_REVIEW_REQUIRED','TABLE_SHAPE_REVIEW'] as const;
const index=(max:number)=>z.number().int().min(0).max(max);
const revision=index(999_999_999);
const hash=z.string().regex(/^[a-f0-9]{64}$/u);
const uuid=z.uuid();
const wellFormed=(value:string)=>{
 for(let i=0;i<value.length;i++){
  const code=value.charCodeAt(i);
  if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff))return false;i++;}
  else if(code>=0xdc00&&code<=0xdfff)return false;
 }
 return true;
};
const humanNote=z.string().min(1).max(500).refine(value=>wellFormed(value)&&value.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(value));
const rangeSchema=z.object({startRowIndex:index(9999),endRowIndex:index(9999)}).strict().refine(value=>value.endRowIndex>=value.startRowIndex);
const columnBindingSchema=z.object({kind:z.literal('COLUMN'),columnIndex:index(255),transform:z.enum(STRUCTURED_TRANSFORMS),blank:z.enum(['REJECT','NULL'])}).strict();
const constantBindingSchema=z.object({kind:z.literal('CONSTANT'),value:z.union([z.string().max(5000),z.number().finite(),z.null()]),note:humanNote}).strict();
const fieldBindingSchema=z.discriminatedUnion('kind',[columnBindingSchema,constantBindingSchema]);
const mappingSchema=z.object({version:z.literal(1),registryVersion:z.literal('structured-v1'),dataset:z.enum(STRUCTURED_DATASETS),
 source:z.object({jobId:uuid,jobRevision:revision,extractionRevision:revision.min(1),sourceChecksum:hash,extractionDigest:hash}).strict(),
 tables:z.array(z.object({tableIndex:index(999),dataRanges:z.array(rangeSchema).min(1).max(100),
  excludedRanges:z.array(z.object({startRowIndex:index(9999),endRowIndex:index(9999),reason:z.enum(['HEADER','NON_DATA']),note:humanNote}).strict()).max(100),
  fields:z.record(z.string().min(1).max(80),fieldBindingSchema)}).strict()).min(1).max(64),
 excludedTables:z.array(z.object({tableIndex:index(999),reason:z.enum(['NOT_THIS_DATASET','NON_DATA']),note:humanNote}).strict()).max(1000),
}).strict();

const locationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('PDF'),pageNumber:z.number().int().min(1).max(1000),blockStart:z.number().int().min(1).max(100000),blockEnd:z.number().int().min(1).max(100000),tableIndex:z.number().int().min(1).max(1000).nullable()}).strict(),
 z.object({kind:z.literal('DOCX'),blockStart:z.number().int().min(1).max(100000),blockEnd:z.number().int().min(1).max(100000),headingPath:z.array(z.string().max(200)).max(20),tableIndex:z.number().int().min(1).max(1000).nullable()}).strict(),
 z.object({kind:z.literal('XLSX'),sheetName:z.string().min(1).max(100),sheetIndex:z.number().int().min(1).max(1000),rowStart:z.number().int().min(1).max(1048576),rowEnd:z.number().int().min(1).max(1048576),columnStart:z.number().int().min(1).max(16384),columnEnd:z.number().int().min(1).max(16384),tableIndex:z.number().int().min(1).max(1000).nullable()}).strict(),
 z.object({kind:z.literal('CSV'),rowStart:z.number().int().min(1).max(10000),rowEnd:z.number().int().min(1).max(10000),columnStart:z.number().int().min(1).max(256),columnEnd:z.number().int().min(1).max(256),tableIndex:z.number().int().min(1).max(1000).nullable()}).strict(),
 z.object({kind:z.literal('HTML'),sourceUrl:z.string().url().max(2048).refine(value=>value.startsWith('https://')).nullable(),blockStart:z.number().int().min(1).max(100000),blockEnd:z.number().int().min(1).max(100000),headingPath:z.array(z.string().max(200)).max(20),tableIndex:z.number().int().min(1).max(1000).nullable()}).strict(),
]).superRefine((value,context)=>{
 if('blockStart'in value&&value.blockEnd<value.blockStart||'rowStart'in value&&(value.rowEnd<value.rowStart||value.columnEnd<value.columnStart))context.addIssue({code:'custom',message:'INVALID_LOCATION_RANGE'});
});
export type StructuredSourceLocation=z.infer<typeof locationSchema>;
export interface StructuredClientSource {jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number;sourceChecksum:string;extractionDigest:string}
export interface StructuredClientTable {tableIndex:number;pageNumber:number|null;sectionTitle:string|null;sheetName:string|null;firstRow:number;rows:string[][];location:StructuredSourceLocation}
export interface StructuredClientPreview {
	job:{id:string;revision:number;filename:string;format:(typeof importFormats)[number];sourceUrl:string|null};extractionRevision:number;kind:'PARSED'|'EDITED';
 extraction:{tables:StructuredClientTable[];flags:string[];report:{warnings:StructuredClientWarning[]}};datasetCandidate:StructuredDataset|null;
}
export interface StructuredClientWarning {code:string;severity:'BLOCKING'|'REVIEW';location:StructuredSourceLocation|null;count:number;disposition:'UNRESOLVED'}

const warningSchema=z.object({code:z.enum(extractionFlags),severity:z.enum(['BLOCKING','REVIEW']),location:locationSchema.nullable(),count:z.number().int().min(1).max(5_000_000),disposition:z.literal('UNRESOLVED')}).strict();
const pageSchema=z.object({pageNumber:z.number().int().min(1).max(1000).nullable(),text:z.string().max(5_000_000),requiresReview:z.boolean(),sectionTitle:z.string().max(200).nullable()}).strict();
const tableSchema=z.object({pageNumber:z.number().int().min(1).max(1000).nullable(),sectionTitle:z.string().max(200).nullable(),sheetName:z.string().max(100).nullable(),firstRow:z.number().int().min(1).max(100000),
 rows:z.array(z.array(z.string().max(10000)).min(1).max(256)).min(1).max(10000)}).strict();
const extractionSchema=z.object({title:z.string().max(500).nullable(),pages:z.array(pageSchema).min(1).max(1000),tables:z.array(tableSchema).max(1000),flags:z.array(z.enum(extractionFlags)).max(extractionFlags.length),
 locations:z.object({pages:z.array(locationSchema).min(1).max(1000),tables:z.array(locationSchema).max(1000)}).strict(),
 report:z.object({schemaVersion:z.literal(1),parser:z.object({name:z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/u),version:z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/u)}).strict(),inputBytes:z.number().int().min(1).max(20*1024*1024),pages:z.number().int().min(1).max(1000),tables:z.number().int().min(0).max(1000),cells:z.number().int().min(0).max(100000),textCharacters:z.number().int().min(0).max(5_000_000),replacementCharacters:z.number().int().min(0).max(5_000_000),truncated:z.literal(false),warnings:z.array(warningSchema).max(1000)}).strict(),
}).strict();

function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function normalizedJson(value:unknown):string{
 const sort=(candidate:unknown):unknown=>Array.isArray(candidate)?candidate.map(sort):isRecord(candidate)?Object.fromEntries(Object.keys(candidate).sort().map(key=>[key,sort(candidate[key])])):candidate;
 return JSON.stringify(sort(value));
}
function parseMapping(value:unknown):StructuredMapping|null{
 const parsed=mappingSchema.safeParse(value);if(!parsed.success)return null;
 const mapping=parsed.data;
 const definitions=STRUCTURED_FIELD_REGISTRY[mapping.dataset],seen=new Set<number>();
 const tables=mapping.tables.map(table=>{
  if(seen.has(table.tableIndex)||!exactKeys(table.fields,definitions.map(definition=>definition.name)))return null;
  seen.add(table.tableIndex);
  let hasRequiredColumn=false;
  for(const definition of definitions){
   const binding=fieldBindingSchema.safeParse(table.fields[definition.name]);if(!binding.success)return null;
   if(binding.data.kind==='COLUMN'){
    if(!isCompatible(binding.data.transform,definition.kind)||binding.data.blank==='NULL'&&!definition.nullable)return null;
    if(!definition.nullable)hasRequiredColumn=true;
   }else if(!validPayloadValue(definition,binding.data.value))return null;
  }
  if(!hasRequiredColumn)return null;
  const dataRanges=[...table.dataRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex||a.endRowIndex-b.endRowIndex);
  const excludedRanges=[...table.excludedRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex||a.endRowIndex-b.endRowIndex);
  const complete=[...dataRanges,...excludedRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex||a.endRowIndex-b.endRowIndex);let cursor=0;
  for(const range of complete){if(range.startRowIndex!==cursor)return null;cursor=range.endRowIndex+1;}
  if(dataRanges.length<1)return null;
  return {...table,dataRanges,excludedRanges,fields:Object.fromEntries(definitions.map(definition=>[definition.name,table.fields[definition.name]]))};
 });
 if(tables.some(table=>table===null))return null;
 const excludedTables=[...mapping.excludedTables].sort((a,b)=>a.tableIndex-b.tableIndex);
 for(const table of excludedTables){if(seen.has(table.tableIndex))return null;seen.add(table.tableIndex);}
 if(seen.size>1000)return null;
 return {...mapping,tables:tables as StructuredMapping['tables'],excludedTables};
}
export function parseStructuredMappingDraft(value:unknown):StructuredMapping|null{return parseMapping(value);}
function validNote(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=500&&wellFormed(value)&&value.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(value);}
function isCompatible(transform:StructuredTransform,kind:StructuredFieldKind):boolean{
 if(transform==='TEXT_V1')return ['TEXT','CURRENCY','EMAIL','URL'].includes(kind);
 if(transform==='INTEGER_V1')return kind==='INTEGER';
 if(transform==='DECIMAL_V1'||transform==='DECIMAL_COMMA_V1')return kind==='DECIMAL';
 if(['DATE_GREGORIAN_V1','DATE_BUDDHIST_V1','DATE_DMY_GREGORIAN_V1','DATE_DMY_BUDDHIST_V1'].includes(transform))return kind==='DATE';
 return (STRUCTURED_TRANSFORMS as readonly string[]).includes(transform)&&kind==='TIMESTAMP';
}
export function compatibleStructuredTransforms(kind:StructuredFieldKind):StructuredTransform[]{return STRUCTURED_TRANSFORMS.filter(transform=>isCompatible(transform,kind));}

export function partitionRows(rowCount:number,excludedRanges:unknown[]):{dataRanges:StructuredRange[];excludedRanges:StructuredExcludedRange[]}|null{
 if(!Number.isSafeInteger(rowCount)||rowCount<1||rowCount>10000||!Array.isArray(excludedRanges)||excludedRanges.length>100)return null;
 const checked:StructuredExcludedRange[]=[];
 for(const candidate of excludedRanges){
  const parsed=z.object({startRowIndex:index(9999),endRowIndex:index(9999),reason:z.enum(['HEADER','NON_DATA']),note:humanNote}).strict().safeParse(candidate);
  if(!parsed.success||parsed.data.startRowIndex>parsed.data.endRowIndex||parsed.data.endRowIndex>=rowCount)return null;
  checked.push(parsed.data);
 }
 checked.sort((a,b)=>a.startRowIndex-b.startRowIndex||a.endRowIndex-b.endRowIndex);
 const dataRanges:StructuredRange[]=[];let cursor=0;
 for(const range of checked){if(range.startRowIndex<cursor)return null;if(range.startRowIndex>cursor)dataRanges.push({startRowIndex:cursor,endRowIndex:range.startRowIndex-1});cursor=range.endRowIndex+1;}
 if(cursor<rowCount)dataRanges.push({startRowIndex:cursor,endRowIndex:rowCount-1});
 if(dataRanges.length===0||dataRanges.length>100)return null;
 return {dataRanges,excludedRanges:checked};
}

export type StructuredTableDecision=
 |{kind:'UNDECIDED';tableIndex:number}
 |{kind:'EXCLUDED';tableIndex:number;reason:'NOT_THIS_DATASET'|'NON_DATA'|null;note:string}
 |{kind:'MAPPED';tableIndex:number;fields:Record<string,unknown>;excludedRanges:unknown[]};
export function buildStructuredMappingFromDecisions(input:unknown):StructuredMapping|null{
 if(!isRecord(input)||!exactKeys(input,['dataset','source','tables','decisions'])||!Array.isArray(input.tables)||!Array.isArray(input.decisions))return null;
 if(typeof input.dataset!=='string'||!(STRUCTURED_DATASETS as readonly string[]).includes(input.dataset))return null;
 const dataset=input.dataset as StructuredDataset,source=z.object({jobId:uuid,jobRevision:revision,extractionRevision:revision.min(1),sourceChecksum:hash,extractionDigest:hash}).strict().safeParse(input.source);
 if(!source.success||input.tables.length<1||input.tables.length>1000||input.decisions.length!==input.tables.length)return null;
 const inventory: Array<{tableIndex:number;rowCount:number;columnCount:number}>=[];
 for(const [indexValue,candidate] of input.tables.entries()){
  if(!isRecord(candidate)||!exactKeys(candidate,['tableIndex','rowCount','columnCount'])||candidate.tableIndex!==indexValue||!Number.isSafeInteger(candidate.rowCount)||Number(candidate.rowCount)<1||Number(candidate.rowCount)>10000||!Number.isSafeInteger(candidate.columnCount)||Number(candidate.columnCount)<1||Number(candidate.columnCount)>256)return null;
  inventory.push(candidate as {tableIndex:number;rowCount:number;columnCount:number});
 }
 const byIndex=new Map<number,StructuredTableDecision>();
 for(const candidate of input.decisions){
  if(!isRecord(candidate)||!Number.isSafeInteger(candidate.tableIndex)||byIndex.has(Number(candidate.tableIndex)))return null;
  byIndex.set(Number(candidate.tableIndex),candidate as unknown as StructuredTableDecision);
 }
 if(byIndex.size!==inventory.length)return null;
 const mapped:Array<StructuredMapping['tables'][number]>=[],excluded:Array<StructuredMapping['excludedTables'][number]>=[];let dataRowCount=0;
 for(const table of inventory){
  const decision=byIndex.get(table.tableIndex);if(!decision||decision.kind==='UNDECIDED'||decision.tableIndex!==table.tableIndex)return null;
  if(decision.kind==='EXCLUDED'){
   if((decision.reason!=='NOT_THIS_DATASET'&&decision.reason!=='NON_DATA')||!validNote(decision.note))return null;
   excluded.push({tableIndex:table.tableIndex,reason:decision.reason,note:decision.note});continue;
  }
  if(decision.kind!=='MAPPED'||!isRecord(decision.fields)||!Array.isArray(decision.excludedRanges))return null;
  const partition=partitionRows(table.rowCount,decision.excludedRanges);if(!partition)return null;
  const definitions=STRUCTURED_FIELD_REGISTRY[dataset];
  if(!exactKeys(decision.fields,definitions.map(field=>field.name)))return null;
  const fields:Record<string,StructuredFieldBinding>={};let hasRequiredColumn=false;
  for(const definition of definitions){
   const parsed=fieldBindingSchema.safeParse(decision.fields[definition.name]);if(!parsed.success)return null;
   const binding=parsed.data;
   if(binding.kind==='COLUMN'){
    if(binding.columnIndex>=table.columnCount||!isCompatible(binding.transform,definition.kind)||binding.blank==='NULL'&&!definition.nullable)return null;
    if(!definition.nullable)hasRequiredColumn=true;
   }else if(!definition.nullable&&binding.value===null)return null;
   fields[definition.name]=binding;
  }
  if(!hasRequiredColumn)return null;
  dataRowCount+=partition.dataRanges.reduce((sum,range)=>sum+range.endRowIndex-range.startRowIndex+1,0);
  if(dataRowCount>2000)return null;
  mapped.push({tableIndex:table.tableIndex,dataRanges:partition.dataRanges,excludedRanges:partition.excludedRanges,fields});
 }
 if(mapped.length===0)return null;
 return parseMapping({version:1,registryVersion:'structured-v1',dataset,source:source.data,tables:mapped,excludedTables:excluded});
}

export function structuredColumnLabel(location:StructuredSourceLocation,columnIndex:number):string{
 if(!Number.isSafeInteger(columnIndex)||columnIndex<0)return 'คอลัมน์ที่ไม่ทราบตำแหน่ง';
 if(location.kind==='XLSX'){
  let n=location.columnStart+columnIndex,label='';while(n>0){const digit=(n-1)%26;label=String.fromCharCode(65+digit)+label;n=Math.floor((n-1)/26);}
  return `${location.sheetName}!${label} · คอลัมน์ต้นฉบับ ${location.columnStart+columnIndex}`;
 }
 if(location.kind==='CSV')return `CSV · คอลัมน์ ${location.columnStart+columnIndex}`;
 return `คอลัมน์สกัด ${columnIndex+1}`;
}
export function structuredRowLabel(table:StructuredClientTable,rowIndex:number):string{
 const sourceRow=table.firstRow+rowIndex,location=table.location;
 switch(location.kind){
  case 'CSV':return `CSV · ระเบียน ${sourceRow}`;
  case 'XLSX':return `${location.sheetName} · แถว ${sourceRow}`;
  case 'PDF':return `PDF หน้า ${location.pageNumber} · แถวที่อ่านได้ ${sourceRow}`;
  case 'DOCX':return `เอกสาร Word · ${location.headingPath.length?location.headingPath.join(' / '):table.sectionTitle??'เนื้อหา'} · แถวที่อ่านได้ ${sourceRow}`;
  case 'HTML':return `หน้าเว็บ · ${location.headingPath.length?location.headingPath.join(' / '):table.sectionTitle??'เนื้อหา'} · แถวที่อ่านได้ ${sourceRow}`;
 }
}
export function structuredTableLabel(table:StructuredClientTable):string{
 const {location}=table;
 switch(location.kind){
  case 'XLSX':return `${location.sheetName} · ตาราง ${table.tableIndex+1}`;
  case 'CSV':return `CSV · ตาราง ${table.tableIndex+1}`;
  case 'PDF':return `PDF หน้า ${location.pageNumber} · ${table.sectionTitle??`ตาราง ${table.tableIndex+1}`}`;
  case 'DOCX':return `เอกสาร Word · ${location.headingPath.length?location.headingPath.join(' / '):table.sectionTitle??`ตาราง ${table.tableIndex+1}`}`;
  case 'HTML':return `หน้าเว็บ · ${location.headingPath.length?location.headingPath.join(' / '):table.sectionTitle??`ตาราง ${table.tableIndex+1}`}`;
 }
}

export function parseStructuredSourceEnvelope(body:unknown,expectedJobId:string):StructuredClientSource|null{
 if(!isRecord(body)||!exactKeys(body,['source'])||!isRecord(body.source)||!exactKeys(body.source,['jobId','jobRevision','extractionRevision','reviewRevision','sourceChecksum','extractionDigest']))return null;
 const sourceSchema=z.object({jobId:uuid,jobRevision:revision,extractionRevision:revision.min(1),reviewRevision:revision,sourceChecksum:hash,extractionDigest:hash}).strict();
 const parsed=sourceSchema.safeParse(body.source);if(!parsed.success||parsed.data.jobId.toLowerCase()!==expectedJobId.toLowerCase())return null;
 return parsed.data;
}

const analysisKeys=['title','departmentCode','documentType','familyCode','versionName','academicYear','publishedDate','effectiveFrom','effectiveTo','authorityLevel','containsTables','datasetCandidate','recommendedStorageMode','sensitiveRisk','sensitiveCategories','amendmentCandidate','flags','reviewStatus','approved'] as const;
const analysisFlags=['SOURCE_REVIEW_REQUIRED','ACADEMIC_YEAR_AMBIGUOUS','FAMILY_AMBIGUOUS','STRUCTURED_SCHEMA_UNAVAILABLE','SENSITIVE_DATA_REVIEW_REQUIRED'] as const;
const sensitiveCategories=['STUDENT_RECORDS','PHONE','PERSONAL_EMAIL','GRADES','MEDICAL','PERSONAL_FINANCE'] as const;
function validAnalysis(value:unknown):{datasetCandidate:StructuredDataset|null}|null{
 if(!isRecord(value)||!exactKeys(value,analysisKeys))return null;
 const nullableText=(v:unknown,max:number)=>v===null||typeof v==='string'&&v.length<=max&&wellFormed(v);
 if(!nullableText(value.title,500)||!nullableText(value.departmentCode,80)||!nullableText(value.documentType,100)||!nullableText(value.familyCode,100)||!nullableText(value.versionName,100))return null;
 if(value.academicYear!==null&&(!Number.isInteger(value.academicYear)||Number(value.academicYear)<1000||Number(value.academicYear)>2999))return null;
 if(value.publishedDate!==null||value.effectiveFrom!==null||value.effectiveTo!==null||value.authorityLevel!==null||typeof value.containsTables!=='boolean')return null;
 if(value.datasetCandidate!==null&&!(STRUCTURED_DATASETS as readonly unknown[]).includes(value.datasetCandidate))return null;
 if(!['RAG','STRUCTURED','BOTH'].includes(String(value.recommendedStorageMode))||typeof value.sensitiveRisk!=='boolean'||!Array.isArray(value.sensitiveCategories)||value.sensitiveCategories.some(category=>!(sensitiveCategories as readonly unknown[]).includes(category))||new Set(value.sensitiveCategories).size!==value.sensitiveCategories.length||!Array.isArray(value.flags)||value.flags.some(flag=>!(analysisFlags as readonly unknown[]).includes(flag)&&!(extractionFlags as readonly unknown[]).includes(flag))||new Set(value.flags).size!==value.flags.length||typeof value.amendmentCandidate!=='boolean'||value.reviewStatus!=='PENDING_REVIEW'||value.approved!==false)return null;
 return {datasetCandidate:value.datasetCandidate as StructuredDataset|null};
}
function validateJob(value:unknown,expectedJobId:string){
 const keys=['id','status','revision','filename','format','mimeType','sourceUrl','acquiredFrom','fetchedAt','acquisition','byteLength','createdAt','errorCode'] as const;
 if(!isRecord(value)||!exactKeys(value,keys)||typeof value.id!=='string'||value.id.toLowerCase()!==expectedJobId.toLowerCase()||!uuid.safeParse(value.id).success||value.status!=='READY')return null;
 if(!revision.safeParse(value.revision).success||typeof value.filename!=='string'||value.filename.length<1||value.filename.length>180||!importFormats.includes(value.format as typeof importFormats[number]))return null;
 if(typeof value.mimeType!=='string'||value.mimeType.length<1||value.mimeType.length>200||!(value.sourceUrl===null||typeof value.sourceUrl==='string'&&value.sourceUrl.length<=2048))return null;
 if(value.acquiredFrom!=='UPLOAD'&&value.acquiredFrom!=='URL'||!(value.fetchedAt===null||typeof value.fetchedAt==='string'&&Number.isFinite(Date.parse(value.fetchedAt))))return null;
 if(value.acquisition!==null&&!isRecord(value.acquisition)||!Number.isSafeInteger(value.byteLength)||Number(value.byteLength)<1||Number(value.byteLength)>20*1024*1024)return null;
 if(typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!(value.errorCode===null||typeof value.errorCode==='string'))return null;
 return {id:value.id,revision:value.revision as number,filename:value.filename,format:value.format as typeof importFormats[number],sourceUrl:value.sourceUrl as string|null};
}
export function parseStructuredPreviewEnvelope(body:unknown,expectedJobId:string):StructuredClientPreview|null{
 if(!isRecord(body)||!exactKeys(body,['preview'])||!isRecord(body.preview)||!exactKeys(body.preview,['job','extractionRevision','kind','extraction','analysis','edit']))return null;
 const preview=body.preview,job=validateJob(preview.job,expectedJobId),analysis=validAnalysis(preview.analysis);
 if(!job||!analysis||!Number.isSafeInteger(preview.extractionRevision)||Number(preview.extractionRevision)<1||Number(preview.extractionRevision)>999_999_999||preview.kind!=='PARSED'&&preview.kind!=='EDITED')return null;
 if(preview.edit!==null){
  if(!isRecord(preview.edit)||!exactKeys(preview.edit,['reason','changedPages','changedCells','titleChanged'])||typeof preview.edit.reason!=='string'||preview.edit.reason.length<1||preview.edit.reason.length>500||!Array.isArray(preview.edit.changedPages)||!Array.isArray(preview.edit.changedCells)||typeof preview.edit.titleChanged!=='boolean')return null;
  if(preview.edit.changedPages.some(value=>!Number.isInteger(value)||Number(value)<0||Number(value)>999)||preview.edit.changedCells.some(cell=>!isRecord(cell)||!exactKeys(cell,['table','row','column'])||!Number.isInteger(cell.table)||!Number.isInteger(cell.row)||!Number.isInteger(cell.column)))return null;
 }
 const parsed=extractionSchema.safeParse(preview.extraction);if(!parsed.success)return null;
 const extraction=parsed.data;
 if(extraction.locations.tables.length!==extraction.tables.length||extraction.locations.pages.length!==extraction.pages.length||extraction.report.pages!==extraction.pages.length||extraction.report.tables!==extraction.tables.length||extraction.report.warnings.length>1000)return null;
 const totalCells=extraction.tables.reduce((sum,table)=>sum+table.rows.reduce((count,row)=>count+row.length,0),0);
 if(totalCells!==extraction.report.cells||totalCells>100000)return null;
 const locations:StructuredSourceLocation[]=[];
 for(let i=0;i<extraction.tables.length;i++){
  const table=extraction.tables[i]!,location=extraction.locations.tables[i]!;
  if(location.kind!==job.format||location.tableIndex!==i+1||table.pageNumber!==null&&(location.kind==='PDF'?location.pageNumber!==table.pageNumber:true))return null;
  const width=Math.max(...table.rows.map(row=>row.length));
  if(location.kind==='CSV'||location.kind==='XLSX'){
   if(location.rowStart!==table.firstRow||location.rowEnd-location.rowStart+1!==table.rows.length||location.columnEnd-location.columnStart+1!==width)return null;
   if(location.kind==='XLSX'&&location.sheetName!==table.sheetName)return null;
  }
  locations.push(location);
 }
 if(extraction.locations.pages.some(location=>location.kind!==job.format)||extraction.report.warnings.some(warning=>warning.location!==null&&warning.location.kind!==job.format))return null;
 return {job,extractionRevision:preview.extractionRevision as number,kind:preview.kind,extraction:{tables:extraction.tables.map((table,tableIndex)=>({tableIndex,...table,location:locations[tableIndex]!})),flags:extraction.flags,report:{warnings:extraction.report.warnings}},datasetCandidate:analysis.datasetCandidate};
}

function canonicalJson(value:unknown):string{
 const canonical=(item:unknown):unknown=>Array.isArray(item)?item.map(canonical):isRecord(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,canonical(item[key])])):item;
 return JSON.stringify(canonical(value));
}
export async function canonicalStructuredDigest(domain:string,value:unknown):Promise<string>{
 const bytes=new TextEncoder().encode(JSON.stringify({domain,value:JSON.parse(canonicalJson(value)) as unknown}));
 const result=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function validCivilDate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/u.test(value))return false;const year=Number(value.slice(0,4));if(year<1800||year>2400)return false;
 try{return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;}catch{return false;}
}
function convertCivil(value:string,buddhist:boolean,dmy:boolean):string|null{
 const match=(dmy?/^(\d{2})\/(\d{2})\/(\d{4})$/u:/^(\d{4})-(\d{2})-(\d{2})$/u).exec(value);if(!match||match[0]!==value)return null;
 const year=Number(match[dmy?3:1])-(buddhist?543:0),month=match[2],day=match[dmy?1:3];if(year<1800||year>2400)return null;
 const output=`${String(year).padStart(4,'0')}-${month}-${day}`;return validCivilDate(output)?output:null;
}
function convertUtc(value:string):string|null{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)||!validCivilDate(value.slice(0,10)))return null;
 try{return new Date(value).toISOString()===value?value:null;}catch{return null;}
}
function convertPlus07(value:string):string|null{
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/u.test(value))return null;
 const iso=value.replace(' ','T')+'Z';if(!convertUtc(iso))return null;
 try{return convertUtc(new Date(new Date(iso).getTime()-7*60*60*1000).toISOString());}catch{return null;}
}
function transformed(binding:StructuredColumnBinding,value:string):string|number|null|undefined{
 if(typeof value!=='string'||!wellFormed(value)||value.length>10000)return undefined;
 if(value.trim()==='')return binding.blank==='NULL'?null:undefined;
 switch(binding.transform){
  case 'TEXT_V1':return value;
  case 'INTEGER_V1':return /^(?:0|[1-9][0-9]{0,8})$/u.test(value)?Number(value):undefined;
  case 'DECIMAL_V1':return /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)?value:undefined;
  case 'DECIMAL_COMMA_V1':return /^(?:(?:0|[1-9][0-9]*)|(?:[1-9][0-9]{0,2}(?:,[0-9]{3})+))(?:\.[0-9]+)?$/u.test(value)?value.replaceAll(',',''):undefined;
  case 'DATE_GREGORIAN_V1':return convertCivil(value,false,false)??undefined;
  case 'DATE_BUDDHIST_V1':return convertCivil(value,true,false)??undefined;
  case 'DATE_DMY_GREGORIAN_V1':return convertCivil(value,false,true)??undefined;
  case 'DATE_DMY_BUDDHIST_V1':return convertCivil(value,true,true)??undefined;
  case 'TIMESTAMP_UTC_V1':return convertUtc(value)??undefined;
  case 'TIMESTAMP_PLUS07_V1':return convertPlus07(value)??undefined;
  case 'DATE_GREGORIAN_PLUS07_MIDNIGHT_V1':{const date=convertCivil(value,false,false);return date?convertPlus07(`${date} 00:00:00.000`)??undefined:undefined;}
  case 'DATE_BUDDHIST_PLUS07_MIDNIGHT_V1':{const date=convertCivil(value,true,false);return date?convertPlus07(`${date} 00:00:00.000`)??undefined:undefined;}
 }
}
function validPayloadValue(definition:StructuredFieldDefinition,value:unknown):boolean{
 if(value===null)return definition.nullable;
 if(definition.kind==='INTEGER')return typeof value==='number'&&Number.isSafeInteger(value)&&(definition.min===undefined||value>=definition.min)&&(definition.max===undefined||value<=definition.max);
 if(definition.kind==='DECIMAL'){
  if(typeof value!=='string'||definition.precision===undefined||definition.scale===undefined)return false;
  const integer=definition.precision-definition.scale;return new RegExp(`^(?:0|[1-9][0-9]{0,${integer-1}})(?:\\.[0-9]{1,${definition.scale}})?$`,'u').test(value);
 }
 if(typeof value!=='string'||!wellFormed(value)||value.length<1||value.length>(definition.maxLength??5000)||value.trim().length===0||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))return false;
 if(definition.kind==='DATE')return validCivilDate(value);
 if(definition.kind==='TIMESTAMP')return convertUtc(value)!==null;
 if(definition.kind==='CURRENCY')return /^[A-Z]{3}$/u.test(value);
 if(definition.kind==='EMAIL')return value.length<=254&&/^[\u0021-\u007e]+$/u.test(value)&&/^\S+@\S+\.\S+$/u.test(value);
 if(definition.kind==='URL'){
  try{const url=new URL(value),authority=value.slice(value.indexOf('//')+2).split(/[/?]/u)[0]??'';return /^https:\/\//iu.test(value)&&!/[\s\\#]/u.test(value)&&Boolean(authority)&&!authority.includes('@')&&!/:[0-9]*$/u.test(authority)&&url.protocol==='https:'&&Boolean(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.hash;}
  catch{return false;}
 }
 return true;
}

export interface StructuredSnapshotExpectation {source:StructuredClientSource;preview:StructuredClientPreview;mapping:StructuredMapping}
export interface ValidatedStructuredSnapshot {snapshot:Record<string,unknown>;plan:Record<string,unknown>;acknowledgment:StructuredMappingAcknowledgment;publicationAvailable:boolean}
const planKeys=['schemaVersion','mapperVersion','registryVersion','dataset','binding','sourceChecksum','sourceFormat','sourceUrl','extractionDigest','mappingDigest','mapping','rows','warnings','flags','requiresReview','digest'] as const;
const bindingKeys=['jobId','jobRevision','extractionRevision','reviewRevision'] as const;
function validEvidence(candidate:unknown,field:StructuredFieldDefinition,binding:StructuredFieldBinding,expectedValue:string):boolean{
 if(binding.kind==='CONSTANT')return isRecord(candidate)&&exactKeys(candidate,['kind','field','value','note'])&&candidate.kind==='CONSTANT'&&candidate.field===field.name&&candidate.value===binding.value&&candidate.note===binding.note;
 return isRecord(candidate)&&exactKeys(candidate,['kind','field','columnIndex','sourceColumn','extractedValue','transform','blank'])&&candidate.kind==='CELL'&&candidate.field===field.name&&candidate.columnIndex===binding.columnIndex&&candidate.extractedValue===expectedValue&&candidate.transform===binding.transform&&candidate.blank===binding.blank;
}
async function validRow(row:unknown,indexValue:number,tableMapping:StructuredMapping['tables'][number],table:StructuredClientTable,mapping:StructuredMapping,datasetFields:StructuredFieldDefinition[]):Promise<boolean>{
 if(!isRecord(row)||!exactKeys(row,['index','tableIndex','rowIndex','sourceRow','coordinateKind','sourceLocation','payload','payloadDigest','fields']))return false;
 if(!Number.isSafeInteger(row.rowIndex)||!Number.isSafeInteger(row.sourceRow)||!Number.isSafeInteger(row.index)||row.index!==indexValue||row.tableIndex!==tableMapping.tableIndex)return false;
 const rowIndex=Number(row.rowIndex),sourceRow=table.firstRow+rowIndex;
 if(rowIndex<table.rows.length?row.sourceRow!==sourceRow:true)return false;
 const included=tableMapping.dataRanges.some(range=>rowIndex>=range.startRowIndex&&rowIndex<=range.endRowIndex);if(!included)return false;
 const expectedKind=table.location.kind==='XLSX'?'WORKSHEET_CELL':table.location.kind==='CSV'?'CSV_RECORD':'EXTRACTED_LOGICAL';
 if(row.coordinateKind!==expectedKind||normalizedJson(row.sourceLocation)!==normalizedJson(table.location))return false;
 const values=table.rows[rowIndex];if(!values)return false;const width=Math.max(...table.rows.map(candidate=>candidate.length));if(values.length!==width)return false;
 if(!isRecord(row.payload)||!exactKeys(row.payload,datasetFields.map(field=>field.name))||!Array.isArray(row.fields)||row.fields.length!==datasetFields.length)return false;
 const parsedFields:unknown[]=[];
 for(const [fieldIndex,definition] of datasetFields.entries()){
  const binding=tableMapping.fields[definition.name];if(!binding)return false;
  let expectedValue:string|number|null;
  if(binding.kind==='CONSTANT')expectedValue=binding.value;
  else{
   const raw=values[binding.columnIndex];if(typeof raw!=='string'||binding.columnIndex>=values.length)return false;
   const converted=transformed(binding,raw);if(converted===undefined)return false;expectedValue=converted;
   const base=table.location.kind==='CSV'||table.location.kind==='XLSX'?table.location.columnStart:1;
   const evidence=row.fields[fieldIndex];if(!validEvidence(evidence,definition,binding,raw)||!isRecord(evidence)||evidence.sourceColumn!==base+binding.columnIndex)return false;
  }
  if(binding.kind==='CONSTANT'&&!validEvidence(row.fields[fieldIndex],definition,binding,''))return false;
  if(row.payload[definition.name]!==expectedValue||!validPayloadValue(definition,row.payload[definition.name]))return false;
  parsedFields.push(row.fields[fieldIndex]);
 }
 if(mapping.dataset==='tuition_fees'&&row.payload.effective_to!==null&&String(row.payload.effective_to)<String(row.payload.effective_from))return false;
 if(mapping.dataset==='academic_calendar_events'&&row.payload.end_date!==null&&String(row.payload.end_date)<String(row.payload.start_date))return false;
 if(mapping.dataset==='announcements'&&row.payload.effective_to!==null&&String(row.payload.effective_to)<String(row.payload.effective_from))return false;
 if(row.payloadDigest!==await canonicalStructuredDigest('structured-payload-v1',{dataset:mapping.dataset,payload:row.payload}))return false;
 return true;
}
export async function validateStructuredPlanSnapshot(body:unknown,expected:StructuredSnapshotExpectation):Promise<ValidatedStructuredSnapshot|null>{
 try{
  if(!isRecord(body)||!exactKeys(body,['snapshot'])||!isRecord(body.snapshot))return null;
  const snapshot=body.snapshot;
  if(!exactKeys(snapshot,['jobId','jobRevision','extractionRevision','reviewRevision','nextReviewRevision','plan','acknowledgment','publicationAvailable']))return null;
  const next=snapshot.nextReviewRevision;
  if(snapshot.jobId!==expected.source.jobId||snapshot.jobRevision!==expected.source.jobRevision||snapshot.extractionRevision!==expected.source.extractionRevision||snapshot.reviewRevision!==expected.source.reviewRevision||
   !Number.isSafeInteger(next)||next!==expected.source.reviewRevision+1||typeof snapshot.publicationAvailable!=='boolean')return null;
  const ack=snapshot.acknowledgment;
  if(!isRecord(ack)||!exactKeys(ack,['contentDigest','mapperVersion'])||!hash.safeParse(ack.contentDigest).success||ack.mapperVersion!=='structured-mapper-v1')return null;
  const plan=snapshot.plan;if(!isRecord(plan)||!exactKeys(plan,planKeys))return null;
  if(plan.schemaVersion!==1||plan.mapperVersion!=='structured-mapper-v1'||plan.registryVersion!=='structured-v1'||plan.dataset!==expected.mapping.dataset||plan.sourceChecksum!==expected.source.sourceChecksum||plan.sourceFormat!==expected.preview.job.format||plan.sourceUrl!==expected.preview.job.sourceUrl||plan.extractionDigest!==expected.source.extractionDigest||plan.requiresReview!==true||!hash.safeParse(plan.digest).success||!hash.safeParse(plan.mappingDigest).success)return null;
  if(!isRecord(plan.binding)||!exactKeys(plan.binding,bindingKeys)||plan.binding.jobId!==expected.source.jobId||plan.binding.jobRevision!==expected.source.jobRevision||plan.binding.extractionRevision!==expected.source.extractionRevision||plan.binding.reviewRevision!==next)return null;
  const planMapping=parseMapping(plan.mapping);if(!planMapping||normalizedJson(planMapping)!==normalizedJson(expected.mapping)||plan.mappingDigest!==await canonicalStructuredDigest('structured-mapping-v1',planMapping))return null;
  const inventory=expected.preview.extraction.tables.map(table=>({tableIndex:table.tableIndex,rowCount:table.rows.length,columnCount:Math.max(...table.rows.map(row=>row.length))}));
  if(!validateMappingInventory(planMapping,inventory,expected.source))return null;
  if(!Array.isArray(plan.rows)||!Array.isArray(plan.warnings)||!Array.isArray(plan.flags)||normalizedJson(plan.warnings)!==normalizedJson(expected.preview.extraction.report.warnings)||normalizedJson(plan.flags)!==normalizedJson(expected.preview.extraction.flags))return null;
  let expectedRows=0;for(const table of planMapping.tables)expectedRows+=table.dataRanges.reduce((sum,range)=>sum+range.endRowIndex-range.startRowIndex+1,0);
  if(expectedRows<1||expectedRows>2000||plan.rows.length!==expectedRows)return null;
  const rowByIndex=new Map<number,unknown>();for(const row of plan.rows){if(!isRecord(row)||!Number.isSafeInteger(row.tableIndex)||!Number.isSafeInteger(row.index)||rowByIndex.has(Number(row.index)))return null;rowByIndex.set(Number(row.index),row);}
  let cursor=0;const fields=STRUCTURED_FIELD_REGISTRY[planMapping.dataset];
  for(const tableMapping of planMapping.tables){
   const table=expected.preview.extraction.tables[tableMapping.tableIndex];if(!table)return null;
   for(const range of tableMapping.dataRanges)for(let rowIndex=range.startRowIndex;rowIndex<=range.endRowIndex;rowIndex++){
    const candidate=rowByIndex.get(cursor);
    if(!isRecord(candidate)||!await validRow(candidate,cursor,tableMapping,table,planMapping,fields)||candidate.rowIndex!==rowIndex)return null;cursor++;
   }
  }
  const {digest,...planBody}=plan;if(digest!==await canonicalStructuredDigest('structured-plan-v1',planBody))return null;
  const {digest:_digest,...content}=plan;void _digest;
  const {reviewRevision:_reviewRevision,...sourceBinding}=plan.binding as Record<string,unknown>;void _reviewRevision;
  const expectedAck=await canonicalStructuredDigest('structured-ack-v1',{...content,binding:sourceBinding});
  if(ack.contentDigest!==expectedAck)return null;
  return {snapshot,plan,acknowledgment:ack as unknown as StructuredMappingAcknowledgment,publicationAvailable:snapshot.publicationAvailable};
 }catch{return null;}
}

function validateMappingInventory(mapping:StructuredMapping,tables:Array<{tableIndex:number;rowCount:number;columnCount:number}>,source:StructuredClientSource):boolean{
 if(mapping.source.jobId.toLowerCase()!==source.jobId.toLowerCase()||mapping.source.jobRevision!==source.jobRevision||mapping.source.extractionRevision!==source.extractionRevision||mapping.source.sourceChecksum!==source.sourceChecksum||mapping.source.extractionDigest!==source.extractionDigest)return false;
 if(mapping.tables.length<1||mapping.tables.length>64||mapping.excludedTables.length>1000||mapping.tables.length+mapping.excludedTables.length!==tables.length)return false;
 const seen=new Set<number>();let rows=0;
 for(const mapped of mapping.tables){
  const inventory=tables[mapped.tableIndex];if(!inventory||seen.has(mapped.tableIndex)||inventory.tableIndex!==mapped.tableIndex)return false;seen.add(mapped.tableIndex);
  const ranges=[...mapped.dataRanges,...mapped.excludedRanges].sort((a,b)=>a.startRowIndex-b.startRowIndex||a.endRowIndex-b.endRowIndex);let cursor=0;
  for(const range of ranges){if(range.startRowIndex!==cursor||range.endRowIndex>=inventory.rowCount)return false;cursor=range.endRowIndex+1;}
  if(cursor!==inventory.rowCount)return false;
  const fields=STRUCTURED_FIELD_REGISTRY[mapping.dataset];if(!fields||Object.keys(mapped.fields).length!==fields.length||Object.keys(mapped.fields).some(name=>!fields.some(field=>field.name===name)))return false;
  let hasRequiredColumn=false;
  for(const definition of fields){const binding=mapped.fields[definition.name];if(!binding)return false;
   if(binding.kind==='COLUMN'){
    if(binding.columnIndex>=inventory.columnCount||!isCompatible(binding.transform,definition.kind)||binding.blank==='NULL'&&!definition.nullable)return false;
    if(!definition.nullable)hasRequiredColumn=true;
   }else if(!definition.nullable&&binding.value===null)return false;
  }
  if(!hasRequiredColumn)return false;
  const count=mapped.dataRanges.reduce((sum,range)=>sum+range.endRowIndex-range.startRowIndex+1,0);if(count<1)return false;rows+=count;if(rows>2000)return false;
 }
 for(const excluded of mapping.excludedTables){if(!tables[excluded.tableIndex]||seen.has(excluded.tableIndex)||tables[excluded.tableIndex]!.tableIndex!==excluded.tableIndex)return false;seen.add(excluded.tableIndex);}
 return seen.size===tables.length&&tables.every((table,indexValue)=>seen.has(indexValue)&&table.tableIndex===indexValue);
}

export interface StructuredRequestLease {signal:AbortSignal;isCurrent:()=>boolean}
export class StructuredRequestGate {
 private epoch=0;private controller:AbortController|null=null;
 begin():StructuredRequestLease{
  this.controller?.abort();const controller=new AbortController(),epoch=++this.epoch;this.controller=controller;
  return {signal:controller.signal,isCurrent:()=>epoch===this.epoch&&!controller.signal.aborted};
 }
 invalidate():void{this.epoch++;this.controller?.abort();this.controller=null;}
 dispose():void{this.invalidate();}
}
