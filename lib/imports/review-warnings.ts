import {createHash} from 'node:crypto';
import type {ImportPreview} from './import-extraction';
import type {SourceLocation} from './types';

export type ReviewWarning={
 key:string;
 source:'PARSER'|'ANALYSIS';
 code:string;
 severity:'BLOCKING'|'REVIEW';
 location:SourceLocation|null;
 count:number;
};

type WarningRecord={code:string;severity:'BLOCKING'|'REVIEW';location:SourceLocation|null;count:number};

function canonicalLocation(location:SourceLocation|null):SourceLocation|null {
 if(location===null)return null;
 switch(location.kind){
  case 'PDF':return {kind:'PDF',pageNumber:location.pageNumber,blockStart:location.blockStart,blockEnd:location.blockEnd,tableIndex:location.tableIndex};
  case 'DOCX':return {kind:'DOCX',blockStart:location.blockStart,blockEnd:location.blockEnd,headingPath:[...location.headingPath],tableIndex:location.tableIndex};
  case 'XLSX':return {kind:'XLSX',sheetName:location.sheetName,sheetIndex:location.sheetIndex,rowStart:location.rowStart,rowEnd:location.rowEnd,
   columnStart:location.columnStart,columnEnd:location.columnEnd,tableIndex:location.tableIndex};
  case 'CSV':return {kind:'CSV',rowStart:location.rowStart,rowEnd:location.rowEnd,columnStart:location.columnStart,columnEnd:location.columnEnd,tableIndex:location.tableIndex};
  case 'HTML':return {kind:'HTML',sourceUrl:location.sourceUrl,blockStart:location.blockStart,blockEnd:location.blockEnd,
   headingPath:[...location.headingPath],tableIndex:location.tableIndex};
 }
}

function warningKey(preview:ImportPreview,source:ReviewWarning['source'],index:number,record:WarningRecord,parserDisposition?:string):string {
 const completeRecord=source==='PARSER'?{...record,disposition:parserDisposition}:record;
 const material=JSON.stringify(['yru:knowledge-review-warning:v1',preview.job.id,preview.extractionRevision,source,index,completeRecord]);
 return createHash('sha256').update(material,'utf8').digest('hex');
}

function analysisSeverity(code:string):ReviewWarning['severity'] {
 switch(code){
  case 'SOURCE_REVIEW_REQUIRED':
  case 'SENSITIVE_DATA_REVIEW_REQUIRED':
  case 'ACADEMIC_YEAR_AMBIGUOUS':
  case 'FAMILY_AMBIGUOUS':
   return 'BLOCKING';
  default:
   return 'REVIEW';
 }
}

/** Creates server-computed warning references without including source text or original identity data. */
export function buildReviewWarnings(preview:ImportPreview):ReviewWarning[] {
 const warnings:ReviewWarning[]=[];
 const parserCodes=new Set<string>();
 for(const [index,parserWarning] of preview.extraction.report.warnings.entries()){
  const location=canonicalLocation(parserWarning.location);
  const record:WarningRecord={code:parserWarning.code,severity:parserWarning.severity,location,count:parserWarning.count};
  parserCodes.add(parserWarning.code);
  warnings.push({key:warningKey(preview,'PARSER',index,record,parserWarning.disposition),source:'PARSER',...record});
 }
 const seenCodes=new Set(parserCodes);
 for(const [index,code] of preview.analysis.flags.entries()){
  if(seenCodes.has(code))continue;
  seenCodes.add(code);
  const record:WarningRecord={code,severity:analysisSeverity(code),location:null,count:1};
  warnings.push({key:warningKey(preview,'ANALYSIS',index,record),source:'ANALYSIS',...record});
 }
 return warnings;
}

/** Validates only supplied warning references; omitted warnings remain unresolved for the caller. */
export function assertReviewWarningBindings(entries:ReviewWarning[],dispositions:{warningKey:string}[]):void {
 const invalid=():never=>{throw new Error('IMPORT_REVIEW_WARNING_INVALID');};
 const known=new Set<string>();
 for(const entry of entries){
  if(!/^[a-f0-9]{64}$/.test(entry.key)||known.has(entry.key))invalid();
  known.add(entry.key);
 }
 const supplied=new Set<string>();
 for(const disposition of dispositions){
  if(typeof disposition?.warningKey!=='string'||!known.has(disposition.warningKey)||supplied.has(disposition.warningKey))invalid();
  supplied.add(disposition.warningKey);
 }
}
