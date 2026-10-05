import {xmlAttribute,xmlChildren,type SafeXmlElement} from './safe-xml';
import {readOfficePackage} from './office-package';
import {validateLocatedExtraction} from './extraction';
import {verifyImportSource} from './source';
import {IMPORT_LIMITS,extractionSchema,type Extraction,type ExtractionWarning,type ImportSource,type LocatedExtraction,type SourceLocation} from './types';

const TRANSITIONAL_WORD_NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT_WORD_NS='http://purl.oclc.org/ooxml/wordprocessingml/main';
const PARSER_NAME='yru-docx';
const PARSER_VERSION='1';
const invalid=():never=>{throw new Error('IMPORT_PARSE_INVALID');};
type WarningCode=Extraction['flags'][number];
type WarningState={code:WarningCode;severity:ExtractionWarning['severity'];location:SourceLocation|null;count:number;disposition:'UNRESOLVED'};
type Heading={level:number;text:string};
type StyleInfo={headingLevels:Map<string,number>;hiddenStyles:Set<string>;defaultHidden:boolean};

function isWord(element:SafeXmlElement,namespace:string,local:string):boolean{return element.uri===namespace&&element.local===local;}
function children(element:SafeXmlElement,local:string,namespace:string):SafeXmlElement[]{return xmlChildren(element,local,namespace);}
function descendants(element:SafeXmlElement,namespace:string,local:string):SafeXmlElement[]{
 const found:SafeXmlElement[]=[],pending=[...element.children].reverse();
 while(pending.length){const item=pending.pop();if(!item||typeof item==='string')continue;if(isWord(item,namespace,local))found.push(item);for(let index=item.children.length-1;index>=0;index--){const child=item.children[index];if(typeof child!=='string')pending.push(child);}}
 return found;
}
function valueOn(element:SafeXmlElement,namespace:string):boolean{
 const value=xmlAttribute(element,'val',namespace);return value===null||!['0','false','off','none'].includes(value.trim().toLowerCase());
}
function hasNonWhitespaceText(element:SafeXmlElement):boolean{return element.children.some(child=>typeof child==='string'&&child.trim().length>0);}
function directOutlineLevel(properties:SafeXmlElement|undefined,namespace:string):number|null{
 if(!properties)return null;const outline=children(properties,'outlineLvl',namespace)[0];if(!outline)return null;
 const value=xmlAttribute(outline,'val',namespace);if(value===null||!/^\d$/.test(value))return null;
 const level=Number(value)+1;return level>=1&&level<=9?level:null;
}
function loadStyles(mainPath:string,namespace:string,parts:ReadonlyMap<string,SafeXmlElement>,relationships:(path:string)=>readonly {type:string;target:string|null;external:boolean}[]):StyleInfo{
 const headingLevels=new Map<string,number>(),hiddenStyles=new Set<string>();
 const styleRelations=relationships(mainPath).filter(item=>item.type.endsWith('/styles'));
 if(styleRelations.length>1)return invalid();
 const relation=styleRelations[0];
 if(!relation||relation.external)return {headingLevels,hiddenStyles,defaultHidden:false};
 const root=relation.target?parts.get(relation.target):undefined;
 if(!root||!isWord(root,namespace,'styles'))return invalid();
 const styles=new Map<string,SafeXmlElement>();
 for(const style of children(root,'style',namespace)){
  const id=xmlAttribute(style,'styleId',namespace);if(!id||styles.has(id))return invalid();styles.set(id,style);
 }
 const resolve=(id:string,seen=new Set<string>()):number|null=>{
  if(seen.has(id)||seen.size>=32)return null;seen.add(id);const style=styles.get(id);if(!style)return null;
  const styleId=xmlAttribute(style,'styleId',namespace)??'';
  const namedLevel=/^heading\s*([1-9])$/i.exec(styleId)?.[1];if(namedLevel)return Number(namedLevel);
  const name=children(style,'name',namespace)[0];const label=xmlAttribute(name??style,'val',namespace)??'';
  const namedLabel=/^heading\s*([1-9])$/i.exec(label)?.[1];if(namedLabel)return Number(namedLabel);
  const level=directOutlineLevel(children(style,'pPr',namespace)[0],namespace);if(level!==null)return level;
  const base=children(style,'basedOn',namespace)[0],parent=base?xmlAttribute(base,'val',namespace):null;
  return parent?resolve(parent,seen):null;
 };
 for(const id of styles.keys()){
  const style=styles.get(id)!;
  if(xmlAttribute(style,'type',namespace)==='paragraph'){const level=resolve(id);if(level!==null)headingLevels.set(id,level);}
 }
 const hiddenState=(id:string,seen=new Set<string>()):{vanish:boolean|null;webHidden:boolean|null}=>{
  if(seen.has(id)||seen.size>=32)return {vanish:null,webHidden:null};seen.add(id);const style=styles.get(id);if(!style)return {vanish:null,webHidden:null};
  const properties=children(style,'rPr',namespace)[0],parent=children(style,'basedOn',namespace)[0],parentId=parent?xmlAttribute(parent,'val',namespace):null;
  const inherited=parentId?hiddenState(parentId,seen):{vanish:null,webHidden:null};
  const state=(name:'vanish'|'webHidden'):boolean|null=>{const item=properties?children(properties,name,namespace)[0]:undefined;return item?valueOn(item,namespace):inherited[name];};
  return {vanish:state('vanish'),webHidden:state('webHidden')};
 };
 for(const id of styles.keys()){const state=hiddenState(id);if(state.vanish===true||state.webHidden===true)hiddenStyles.add(id);}
 const defaults=children(root,'docDefaults',namespace);if(defaults.length>1)return invalid();
 const runDefaults=defaults[0]?children(defaults[0],'rPrDefault',namespace):[],runProperties=runDefaults[0]?children(runDefaults[0],'rPr',namespace):[];
 if(runDefaults.length>1||runProperties.length>1)return invalid();
 const defaultHidden=runProperties[0]?['vanish','webHidden'].some(name=>children(runProperties[0],name,namespace).some(item=>valueOn(item,namespace))):false;
 return {headingLevels,hiddenStyles,defaultHidden};
}
function headingLevel(paragraph:SafeXmlElement,namespace:string,styleLevels:ReadonlyMap<string,number>):number|null{
 const properties=children(paragraph,'pPr',namespace)[0],direct=directOutlineLevel(properties,namespace);if(direct!==null)return direct;
 const style=properties?children(properties,'pStyle',namespace)[0]:undefined,id=style?xmlAttribute(style,'val',namespace):null;
 if(!id)return null;const builtIn=/^heading\s*([1-9])$/i.exec(id)?.[1];return builtIn?Number(builtIn):styleLevels.get(id)??null;
}

