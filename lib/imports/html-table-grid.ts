import {IMPORT_LIMITS} from './types';

export interface HtmlGridCell {value:string;colspan:string|undefined;rowspan:string|undefined}
export interface HtmlGridRow {group:object|null;cells:HtmlGridCell[]}
/** Preserve each source value once; covered slots are empty, never copied amounts. */
export function expandHtmlTableGrid(rows:HtmlGridRow[]):string[][]|null{
 const grid:(string|undefined)[][]=rows.map(()=>[]);let count=0;
 const span=(raw:string|undefined,max:number):number|null=>{
  if(raw===undefined)return 1;const value=raw.trim();if(!/^[1-9]\d{0,4}$/u.test(value))return null;
  const number=Number(value);return number<=max?number:null;
 };
 for(const [rowIndex,row]of rows.entries()){
  if(!row.cells.length)return null;let column=0;
  for(const cell of row.cells){
   while(grid[rowIndex][column]!==undefined)column++;
   const width=span(cell.colspan,IMPORT_LIMITS.columns),height=span(cell.rowspan,IMPORT_LIMITS.rows);
   if(width===null||height===null||column+width>IMPORT_LIMITS.columns||rowIndex+height>rows.length)return null;
   if(rows.slice(rowIndex,rowIndex+height).some(r=>r.group!==row.group))return null;
   for(let r=rowIndex;r<rowIndex+height;r++)for(let c=column;c<column+width;c++){
    if(grid[r][c]!==undefined)return null;
    count++;if(count>IMPORT_LIMITS.cells)throw new Error('IMPORT_PARSE_INVALID');
    grid[r][c]=r===rowIndex&&c===column?cell.value:'';
   }
   column+=width;
  }
 }
 const width=Math.max(0,...grid.map(row=>row.length));
 if(!width||grid.some(row=>Array.from({length:row.length},(_,c)=>row[c]).some(cell=>cell===undefined)))return null;
 // HTML layout leaves trailing slots empty; retain them as blanks, never move a source value.
 for(const row of grid)while(row.length<width){if(++count>IMPORT_LIMITS.cells)throw new Error('IMPORT_PARSE_INVALID');row.push('');}
 return grid as string[][];
}
