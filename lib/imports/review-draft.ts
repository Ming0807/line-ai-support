import {z} from 'zod';
import {validateLocatedExtraction} from './extraction';
import {IMPORT_LIMITS,type ImportSource,type LocatedExtraction} from './types';

export interface ExtractionEditEvidence {reason:string;changedPages:number[];changedCells:{table:number;row:number;column:number}[];titleChanged:boolean;}

const inputSchema=z.object({
 reason:z.string().trim().min(1).max(500),
 pages:z.array(z.object({index:z.number().int().min(0).max(IMPORT_LIMITS.pages-1),text:z.string().max(IMPORT_LIMITS.characters)}).strict()).max(IMPORT_LIMITS.pages).optional(),
 cells:z.array(z.object({table:z.number().int().min(0).max(IMPORT_LIMITS.tables-1),row:z.number().int().min(0).max(IMPORT_LIMITS.rows-1),
  column:z.number().int().min(0).max(IMPORT_LIMITS.columns-1),text:z.string().max(IMPORT_LIMITS.cellCharacters)}).strict()).max(IMPORT_LIMITS.cells).optional(),
 title:z.string().max(500).nullable().optional(),
}).strict();

const invalid=():never=>{throw new Error('IMPORT_EDIT_INVALID');};

/** Applies only bounded text corrections; all provenance and parser evidence remain reviewable. */
export function applyExtractionEdit(source:ImportSource,current:LocatedExtraction,input:unknown):{extraction:LocatedExtraction;edit:ExtractionEditEvidence}{
 try{
  const verified=validateLocatedExtraction(source,current),parsed=inputSchema.safeParse(input);
  if(!parsed.success)return invalid();
  const operation=parsed.data;
  const next=structuredClone(verified);
  const seenPages=new Set<number>(),seenCells=new Set<string>();
  const changedPages:number[]=[],changedCells:ExtractionEditEvidence['changedCells']=[];
  for(const page of operation.pages??[]){
   if(seenPages.has(page.index)||page.index>=next.pages.length)return invalid();
   seenPages.add(page.index);
   if(page.text===next.pages[page.index].text)return invalid();
   next.pages[page.index].text=page.text;
   next.pages[page.index].requiresReview=true;
   changedPages.push(page.index);
  }
  for(const cell of operation.cells??[]){
   const key=`${cell.table}:${cell.row}:${cell.column}`;
   if(seenCells.has(key)||cell.table>=next.tables.length)return invalid();
   seenCells.add(key);
   const targetTable=next.tables[cell.table];
   if(cell.row>=targetTable.rows.length||cell.column>=targetTable.rows[cell.row].length)return invalid();
   if(cell.text===targetTable.rows[cell.row][cell.column])return invalid();
   targetTable.rows[cell.row][cell.column]=cell.text;
   changedCells.push({table:cell.table,row:cell.row,column:cell.column});
  }
  const titleChanged=operation.title!==undefined&&operation.title!==next.title;
  if(operation.title!==undefined){if(!titleChanged)return invalid();next.title=operation.title;}
  if(changedPages.length===0&&changedCells.length===0&&!titleChanged)return invalid();

  const strings=[...next.pages.map(page=>page.text),...next.tables.flatMap(table=>table.rows.flat())];
  let replacementCharacters=0;
  for(const value of strings)for(const character of value)if(character==='\ufffd')replacementCharacters++;
  const cells=next.tables.reduce((sum,table)=>sum+table.rows.reduce((total,row)=>total+row.length,0),0);
  next.report.textCharacters=strings.reduce((sum,value)=>sum+value.length,0);
  next.report.replacementCharacters=replacementCharacters;
  next.report.cells=cells;

  const flags=new Set(next.flags);
  flags.add('PAGE_REVIEW_REQUIRED');
  next.flags=[...flags];
  if(!next.report.warnings.some(warning=>warning.code==='PAGE_REVIEW_REQUIRED'&&warning.severity==='REVIEW'&&warning.disposition==='UNRESOLVED')){
   next.report.warnings.push({code:'PAGE_REVIEW_REQUIRED',severity:'REVIEW',location:null,count:1,disposition:'UNRESOLVED'});
  }

  const extraction=validateLocatedExtraction(source,next);
  return {extraction,edit:{reason:operation.reason,changedPages,changedCells,titleChanged}};
 }catch{
  return invalid();
 }
}