/** Extracts visible main-story DOCX blocks as inert text; it never evaluates fields or follows resources. */
export async function parseDocxSource(source:ImportSource,signal?:AbortSignal):Promise<LocatedExtraction>{
 try{
  const verified=verifyImportSource(source);if(verified.format!=='DOCX'||signal?.aborted)return invalid();
  const office=await readOfficePackage(verified,signal);if(signal?.aborted)return invalid();
  const namespace=office.main.uri;if(namespace!==TRANSITIONAL_WORD_NS&&namespace!==STRICT_WORD_NS||!isWord(office.main,namespace,'document'))return invalid();
  const body=children(office.main,'body',namespace);if(body.length!==1)return invalid();
  if(hasNonWhitespaceText(office.main))return invalid();
  const {headingLevels:styleLevels,hiddenStyles,defaultHidden}=loadStyles(office.mainPath,namespace,office.parts,office.relationships);
  const pages:Extraction['pages']=[],tables:Extraction['tables']=[],pageLocations:SourceLocation[]=[],tableLocations:SourceLocation[]=[];
  const flags=new Set<WarningCode>(),warnings=new Map<WarningCode,WarningState>();let blockIndex=0,cells=0,outputCharacters=0;
  const nextBlock=():number=>{if(++blockIndex>100_000)return invalid();return blockIndex;};
  const location=(start:number,end:number,headingPath:string[],tableIndex:number|null):SourceLocation=>({kind:'DOCX',blockStart:start,blockEnd:end,headingPath:[...headingPath],tableIndex});
  const warn=(code:WarningCode,severity:ExtractionWarning['severity'],where:SourceLocation|null,count=1):void=>{
   flags.add(code);const current=warnings.get(code);if(!current){warnings.set(code,{code,severity,location:where,count,disposition:'UNRESOLVED'});return;}
   current.count=Math.min(IMPORT_LIMITS.characters,current.count+count);
   const currentBlock=current.location?.kind==='DOCX'?current.location.blockStart:null;
   const nextBlockValue=where?.kind==='DOCX'?where.blockStart:null;
   if(currentBlock!==nextBlockValue)current.location=null;
  };
  const appendOutput=(value:string):void=>{outputCharacters+=value.length;if(outputCharacters>IMPORT_LIMITS.characters)return invalid();};
  const paragraphHasField=(paragraph:SafeXmlElement):boolean=>['fldSimple','fldChar','instrText'].some(name=>descendants(paragraph,namespace,name).length>0);
  const paragraphHasRevisionRange=(paragraph:SafeXmlElement):boolean=>['moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd',
   'customXmlInsRangeStart','customXmlInsRangeEnd','customXmlDelRangeStart','customXmlDelRangeEnd'].some(name=>descendants(paragraph,namespace,name).length>0);
  const collectParagraph=(paragraph:SafeXmlElement,where:SourceLocation):string=>{
   if(hasNonWhitespaceText(paragraph))return invalid();
   if(paragraphHasField(paragraph)||paragraphHasRevisionRange(paragraph)||defaultHidden){warn('HIDDEN_DATA_REVIEW','BLOCKING',where);return '';}
   const paragraphProperties=children(paragraph,'pPr',namespace)[0];
   const paragraphRunProperties=paragraphProperties?children(paragraphProperties,'rPr',namespace)[0]:undefined;
   const paragraphStyle=paragraphProperties?children(paragraphProperties,'pStyle',namespace)[0]:undefined;
   const paragraphStyleId=paragraphStyle?xmlAttribute(paragraphStyle,'val',namespace):null;
   if(paragraphRunProperties&&['vanish','webHidden'].some(name=>children(paragraphRunProperties,name,namespace).some(item=>valueOn(item,namespace)))||
    paragraphStyleId!==null&&hiddenStyles.has(paragraphStyleId)){warn('HIDDEN_DATA_REVIEW','BLOCKING',where);return '';}
   const parts:string[]=[];let length=0;
   const add=(value:string)=>{length+=value.length;if(length>IMPORT_LIMITS.characters)return invalid();parts.push(value);};
   const visit=(node:SafeXmlElement):void=>{
    if(node.uri!==namespace){warn('HIDDEN_DATA_REVIEW','BLOCKING',where);return;}
    if(node.local==='t'){if(node.children.some(child=>typeof child!=='string'))return invalid();for(const child of node.children)if(typeof child==='string')add(child);return;}
    if(node.local==='tab'){add('\t');return;}
    if(node.local==='br'||node.local==='cr'){
     if(node.local==='br'&&xmlAttribute(node,'type',namespace)&&xmlAttribute(node,'type',namespace)!=='textWrapping')warn('PAGE_REVIEW_REQUIRED','REVIEW',where);
     add('\n');return;
    }
    if(node.local==='noBreakHyphen'){add('\u2011');return;}
    if(node.local==='softHyphen'){add('\u00ad');return;}
    if(['drawing','pict','object','control'].includes(node.local)){warn('OCR_REQUIRED','BLOCKING',where);return;}
    if(['ins','del','moveFrom','moveTo','delText','altChunk','sdt','customXml','txbxContent'].includes(node.local)){
     warn('HIDDEN_DATA_REVIEW','BLOCKING',where);return;
    }
    if(node.local==='r'){
     if(hasNonWhitespaceText(node))return invalid();
     const properties=children(node,'rPr',namespace)[0];
     const style=properties?children(properties,'rStyle',namespace)[0]:undefined,styleId=style?xmlAttribute(style,'val',namespace):null;
     if(properties&&['vanish','webHidden'].some(name=>children(properties,name,namespace).some(item=>valueOn(item,namespace)))||
      styleId!==null&&hiddenStyles.has(styleId)){warn('HIDDEN_DATA_REVIEW','BLOCKING',where);return;}
    }
    if(['bookmarkStart','bookmarkEnd','proofErr','commentRangeStart','commentRangeEnd','commentReference','footnoteReference','endnoteReference','lastRenderedPageBreak',
     'moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd','customXmlInsRangeStart','customXmlInsRangeEnd','customXmlDelRangeStart','customXmlDelRangeEnd'].includes(node.local)){
     if(['commentReference','footnoteReference','endnoteReference','moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd',
      'customXmlInsRangeStart','customXmlInsRangeEnd','customXmlDelRangeStart','customXmlDelRangeEnd'].includes(node.local))warn(node.local==='lastRenderedPageBreak'?'PAGE_REVIEW_REQUIRED':'HIDDEN_DATA_REVIEW',node.local==='lastRenderedPageBreak'?'REVIEW':'BLOCKING',where);return;
    }
    for(const child of node.children)if(typeof child!=='string')visit(child);
   };
   for(const child of paragraph.children)if(typeof child!=='string')visit(child);
   const text=parts.join('');appendOutput(text);return text;
  };
  const headingStack:Heading[]=[];let title:string|null=null;
  if(hasNonWhitespaceText(body[0]))return invalid();
  for(const child of body[0].children){
   if(signal?.aborted)return invalid();if(typeof child==='string'){if(child.trim())return invalid();continue;}
   if(isWord(child,namespace,'sectPr'))continue;
   if(child.uri!==namespace){const block=nextBlock();warn('HIDDEN_DATA_REVIEW','BLOCKING',location(block,block,headingStack.map(item=>item.text),null));continue;}
   if(['bookmarkStart','bookmarkEnd','proofErr','commentRangeStart','commentRangeEnd'].includes(child.local))continue;
   const block=nextBlock();
   if(isWord(child,namespace,'p')){
    const preliminaryPath=headingStack.map(item=>item.text),where=location(block,block,preliminaryPath,null);
    const text=collectParagraph(child,where),level=headingLevel(child,namespace,styleLevels);
    if(level!==null&&text.trim()){
     while(headingStack.length&&headingStack.at(-1)!.level>=level)headingStack.pop();
     headingStack.push({level,text:text.slice(0,200)});
    }
    const headingPath=headingStack.map(item=>item.text),located=location(block,block,headingPath,null);
    if(title===null&&level!==null&&text.trim())title=text.slice(0,500);
    if(pages.length>=IMPORT_LIMITS.pages)return invalid();
    pages.push({pageNumber:null,text,sectionTitle:headingPath.at(-1)??null,requiresReview:false});pageLocations.push(located);
    continue;
   }
   if(isWord(child,namespace,'tbl')){
    if(tables.length>=IMPORT_LIMITS.tables||pages.length>=IMPORT_LIMITS.pages)return invalid();
    const tableIndex=tables.length+1,headingPath=headingStack.map(item=>item.text),where=location(block,block,headingPath,tableIndex);
    if(hasNonWhitespaceText(child))return invalid();
    if(child.children.some(item=>typeof item!=='string'&&(item.uri!==namespace||!['tblPr','tblGrid','tr'].includes(item.local))))warn('UNSUPPORTED_TABLES','BLOCKING',where);
    const rows:string[][]=[];let minWidth=Number.POSITIVE_INFINITY,maxWidth=0;
    for(const row of children(child,'tr',namespace)){
     if(signal?.aborted||rows.length>=IMPORT_LIMITS.rows)return invalid();
     if(hasNonWhitespaceText(row))return invalid();
     if(children(row,'trPr',namespace).some(properties=>children(properties,'hidden',namespace).some(value=>valueOn(value,namespace)))||
      ['ins','del','moveFrom','moveTo','rowIns','rowDel','cellIns','cellDel'].some(name=>descendants(row,namespace,name).length>0)){warn('HIDDEN_DATA_REVIEW','BLOCKING',where);continue;}
     if(row.children.some(item=>typeof item!=='string'&&(item.uri!==namespace||!['trPr','tc'].includes(item.local))))warn('UNSUPPORTED_TABLES','BLOCKING',where);
     const rowProperties=children(row,'trPr',namespace)[0];
     if(rowProperties&&['gridBefore','gridAfter'].some(name=>children(rowProperties,name,namespace).some(item=>Number(xmlAttribute(item,'val',namespace)??'0')>0)))warn('TABLE_SHAPE_REVIEW','REVIEW',where);
     const rowCells=children(row,'tc',namespace);if(rowCells.length>IMPORT_LIMITS.columns)return invalid();
     if(!rowCells.length){rows.push(['']);cells++;if(cells>IMPORT_LIMITS.cells)return invalid();minWidth=Math.min(minWidth,1);maxWidth=Math.max(maxWidth,1);warn('TABLE_SHAPE_REVIEW','REVIEW',where);continue;}
     const values:string[]=[];
     for(const cell of rowCells){
      if(hasNonWhitespaceText(cell))return invalid();
      cells++;if(cells>IMPORT_LIMITS.cells)return invalid();
      const properties=children(cell,'tcPr',namespace)[0];
      if(properties&&['gridSpan','vMerge','hMerge','cellMerge'].some(name=>children(properties,name,namespace).length>0))warn('TABLE_SHAPE_REVIEW','REVIEW',where);
      if(children(cell,'tbl',namespace).length){warn('UNSUPPORTED_TABLES','BLOCKING',where);}
     if(['cellIns','cellDel','cellMerge'].some(name=>descendants(cell,namespace,name).length>0))warn('HIDDEN_DATA_REVIEW','BLOCKING',where);
     const paragraphs=children(cell,'p',namespace),cellParts=paragraphs.map(paragraph=>collectParagraph(paragraph,where));
      if(cell.children.some(item=>typeof item!=='string'&&(item.uri!==namespace||!['p','tbl','tcPr'].includes(item.local))))warn('UNSUPPORTED_TABLES','BLOCKING',where);
      const value=cellParts.join('\n');if(value.length>IMPORT_LIMITS.cellCharacters)return invalid();values.push(value);
     }
     rows.push(values);minWidth=Math.min(minWidth,values.length);maxWidth=Math.max(maxWidth,values.length);
    }
    if(!rows.length){rows.push(['']);cells++;if(cells>IMPORT_LIMITS.cells)return invalid();minWidth=1;maxWidth=1;warn('TABLE_SHAPE_REVIEW','REVIEW',where);}
    if(minWidth!==maxWidth)warn('TABLE_SHAPE_REVIEW','REVIEW',where);
    const rowText=rows.flat().reduce((sum,value)=>sum+value.length,0);if(rowText>IMPORT_LIMITS.characters)return invalid();
    // Table cell text is counted once here; collectParagraph also accounts paragraph text.
    tables.push({pageNumber:null,sectionTitle:headingPath.at(-1)??null,sheetName:null,firstRow:1,rows});
    pages.push({pageNumber:null,text:'',sectionTitle:headingPath.at(-1)??null,requiresReview:false});pageLocations.push(where);tableLocations.push(where);
    continue;
   }
   if(isWord(child,namespace,'sdt')||isWord(child,namespace,'customXml')||isWord(child,namespace,'altChunk')||['ins','del','moveFrom','moveTo'].includes(child.local)){
    warn('HIDDEN_DATA_REVIEW','BLOCKING',location(block,block,headingStack.map(item=>item.text),null));continue;
   }
   if(['moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd','customXmlInsRangeStart','customXmlInsRangeEnd','customXmlDelRangeStart','customXmlDelRangeEnd'].includes(child.local)){
    warn('HIDDEN_DATA_REVIEW','BLOCKING',location(block,block,headingStack.map(item=>item.text),null));continue;
   }
   warn('HIDDEN_DATA_REVIEW','BLOCKING',location(block,block,headingStack.map(item=>item.text),null));
  }
  const unprocessedStoryCount=office.relationships(office.mainPath).filter(item=>!item.external&&/(?:\/header|\/footer|\/footnotes|\/endnotes|\/comments)$/.test(item.type)).length;
  if(unprocessedStoryCount)warn('HIDDEN_DATA_REVIEW','BLOCKING',null,unprocessedStoryCount);
  if(office.hasExternalLinks)warn('EXTERNAL_LINKS_REVIEW','REVIEW',null);
  if(!pages.length){
   if(!blockIndex)return invalid();
   const fallback=location(blockIndex,blockIndex,[],null);pages.push({pageNumber:null,text:'',sectionTitle:null,requiresReview:false});pageLocations.push(fallback);
  }
  const extractedText=[...pages.map(page=>page.text),...tables.flatMap(table=>table.rows.flat())];
  const hasContent=extractedText.some(value=>value.trim());
  let replacementCharacters=0,replacementLocation:SourceLocation|null=null;
  const countReplacements=(value:string,where:SourceLocation):void=>{for(const character of value)if(character==='\ufffd'){replacementCharacters++;replacementLocation??=where;}};
  pages.forEach((page,index)=>countReplacements(page.text,pageLocations[index]));
  tables.forEach((table,index)=>table.rows.flat().forEach(value=>countReplacements(value,tableLocations[index]!)));
  if(replacementCharacters)warn('LOW_TEXT_QUALITY','REVIEW',replacementLocation,replacementCharacters);
  if(!hasContent)warn('LOW_TEXT_QUALITY','REVIEW',pageLocations[0]);
  for(const page of pages)page.requiresReview=flags.size>0;
  const output=extractionSchema.safeParse({title,pages,tables,flags:[...flags]});if(!output.success)return invalid();
  let textCharacters=0;for(const value of extractedText)textCharacters+=value.length;
  const report:LocatedExtraction['report']={schemaVersion:1,parser:{name:PARSER_NAME,version:PARSER_VERSION},inputBytes:verified.bytes.length,pages:pages.length,
   tables:tables.length,cells,textCharacters,replacementCharacters,truncated:false,warnings:[...warnings.values()]};
  return validateLocatedExtraction(verified,{...output.data,locations:{pages:pageLocations,tables:tableLocations},report});
 }catch{return invalid();}
}
