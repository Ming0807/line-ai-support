import {z} from 'zod';

export const IMPORT_LIMITS={originalBytes:20*1024*1024,characters:5_000_000,pages:1000,tables:1000,cells:100_000,rows:10_000,columns:256,cellCharacters:10_000} as const;
export const importFormats=['PDF','DOCX','XLSX','CSV','HTML'] as const;
export type ImportFormat=typeof importFormats[number];
/** Server-only references are never permission tokens or public object URLs. */
export interface OriginalRef {
 readonly id:string;readonly backend:'PRIVATE_DATABASE'|'PRIVATE_STORAGE';readonly byteLength:number;
 readonly format:ImportFormat;readonly checksum:string;readonly keyVersion:1;
}
export type SourceLocation=
 | {kind:'PDF';pageNumber:number;blockStart:number;blockEnd:number;tableIndex:number|null}
 | {kind:'DOCX';blockStart:number;blockEnd:number;headingPath:string[];tableIndex:number|null}
 | {kind:'XLSX';sheetName:string;sheetIndex:number;rowStart:number;rowEnd:number;columnStart:number;columnEnd:number;tableIndex:number|null}
 | {kind:'CSV';rowStart:number;rowEnd:number;columnStart:number;columnEnd:number;tableIndex:number|null}
 | {kind:'HTML';sourceUrl:string|null;blockStart:number;blockEnd:number;headingPath:string[];tableIndex:number|null};
export interface ExtractionWarning {
 code:string;severity:'BLOCKING'|'REVIEW';location:SourceLocation|null;count:number;
 disposition:'UNRESOLVED'|'CORRECTED'|'FALSE_POSITIVE';
}
export interface ExtractionReport {
 schemaVersion:1;parser:{name:string;version:string};inputBytes:number;pages:number;tables:number;cells:number;
 textCharacters:number;replacementCharacters:number;truncated:boolean;warnings:ExtractionWarning[];
}
export const datasetTypes=['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'] as const;
export type DatasetType=typeof datasetTypes[number];
export interface ImportSource {
 readonly bytes:Uint8Array;readonly format:ImportFormat;readonly filename:string;readonly mimeType:string;
 readonly checksum:string;readonly sourceUrl:string|null;readonly acquiredFrom:'UPLOAD'|'URL';readonly fetchedAt:string|null;
}
export const extractionFlags=['OCR_REQUIRED','LOW_TEXT_QUALITY','UNSUPPORTED_TABLES','ENCRYPTED_SOURCE','FORMULAS_PRESENT','HIDDEN_DATA_REVIEW','EXTERNAL_LINKS_REVIEW','PAGE_REVIEW_REQUIRED','TABLE_SHAPE_REVIEW'] as const;
const pageNumber=z.number().int().min(1).max(IMPORT_LIMITS.pages).nullable();
const sectionTitle=z.string().max(200).nullable();
export const extractionSchema=z.object({
 title:z.string().max(500).nullable(),
 pages:z.array(z.object({pageNumber,text:z.string().max(IMPORT_LIMITS.characters),requiresReview:z.boolean(),sectionTitle}).strict()).min(1).max(IMPORT_LIMITS.pages),
 tables:z.array(z.object({pageNumber,sectionTitle,sheetName:z.string().max(100).nullable(),firstRow:z.number().int().min(1),
  rows:z.array(z.array(z.string().max(IMPORT_LIMITS.cellCharacters)).min(1).max(IMPORT_LIMITS.columns)).min(1).max(IMPORT_LIMITS.rows)}).strict()).max(IMPORT_LIMITS.tables),
 flags:z.array(z.enum(extractionFlags)).max(extractionFlags.length),
}).strict().superRefine((value,context)=>{
 let characters=value.pages.reduce((sum,page)=>sum+page.text.length,0),cells=0;
 const provedPages=value.pages.flatMap(page=>page.pageNumber===null?[]:[page.pageNumber]);
 if(new Set(provedPages).size!==provedPages.length)context.addIssue({code:'custom',message:'DUPLICATE_PAGE'});
 for(const table of value.tables){for(const row of table.rows){cells+=row.length;characters+=row.reduce((sum,cell)=>sum+cell.length,0);}}
 if(cells>IMPORT_LIMITS.cells||characters>IMPORT_LIMITS.characters)context.addIssue({code:'custom',message:'EXTRACTION_LIMIT'});
});
export type Extraction=z.infer<typeof extractionSchema>;
/** Parser output before publication must retain format locations and measured quality. */
export interface LocatedExtraction extends Extraction {
 locations:{pages:SourceLocation[];tables:SourceLocation[]};report:ExtractionReport;
}
export const sensitiveCategories=['STUDENT_RECORDS','PHONE','PERSONAL_EMAIL','GRADES','MEDICAL','PERSONAL_FINANCE'] as const;
export type SensitiveCategory=typeof sensitiveCategories[number];
export interface ImportAnalysis {
 title:string|null;departmentCode:string|null;documentType:string|null;familyCode:string|null;versionName:string|null;academicYear:number|null;
 publishedDate:null;effectiveFrom:null;effectiveTo:null;authorityLevel:null;containsTables:boolean;
 datasetCandidate:DatasetType|null;recommendedStorageMode:'RAG'|'STRUCTURED'|'BOTH';
 sensitiveRisk:boolean;sensitiveCategories:SensitiveCategory[];amendmentCandidate:boolean;flags:string[];
 reviewStatus:'PENDING_REVIEW';approved:false;
}
