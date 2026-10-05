import {ErrorCodes,parse} from 'parse5';
import type {DefaultTreeAdapterTypes} from 'parse5';
import {validateLocatedExtraction} from './extraction';
import {verifyImportSource} from './source';
import {IMPORT_LIMITS,extractionSchema,type Extraction,type ExtractionWarning,type ImportSource,type LocatedExtraction,type SourceLocation} from './types';

const invalid=():never=>{throw new Error('IMPORT_PARSE_INVALID');};
const PARSER_NAME='parse5';
const PARSER_VERSION='8.0.1'; // Keep aligned with the pinned package.json dependency.
const MAX_HTML_DEPTH=64;
const MAX_HTML_NODES=50_000;
const HTML_NAMESPACE='http://www.w3.org/1999/xhtml';
const skippedSubtrees=new Set(['script','style','template','iframe','object','embed','svg','math','noscript','img','picture','source','video','audio','track','canvas','applet','portal','input','button','select','textarea','link','base']);
const resourceAttributes=new Set(['src','srcset','data','poster','action','formaction','manifest','xlink:href']);
const structuralTags=new Set(['address','article','aside','blockquote','body','dd','div','dl','dt','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','header','li','main','nav','ol','p','pre','section','table','tbody','td','tfoot','th','thead','tr','ul']);
const leafBlockTags=new Set(['address','blockquote','dd','dt','h1','h2','h3','h4','h5','h6','li','p','pre']);
const containerBlockTags=new Set(['article','aside','body','div','footer','header','main','nav','section']);

type HtmlNode=DefaultTreeAdapterTypes.Node;
type HtmlElement=DefaultTreeAdapterTypes.Element|DefaultTreeAdapterTypes.Template;

