import {z} from 'zod';
import {verifyImportSource} from './source';
import {IMPORT_LIMITS,extractionSchema,extractionFlags,type ImportSource,type LocatedExtraction} from './types';
const index=z.number().int().min(1).max(100_000);
const tableIndex=z.number().int().min(1).max(IMPORT_LIMITS.tables).nullable();
const block={blockStart:index,blockEnd:index};
const headingPath=z.array(z.string().max(200)).max(20);
export const sourceLocationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('PDF'),pageNumber:z.number().int().min(1).max(IMPORT_LIMITS.pages),...block,tableIndex}).strict(),
 z.object({kind:z.literal('DOCX'),...block,headingPath,tableIndex}).strict(),
 z.object({kind:z.literal('XLSX'),sheetName:z.string().min(1).max(100),sheetIndex:z.number().int().min(1).max(1000),
  rowStart:z.number().int().min(1).max(1_048_576),rowEnd:z.number().int().min(1).max(1_048_576),
  columnStart:z.number().int().min(1).max(16_384),columnEnd:z.number().int().min(1).max(16_384),tableIndex}).strict(),
 z.object({kind:z.literal('CSV'),rowStart:z.number().int().min(1).max(IMPORT_LIMITS.rows),rowEnd:z.number().int().min(1).max(IMPORT_LIMITS.rows),
  columnStart:z.number().int().min(1).max(IMPORT_LIMITS.columns),columnEnd:z.number().int().min(1).max(IMPORT_LIMITS.columns),tableIndex}).strict(),
 z.object({kind:z.literal('HTML'),sourceUrl:z.url().max(2048).refine(value=>value.startsWith('https://')).nullable(),...block,headingPath,tableIndex}).strict(),
]).superRefine((value,context)=>{
 if('blockStart' in value&&value.blockEnd<value.blockStart||'rowStart' in value&&(value.rowEnd<value.rowStart||value.columnEnd<value.columnStart))
  context.addIssue({code:'custom',message:'LOCATION_RANGE_INVALID'});
});
const count=z.number().int().min(0).max(IMPORT_LIMITS.characters);
const reportSchema=z.object({schemaVersion:z.literal(1),parser:z.object({name:z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),version:z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/)}).strict(),
 inputBytes:z.number().int().min(1).max(IMPORT_LIMITS.originalBytes),pages:z.number().int().min(1).max(IMPORT_LIMITS.pages),tables:z.number().int().min(0).max(IMPORT_LIMITS.tables),
 cells:z.number().int().min(0).max(IMPORT_LIMITS.cells),textCharacters:count,replacementCharacters:count,truncated:z.literal(false),
 warnings:z.array(z.object({code:z.enum(extractionFlags),severity:z.enum(['BLOCKING','REVIEW']),location:sourceLocationSchema.nullable(),
  count:z.number().int().min(1).max(IMPORT_LIMITS.characters),disposition:z.literal('UNRESOLVED')}).strict()).max(1000),
}).strict();
const locatedSchema=extractionSchema.safeExtend({locations:z.object({pages:z.array(sourceLocationSchema).min(1).max(IMPORT_LIMITS.pages),
 tables:z.array(sourceLocationSchema).max(IMPORT_LIMITS.tables)}).strict(),report:reportSchema});
const invalid=():never=>{throw new Error('IMPORT_EXTRACTION_INVALID');};
/** Parser reports cannot grant review disposition or omit provenance/quality evidence. */
export function validateLocatedExtraction(source:ImportSource,input:unknown):LocatedExtraction{
 const verified=verifyImportSource(source),parsed=locatedSchema.safeParse(input);if(!parsed.success)return invalid();const value=parsed.data;
 if(value.locations.pages.length!==value.pages.length||value.locations.tables.length!==value.tables.length)return invalid();
 const all=[...value.locations.pages,...value.locations.tables,...value.report.warnings.flatMap(warning=>warning.location?[warning.location]:[])];
 if(all.some(location=>location.kind!==verified.format||location.kind==='HTML'&&location.sourceUrl!==verified.sourceUrl))return invalid();
 const aligns=(pageNumber:number|null,location:typeof all[number])=>location.kind==='PDF'?location.pageNumber===pageNumber:pageNumber===null;
 if(value.pages.some((page,index)=>!aligns(page.pageNumber,value.locations.pages[index]))||value.tables.some((table,index)=>!aligns(table.pageNumber,value.locations.tables[index])))return invalid();
 const strings=[...value.pages.map(page=>page.text),...value.tables.flatMap(table=>table.rows.flat())];
 const cells=value.tables.reduce((sum,table)=>sum+table.rows.reduce((total,row)=>total+row.length,0),0);
 const textCharacters=strings.reduce((sum,text)=>sum+text.length,0);
 let replacementCharacters=0;for(const text of strings)for(const character of text)if(character==='\ufffd')replacementCharacters++;
 const report=value.report;
 if(!strings.some(text=>text.trim())&&(!value.flags.includes('LOW_TEXT_QUALITY')||!value.pages.some(page=>page.requiresReview)))return invalid();
 if(report.inputBytes!==verified.bytes.length||report.pages!==value.pages.length||report.tables!==value.tables.length||report.cells!==cells||report.textCharacters!==textCharacters||
  report.replacementCharacters!==replacementCharacters||value.flags.some(flag=>!report.warnings.some(warning=>warning.code===flag)))return invalid();
 for(const [index,table] of value.tables.entries()){
  const location=value.locations.tables[index];if(location.tableIndex!==index+1)return invalid();
  if(location.kind==='CSV'||location.kind==='XLSX'){
   const width=Math.max(...table.rows.map(row=>row.length));
   if(location.rowStart!==table.firstRow||location.rowEnd-location.rowStart+1!==table.rows.length||location.columnEnd-location.columnStart+1!==width)return invalid();
   if(location.kind==='XLSX'&&location.sheetName!==table.sheetName)return invalid();
  }
 }
 return value;
}
