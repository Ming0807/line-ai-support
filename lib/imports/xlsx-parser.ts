import {readOfficePackage,type OfficeRelationship} from './office-package';
import {xmlAttribute,xmlChildren,xmlText,type SafeXmlElement} from './safe-xml';
import {verifyImportSource} from './source';
import {validateLocatedExtraction} from './extraction';
import {IMPORT_LIMITS,type ExtractionWarning,type ImportSource,type LocatedExtraction,type SourceLocation} from './types';
const SHEET_NAMESPACES=['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main'];
const REL_NAMESPACES=['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships'];
const invalid=():never=>{throw new Error('IMPORT_PARSE_INVALID');};
const children=(node:SafeXmlElement)=>node.children.filter((child):child is SafeXmlElement=>typeof child!=='string');
function container(node:SafeXmlElement):SafeXmlElement[]{
 if(node.children.some(child=>typeof child==='string'&&child.trim()))return invalid();return children(node);
}
function integer(value:string|null,min:number,max:number):number{
 if(value===null||!/^(?:0|[1-9]\d{0,7})$/.test(value))return invalid();const number=Number(value);if(number<min||number>max)return invalid();return number;
}
function hidden(node:SafeXmlElement):boolean{const value=xmlAttribute(node,'hidden');if(value!==null&&!['0','1','false','true'].includes(value))return invalid();return value==='1'||value==='true';}
function relationship(relations:readonly OfficeRelationship[],kind:string):OfficeRelationship|null{
 const matches=relations.filter(relation=>REL_NAMESPACES.some(namespace=>relation.type===`${namespace}/${kind}`));
 if(matches.length>1)return invalid();if(matches[0]&&(matches[0].external||!matches[0].target))return invalid();return matches[0]??null;
}
function coordinate(value:string|null):{row:number;column:number}{
 const match=/^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value??'');if(!match)return invalid();
 let column=0;for(const letter of match[1])column=column*26+letter.charCodeAt(0)-64;
 const row=Number(match[2]);if(row>1_048_576||column>16_384)return invalid();return {row,column};
}
/** Exact stored cell strings and proved coordinates. No formula/locale/date-format evaluation. */
export async function parseXlsxSource(source:ImportSource,signal?:AbortSignal):Promise<LocatedExtraction>{
 try{
  const verified=verifyImportSource(source);if(verified.format!=='XLSX')return invalid();
  const pkg=await readOfficePackage(verified,signal),namespace=pkg.main.uri;
  if(pkg.main.local!=='workbook'||!SHEET_NAMESPACES.includes(namespace))return invalid();
  const pages:LocatedExtraction['pages']=[],tables:LocatedExtraction['tables']=[],pageLocations:SourceLocation[]=[],tableLocations:SourceLocation[]=[];
  const warnings=new Map<string,ExtractionWarning>();let cells=0,textCharacters=0;
  const warn=(code:LocatedExtraction['flags'][number],location:SourceLocation|null=null,count=1)=>{
   const key=`${code}:${location?.kind==='XLSX'?location.sheetIndex:0}`,existing=warnings.get(key);
   if(existing){existing.count+=count;if(existing.count>IMPORT_LIMITS.characters)return invalid();}
   else{if(warnings.size>=1000)return invalid();warnings.set(key,{code,severity:'BLOCKING',location,count,disposition:'UNRESOLVED'});}
  };
  const relations=pkg.relationships(pkg.mainPath),used=new Set<string>([pkg.mainPath]);
  const sharedRelation=relationship(relations,'sharedStrings'),styleRelation=relationship(relations,'styles');
  const rich=(node:SafeXmlElement):string=>{
   const output:string[]=[];
   const visit=(current:SafeXmlElement)=>{
    for(const child of container(current)){
     if(child.uri!==namespace){warn('PAGE_REVIEW_REQUIRED');continue;}
     if(child.local==='t'){if(children(child).length)return invalid();output.push(xmlText(child));}
     else if(child.local==='r')visit(child);
     else if(child.local==='rPr')continue;
     else if(child.local==='rPh'||child.local==='phoneticPr')warn('HIDDEN_DATA_REVIEW');
     else warn('PAGE_REVIEW_REQUIRED');
    }
   };visit(node);const text=output.join('');if(text.length>IMPORT_LIMITS.cellCharacters)return invalid();return text;
  };
  const strings:string[]=[];
  if(sharedRelation?.target){
   used.add(sharedRelation.target);const root=pkg.parts.get(sharedRelation.target);if(!root||root.local!=='sst'||root.uri!==namespace)return invalid();
   for(const item of container(root)){if(item.local!=='si'||item.uri!==namespace)return invalid();if(strings.length>=IMPORT_LIMITS.cells)return invalid();strings.push(rich(item));}
  }
  const numberFormats:number[]=[];
  if(styleRelation?.target){
   used.add(styleRelation.target);const root=pkg.parts.get(styleRelation.target);if(!root||root.local!=='styleSheet'||root.uri!==namespace)return invalid();
   const groups=xmlChildren(root,'cellXfs',namespace);if(groups.length!==1)return invalid();
   const bases=xmlChildren(root,'cellStyleXfs',namespace);if(bases.length>1)return invalid();
   const baseFormats:number[]=[];
   if(bases.length)for(const xf of container(bases[0])){
    if(xf.local!=='xf'||xf.uri!==namespace||baseFormats.length>=10000)return invalid();
    baseFormats.push(xmlAttribute(xf,'numFmtId')===null?0:integer(xmlAttribute(xf,'numFmtId'),0,65535));
   }
   for(const xf of container(groups[0])){
    if(xf.local!=='xf'||xf.uri!==namespace||numberFormats.length>=10000)return invalid();
    const direct=xmlAttribute(xf,'numFmtId')===null?0:integer(xmlAttribute(xf,'numFmtId'),0,65535),apply=xmlAttribute(xf,'applyNumberFormat');
    if(apply!==null&&!['0','1','false','true'].includes(apply))return invalid();
    const baseId=xmlAttribute(xf,'xfId')===null?null:integer(xmlAttribute(xf,'xfId'),0,9999);
    if(baseId!==null&&baseId>=baseFormats.length)return invalid();
    // Preserve the stored string; inherited number formatting is review evidence, never a conversion.
    const inherited=baseId!==null&&apply!=='1'&&apply!=='true'?baseFormats[baseId]:0;
    numberFormats.push(direct||inherited);
   }
   if(!numberFormats.length)return invalid();
  }
  const sheetGroups=xmlChildren(pkg.main,'sheets',namespace);if(sheetGroups.length!==1)return invalid();
  const sheets=container(sheetGroups[0]);if(!sheets.length||sheets.length>IMPORT_LIMITS.pages)return invalid();
  const names=new Set<string>(),sheetIds=new Set<number>(),targets=new Set<string>();
  for(const [sheetIndex,sheet] of sheets.entries()){
   if(signal?.aborted||sheet.local!=='sheet'||sheet.uri!==namespace||container(sheet).length)return invalid();
   const sheetName=xmlAttribute(sheet,'name'),sheetId=integer(xmlAttribute(sheet,'sheetId'),1,1_048_576),state=xmlAttribute(sheet,'state');
   if(!sheetName||sheetName.length>100||/[\x00-\x1f\x7f]/.test(sheetName)||names.has(sheetName.toLowerCase())||sheetIds.has(sheetId)||state!==null&&!['visible','hidden','veryHidden'].includes(state))return invalid();
   names.add(sheetName.toLowerCase());sheetIds.add(sheetId);
   const ids=sheet.attributes.filter(attribute=>attribute.local==='id'&&REL_NAMESPACES.includes(attribute.uri));if(ids.length!==1)return invalid();
   const relation=relations.find(item=>item.id===ids[0].value);
   if(!relation||relation.external||!relation.target||!REL_NAMESPACES.some(base=>relation.type===`${base}/worksheet`)||targets.has(relation.target))return invalid();
   targets.add(relation.target);used.add(relation.target);
   const root=pkg.parts.get(relation.target);if(!root||root.local!=='worksheet'||root.uri!==namespace)return invalid();
   const data=xmlChildren(root,'sheetData',namespace);if(data.length!==1)return invalid();
   const rowMap=new Map<number,Map<number,string>>();let lastRow=0,rowStart=1,rowEnd=1,columnStart=1,columnEnd=1,hasCells=false;
   const pendingFlags:LocatedExtraction['flags'][number][]=[];
   if(state==='hidden'||state==='veryHidden')pendingFlags.push('HIDDEN_DATA_REVIEW');
   for(const row of container(data[0])){
    if(row.local!=='row'||row.uri!==namespace)return invalid();const rowIndex=integer(xmlAttribute(row,'r'),1,1_048_576);
    if(rowIndex<=lastRow||rowMap.size>=IMPORT_LIMITS.rows)return invalid();lastRow=rowIndex;
    if(!rowMap.size)rowStart=rowIndex;rowEnd=rowIndex;
    const values=new Map<number,string>();rowMap.set(rowIndex,values);if(hidden(row))pendingFlags.push('HIDDEN_DATA_REVIEW');let lastColumn=0;
    if(xmlAttribute(row,'s')!==null||xmlAttribute(row,'customFormat')==='1')pendingFlags.push('TABLE_SHAPE_REVIEW');
    for(const cell of container(row)){
     if(cell.local!=='c'||cell.uri!==namespace)return invalid();const at=coordinate(xmlAttribute(cell,'r'));
     if(at.row!==rowIndex||at.column<=lastColumn)return invalid();lastColumn=at.column;
     if(!hasCells){columnStart=columnEnd=at.column;hasCells=true;}else{columnStart=Math.min(columnStart,at.column);columnEnd=Math.max(columnEnd,at.column);}
     const type=xmlAttribute(cell,'t')??'n',v=xmlChildren(cell,'v',namespace),is=xmlChildren(cell,'is',namespace),f=xmlChildren(cell,'f',namespace);
     if(v.length>1||is.length>1||f.length>1||v.some(node=>children(node).length)||!['n','s','b','str','inlineStr','e','d'].includes(type))return invalid();
     if(f.length)pendingFlags.push('FORMULAS_PRESENT');
     const styleIndex=xmlAttribute(cell,'s')===null?0:integer(xmlAttribute(cell,'s'),0,9999);
     if(styleIndex>0&&!numberFormats.length||numberFormats.length&&styleIndex>=numberFormats.length)return invalid();
     if(numberFormats[styleIndex])pendingFlags.push('TABLE_SHAPE_REVIEW');
     let value=v.length?xmlText(v[0]):'';
     if(type==='inlineStr'){if(v.length||is.length!==1||f.length)return invalid();value=rich(is[0]);}
     else{
      if(is.length)return invalid();
      if(type==='s'){if(!v.length)return invalid();const index=integer(value,0,IMPORT_LIMITS.cells-1);if(index>=strings.length)return invalid();value=strings[index];}
      else if(type==='n'&&value&&!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value))return invalid();
      else if(type==='b'&&value&&!['0','1'].includes(value))return invalid();
      else if(type==='e')pendingFlags.push('LOW_TEXT_QUALITY');
      else if(type==='d')pendingFlags.push('TABLE_SHAPE_REVIEW');
     }
     if(container(cell).some(node=>node.uri!==namespace||!['v','is','f'].includes(node.local)))pendingFlags.push('PAGE_REVIEW_REQUIRED');
     if(value.length>IMPORT_LIMITS.cellCharacters)return invalid();values.set(at.column,value);
    }
   }
   const location:SourceLocation={kind:'XLSX',sheetName,sheetIndex:sheetIndex+1,rowStart,rowEnd,columnStart,columnEnd,tableIndex:null};
   for(const flag of pendingFlags)warn(flag,location);
   const allowed=new Set(['sheetData','dimension','sheetViews','sheetFormatPr','cols','sheetPr','printOptions','pageMargins','pageSetup','headerFooter']);
   for(const node of container(root)){
    if(node.uri===namespace&&node.local==='sheetFormatPr'&&['1','true'].includes(xmlAttribute(node,'zeroHeight')??''))warn('HIDDEN_DATA_REVIEW',location);
    if(node.local==='mergeCells')warn('UNSUPPORTED_TABLES',location);
    else if(node.uri!==namespace||!allowed.has(node.local))warn('PAGE_REVIEW_REQUIRED',location);
    if(node.local==='cols'&&node.uri===namespace)for(const column of container(node)){
     if(column.local!=='col'||column.uri!==namespace)return invalid();const min=integer(xmlAttribute(column,'min'),1,16384),max=integer(xmlAttribute(column,'max'),min,16384);
     if(max<min)return invalid();if(hidden(column))warn('HIDDEN_DATA_REVIEW',location);
     if(xmlAttribute(column,'style')!==null)warn('TABLE_SHAPE_REVIEW',location);
    }
   }
   if(hasCells){
    const height=rowEnd-rowStart+1,width=columnEnd-columnStart+1;
    if(height>IMPORT_LIMITS.rows||width>IMPORT_LIMITS.columns||cells+height*width>IMPORT_LIMITS.cells||tables.length>=IMPORT_LIMITS.tables)return invalid();
    const rows:string[][]=[];for(let row=rowStart;row<=rowEnd;row++){
     const values:string[]=[];for(let column=columnStart;column<=columnEnd;column++){
      const value=rowMap.get(row)?.get(column)??'';values.push(value);textCharacters+=value.length;if(textCharacters>IMPORT_LIMITS.characters)return invalid();
     }rows.push(values);
    }
    cells+=height*width;tables.push({pageNumber:null,sectionTitle:sheetName,sheetName,firstRow:rowStart,rows});tableLocations.push({...location,tableIndex:tables.length});
    if(!rows.some(row=>row.some(value=>value.trim())))warn('LOW_TEXT_QUALITY',location);
   }else warn('LOW_TEXT_QUALITY',location);
   pages.push({pageNumber:null,text:'',sectionTitle:sheetName,requiresReview:false});pageLocations.push(location);
  }
  if(pkg.hasExternalLinks)warn('EXTERNAL_LINKS_REVIEW');
  for(const node of container(pkg.main))if(node.uri!==namespace||!['sheets','fileVersion','workbookPr','bookViews','calcPr','fileSharing','workbookProtection'].includes(node.local))warn('PAGE_REVIEW_REQUIRED');
  for(const [path,node] of pkg.parts)if(!used.has(path)&&!path.endsWith('.rels')&&!['coreProperties','Properties','theme'].includes(node.local))warn('PAGE_REVIEW_REQUIRED');
  let replacementCharacters=0;for(const table of tables)for(const row of table.rows)for(const value of row)for(const character of value)if(character==='\ufffd')replacementCharacters++;
  if(replacementCharacters)warn('LOW_TEXT_QUALITY',null,replacementCharacters);
  const flags=[...new Set([...warnings.values()].map(warning=>warning.code))] as LocatedExtraction['flags'];
  for(const page of pages)page.requiresReview=flags.length>0;
  return validateLocatedExtraction(verified,{title:verified.filename.replace(/\.xlsx$/i,''),pages,tables,flags,locations:{pages:pageLocations,tables:tableLocations},
   report:{schemaVersion:1,parser:{name:'yru-xlsx',version:'1'},inputBytes:verified.bytes.length,pages:pages.length,tables:tables.length,cells,textCharacters,replacementCharacters,truncated:false,warnings:[...warnings.values()]}});
 }catch{return invalid();}
}
