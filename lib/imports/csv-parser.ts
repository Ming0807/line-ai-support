import {IMPORT_LIMITS,extractionSchema,type Extraction,type ImportSource,type LocatedExtraction,type SourceLocation} from './types';
import {verifyImportSource} from './source';
import {validateLocatedExtraction} from './extraction';
const invalid=():never=>{throw new Error('IMPORT_PARSE_INVALID');};
/** Strict CSV grammar; exact strings remain data, never evaluated spreadsheet expressions. */
export function parseCsvSource(source:ImportSource):LocatedExtraction{
 try{
  const verified=verifyImportSource(source);if(verified.format!=='CSV')return invalid();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(verified.bytes);
  if(text.length>IMPORT_LIMITS.characters)return invalid();
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false,cells=0;
  const append=(value:string)=>{if(cell.length+value.length>IMPORT_LIMITS.cellCharacters)return invalid();cell+=value;};
  const finishCell=()=>{
   if(++cells>IMPORT_LIMITS.cells||row.length>=IMPORT_LIMITS.columns)return invalid();
   row.push(cell);cell='';closed=false;
  };
  const finishRow=()=>{finishCell();if(rows.length>=IMPORT_LIMITS.rows)return invalid();rows.push(row);row=[];};
  for(let index=0;index<text.length;index++){
   const character=text[index];
   if(quoted){
    if(character==='"'){
     if(text[index+1]==='"'){append('"');index++;}else{quoted=false;closed=true;}
    }else append(character);
    continue;
   }
   if(character===','){finishCell();continue;}
   if(character==='\n'||character==='\r'){
    finishRow();if(character==='\r'&&text[index+1]==='\n')index++;continue;
   }
   if(closed)return invalid();
   if(character==='"'){if(cell.length)return invalid();quoted=true;}else append(character);
  }
  if(quoted)return invalid();
  if(cell.length||row.length||closed)finishRow();
  if(!rows.length)return invalid();
  const flags:Extraction['flags']=[];
  if(!rows.some(value=>value.some(item=>item.trim())))flags.push('LOW_TEXT_QUALITY');
  if(rows.some(value=>value.length!==rows[0].length))flags.push('TABLE_SHAPE_REVIEW');
  if(rows.some(value=>value.some(item=>/^[\s\u0000-\u001f]*[=+@-]/.test(item))))flags.push('FORMULAS_PRESENT');
  const output=extractionSchema.safeParse({title:verified.filename.replace(/\.csv$/i,''),pages:[{pageNumber:null,text:'',sectionTitle:null,requiresReview:flags.length>0}],
   tables:[{pageNumber:null,sectionTitle:null,sheetName:null,firstRow:1,rows}],flags});
  if(!output.success)return invalid();
  const location:SourceLocation={kind:'CSV',rowStart:1,rowEnd:rows.length,columnStart:1,columnEnd:Math.max(...rows.map(value=>value.length)),tableIndex:1};
  const textCharacters=rows.reduce((sum,value)=>sum+value.reduce((total,item)=>total+item.length,0),0);
  let replacementCharacters=0;for(const value of rows)for(const item of value)for(const character of item)if(character==='\ufffd')replacementCharacters++;
  return validateLocatedExtraction(verified,{...output.data,locations:{pages:[{...location,tableIndex:null}],tables:[location]},
   report:{schemaVersion:1,parser:{name:'yru-csv',version:'1'},inputBytes:verified.bytes.length,pages:1,tables:1,cells,textCharacters,replacementCharacters,truncated:false,
    warnings:flags.map(code=>({code,severity:'REVIEW',location,count:1,disposition:'UNRESOLVED'}))}});
 }catch{return invalid();}
}