function isElement(node:HtmlNode):node is HtmlElement{return 'tagName' in node;}
function isText(node:HtmlNode):node is DefaultTreeAdapterTypes.TextNode{return node.nodeName==='#text';}
function elementChildren(element:HtmlElement):readonly HtmlNode[]{return 'content' in element?element.content.childNodes:element.childNodes;}
function attribute(element:HtmlElement,name:string):string|undefined{return element.attrs.find(item=>item.name===name)?.value;}
function isHidden(element:HtmlElement):boolean{
 if(element.attrs.some(item=>item.name==='hidden'))return true;
 if(attribute(element,'aria-hidden')?.trim().toLowerCase()==='true')return true;
 if(element.tagName==='input'&&attribute(element,'type')?.trim().toLowerCase()==='hidden')return true;
 if((attribute(element,'class')??'').toLowerCase().split(/\s+/u).some(name=>['hidden','d-none','invisible','is-hidden'].includes(name)))return true;
 const style=attribute(element,'style')??'';
 return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/iu.test(style);
}
function isSkipped(element:HtmlElement):boolean{
 return element.namespaceURI!==HTML_NAMESPACE||skippedSubtrees.has(element.tagName);
}
function hasResourceReference(element:HtmlElement):boolean{
 if(element.attrs.some(item=>resourceAttributes.has(item.name)&&item.value.trim()!==''))return true;
 const href=attribute(element,'href')?.trim();
 if(href&&!(element.tagName==='a'&&href.startsWith('#')))return true;
 return /\burl\s*\(/iu.test(attribute(element,'style')??'');
}
function shouldReviewLink(element:HtmlElement):boolean{
 if(element.tagName==='meta'&&attribute(element,'http-equiv')?.trim().toLowerCase()==='refresh')return true;
 if(element.tagName==='a'){
  const href=attribute(element,'href')?.trim();
  return Boolean(href&&!href.startsWith('#'));
 }
 return hasResourceReference(element);
}
function normalizeText(value:string):string{return value.replace(/\u00a0/gu,' ').replace(/\s+/gu,' ').trim();}
function headingLevel(tagName:string):number|null{return /^h[1-6]$/u.test(tagName)?Number(tagName.slice(1)):null;}

/** HTML is parsed as inert data; this module has no fetch, render, or execution path. */
export function parseHtmlSource(source:ImportSource):LocatedExtraction{
 try{
  const verified=verifyImportSource(source);if(verified.format!=='HTML')return invalid();
  const html=new TextDecoder('utf-8',{fatal:true}).decode(verified.bytes);
  let markers=0;for(const character of html)if(character==='<'){markers++;if(markers>MAX_HTML_NODES)return invalid();}

  const parseErrors:string[]=[];
  const document=parse(html,{scriptingEnabled:false,onParseError:error=>parseErrors.push(error.code)});
  if(parseErrors.some(code=>code!==ErrorCodes.missingDoctype))return invalid();

  const observedNodes=new Set<HtmlNode>();
  const pages:Extraction['pages']=[];const tables:Extraction['tables']=[];
  const pageLocations:SourceLocation[]=[];const tableLocations:SourceLocation[]=[];
  const warnings=new Map<string,ExtractionWarning>();let blockIndex=0;let cells=0;let outputCharacters=0;const titleState:{value:string|null}={value:null};
  const flags=new Set<Extraction['flags'][number]>();
  const observe=(node:HtmlNode,depth:number):void=>{
   if(depth>MAX_HTML_DEPTH)return invalid();
   if(observedNodes.has(node))return;
   observedNodes.add(node);if(observedNodes.size>MAX_HTML_NODES)return invalid();
  };
  const scanIgnoredSubtree=(node:HtmlNode,depth:number):boolean=>{
   observe(node,depth);let hasResource=isElement(node)&&shouldReviewLink(node);
   const children=isElement(node)?elementChildren(node):'childNodes' in node?node.childNodes:[];
   for(const child of children)hasResource=scanIgnoredSubtree(child,depth+1)||hasResource;
   return hasResource;
  };
  const addWarning=(code:Extraction['flags'][number],severity:ExtractionWarning['severity'],location:SourceLocation|null=null,count=1):void=>{
   flags.add(code);
   const previous=warnings.get(code);
   if(previous)previous.count+=count;
   else warnings.set(code,{code,severity,location,count,disposition:'UNRESOLVED'});
  };
  const htmlLocation=(start:number,end:number,headingPath:string[],tableIndex:number|null):SourceLocation=>({
   kind:'HTML',sourceUrl:verified.sourceUrl,blockStart:start,blockEnd:end,headingPath:[...headingPath],tableIndex,
  });
  const collectNodesText=(roots:readonly HtmlNode[],rootDepth:number,includeBlocks:boolean,maxCharacters:number):string=>{
   const parts:string[]=[];let length=0;
   const append=(value:string):void=>{length+=value.length;if(length>maxCharacters)return invalid();parts.push(value);};
   const collect=(node:HtmlNode,depth:number,isRoot:boolean):void=>{
    observe(node,depth);
    if(isText(node)){append(node.value);return;}
    if(!isElement(node)||isHidden(node)||isSkipped(node))return;
    if(node.tagName==='br'){append(' ');return;}
    if(!isRoot&&(node.tagName==='table'||(!includeBlocks&&structuralTags.has(node.tagName))))return;
    for(const child of node.childNodes)collect(child,depth+1,false);
   };
   for(const root of roots)collect(root,rootDepth,true);return normalizeText(parts.join(''));
  };
  const collectText=(root:HtmlElement,rootDepth:number,includeBlocks:boolean,maxCharacters:number):string=>collectNodesText([root],rootDepth,includeBlocks,maxCharacters);
  const nextBlock=():number=>{blockIndex++;if(blockIndex>100_000)return invalid();return blockIndex;};
  const addPage=(text:string,headingPath:string[]):void=>{
   if(!text)return;
   if(pages.length>=IMPORT_LIMITS.pages)return invalid();
   outputCharacters+=text.length;if(outputCharacters>IMPORT_LIMITS.characters)return invalid();
   const index=nextBlock();pages.push({pageNumber:null,text,sectionTitle:headingPath.at(-1)??null,requiresReview:false});
   pageLocations.push(htmlLocation(index,index,headingPath,null));
  };
  const tableText=(cell:HtmlElement,depth:number):string=>collectText(cell,depth,true,IMPORT_LIMITS.cellCharacters);
  const extractTable=(element:HtmlElement,depth:number,headingPath:string[]):void=>{
   if(tables.length>=IMPORT_LIMITS.tables)return invalid();
   const tableIndex=tables.length+1;const tableBlock=nextBlock();
   const captionNode=element.childNodes.find((node):node is HtmlElement=>isElement(node)&&node.tagName==='caption');
   const caption=captionNode?collectText(captionNode,depth+1,true,200):'';if(caption.length>200)return invalid();
   const location=htmlLocation(tableBlock,tableBlock,headingPath,tableIndex);
   const rowsFound:HtmlElement[]=[];let nestedTables=0;
   const findRows=(node:HtmlNode,nodeDepth:number,isRoot:boolean):void=>{
    observe(node,nodeDepth);
    if(!isElement(node)||isHidden(node)||isSkipped(node))return;
    if(!isRoot&&node.tagName==='table'){nestedTables++;return;}
    if(node.tagName==='tr')rowsFound.push(node);
    for(const child of node.childNodes)findRows(child,nodeDepth+1,false);
   };
   findRows(element,depth,true);
   if(nestedTables)addWarning('UNSUPPORTED_TABLES','BLOCKING',location,nestedTables);
   const rows:string[][]=[];let maxWidth=0;let minWidth=Number.POSITIVE_INFINITY;
   for(const row of rowsFound){
    if(rows.length>=IMPORT_LIMITS.rows)return invalid();
    const rowCells=row.childNodes.filter((node):node is HtmlElement=>isElement(node)&&(node.tagName==='td'||node.tagName==='th'));
    if(!rowCells.length){rows.push(['']);cells++;if(cells>IMPORT_LIMITS.cells)return invalid();minWidth=Math.min(minWidth,1);maxWidth=Math.max(maxWidth,1);addWarning('TABLE_SHAPE_REVIEW','REVIEW',location);continue;}
    if(rowCells.length>IMPORT_LIMITS.columns)return invalid();
    const values:string[]=[];
    for(const cell of rowCells){
     cells++;if(cells>IMPORT_LIMITS.cells)return invalid();
     const colspan=attribute(cell,'colspan');const rowspan=attribute(cell,'rowspan');
     if((colspan!==undefined&&colspan.trim()!=='1')||(rowspan!==undefined&&rowspan.trim()!=='1'))addWarning('UNSUPPORTED_TABLES','BLOCKING',location);
     const value=tableText(cell,depth+1);outputCharacters+=value.length;if(outputCharacters>IMPORT_LIMITS.characters)return invalid();values.push(value);
    }
    maxWidth=Math.max(maxWidth,values.length);minWidth=Math.min(minWidth,values.length);rows.push(values);
   }
   if(!rows.length){rows.push(['']);cells++;if(cells>IMPORT_LIMITS.cells)return invalid();maxWidth=1;minWidth=1;addWarning('TABLE_SHAPE_REVIEW','REVIEW',location);}
   if(maxWidth!==minWidth)addWarning('TABLE_SHAPE_REVIEW','REVIEW',location);
   tables.push({pageNumber:null,sectionTitle:caption||(headingPath.at(-1)??null),sheetName:null,firstRow:1,rows});
   tableLocations.push(location);
  };
  const walk=(node:HtmlNode,depth:number,headingStack:{level:number;text:string}[],suppressText:boolean,insideTable:boolean):void=>{
   observe(node,depth);
   if(isText(node))return;
   if(!isElement(node)){
    if('childNodes' in node)for(const child of node.childNodes)walk(child,depth+1,headingStack,suppressText,insideTable);
    return;
   }
   if(isHidden(node)){
    const hasResource=scanIgnoredSubtree(node,depth);
    addWarning('HIDDEN_DATA_REVIEW','BLOCKING');
    if(hasResource)addWarning('EXTERNAL_LINKS_REVIEW','REVIEW');
    return;
   }
   if(isSkipped(node)){
    const hasResource=scanIgnoredSubtree(node,depth);
    addWarning('HIDDEN_DATA_REVIEW','BLOCKING');
    if(hasResource)addWarning('EXTERNAL_LINKS_REVIEW','REVIEW');
    return;
   }
   if(shouldReviewLink(node))addWarning('EXTERNAL_LINKS_REVIEW','REVIEW');
   if(node.tagName==='title'){
    if(titleState.value===null){titleState.value=collectText(node,depth,true,500);if(titleState.value.length>500)return invalid();}
    return;
   }
   const level=headingLevel(node.tagName);let currentHeadingPath=headingStack.map(item=>item.text);
   if(level!==null&&!insideTable){
    const heading=collectText(node,depth,true,IMPORT_LIMITS.cellCharacters);
    if(heading.length>200)return invalid();
    while(headingStack.length&&headingStack.at(-1)!.level>=level)headingStack.pop();
    if(heading)headingStack.push({level,text:heading});
    currentHeadingPath=headingStack.map(item=>item.text);
    if(titleState.value===null&&heading)titleState.value=heading;
    if(!suppressText&&!insideTable)addPage(heading,currentHeadingPath);
   }else if(node.tagName==='table'){
    extractTable(node,depth,currentHeadingPath);
   }else if(!suppressText&&!insideTable&&node.tagName==='a'){
    addPage(collectText(node,depth,false,IMPORT_LIMITS.characters),currentHeadingPath);
   }else if(!suppressText&&!insideTable&&leafBlockTags.has(node.tagName)){
    const text=collectText(node,depth,false,IMPORT_LIMITS.characters);
    addPage(text,currentHeadingPath);
   }else if(!suppressText&&!insideTable&&containerBlockTags.has(node.tagName)){
    walkContainer(node,depth,headingStack);return;
   }
   const suppressChildren=suppressText||(!insideTable&&leafBlockTags.has(node.tagName));
   const tableChildren=insideTable||node.tagName==='table';
   for(const child of node.childNodes)walk(child,depth+1,headingStack,suppressChildren,tableChildren);
  };
  const walkContainer=(element:HtmlElement,depth:number,headingStack:{level:number;text:string}[]):void=>{
   let inlineNodes:HtmlNode[]=[];
   const flushInline=():void=>{
    if(!inlineNodes.length)return;
    const text=collectNodesText(inlineNodes,depth+1,false,IMPORT_LIMITS.characters);
    addPage(text,headingStack.map(item=>item.text));
    for(const child of inlineNodes)walk(child,depth+1,headingStack,true,false);
    inlineNodes=[];
   };
   for(const child of element.childNodes){
    if(isElement(child)&&structuralTags.has(child.tagName)){
     flushInline();walk(child,depth+1,headingStack,false,false);
    }else inlineNodes.push(child);
   }
   flushInline();
  };

  walk(document,0,[],false,false);
  const hasExtractedContent=pages.some(page=>page.text.trim().length>0)||tables.some(table=>table.rows.some(row=>row.some(cell=>cell.trim().length>0)));
  const title=titleState.value;
  if(!pages.length){
   const firstTable=tableLocations[0];
   if(title){
    const index=nextBlock();outputCharacters+=title.length;if(outputCharacters>IMPORT_LIMITS.characters)return invalid();
    pages.push({pageNumber:null,text:title,sectionTitle:null,requiresReview:false});pageLocations.push(htmlLocation(index,index,[],null));
   }else{
    const start=firstTable?.kind==='HTML'?firstTable.blockStart:nextBlock();
    const emptyLocation=htmlLocation(start,start,[],null);
    pages.push({pageNumber:null,text:'',sectionTitle:null,requiresReview:false});pageLocations.push(emptyLocation);
   }
  }
  if(!hasExtractedContent)addWarning('LOW_TEXT_QUALITY','REVIEW',pageLocations[0]);
  const output=extractionSchema.safeParse({title,pages,tables,flags:[...flags]});if(!output.success)return invalid();
  for(const page of output.data.pages)page.requiresReview=flags.size>0;
  let textCharacters=0;let replacementCharacters=0;
  const strings=[...output.data.pages.map(page=>page.text),...output.data.tables.flatMap(table=>table.rows.flat())];
  for(const value of strings){textCharacters+=value.length;for(const character of value)if(character==='\ufffd')replacementCharacters++;}
  const report:LocatedExtraction['report']={schemaVersion:1,parser:{name:PARSER_NAME,version:PARSER_VERSION},inputBytes:verified.bytes.length,pages:output.data.pages.length,
   tables:output.data.tables.length,cells,textCharacters,replacementCharacters,truncated:false,warnings:[...warnings.values()]};
  return validateLocatedExtraction(verified,{...output.data,locations:{pages:pageLocations,tables:tableLocations},report});
 }catch{return invalid();}
}
