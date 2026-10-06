import {createHash} from 'node:crypto';
import {verifyImportSource} from '../imports/source';
import {validateLocatedExtraction} from '../imports/extraction';
import type {ExtractionWarning,ImportSource,LocatedExtraction,SourceLocation} from '../imports/types';
import {LOCAL_EMBEDDING_DIMENSION,LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from './embedding-space';
import type {PassageTokenCounter} from './embedding-client';
import {LocatedPlanError,type LocatedChunkDraft,type LocatedChunkPlan,type LocatedChunkCoverage,type LocatedPlanBinding,type LocatedPlanOptions} from './located-plan-types';

const MAX_TOTAL_MS=45_000;
const MAX_BATCH=16;
const MAX_CHUNKS=2_000;
const MAX_TEXT_BYTES=6_000;
const MAX_PASSAGE_TOKENS=512;
const MAX_COUNTER_TOKENS=16_384;
const DEFAULT_OVERLAP_CHARACTERS=120;
const MAX_OVERLAP_CHARACTERS=200;
const encoder=new TextEncoder();
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});

interface PageSegment {
 key:string;
 pageIndex:number;
 pageText:string;
 pageNumber:number|null;
 sectionTitle:string|null;
 location:SourceLocation;
 requiresReview:boolean;
 start:number;
 end:number;
 preferredBreaks:number[];
}

interface PageWork {
 kind:'PAGE';
 pageIndex:number;
 segment:PageSegment;
 start:number;
 end:number;
}

interface TableWork {
 kind:'TABLE';
 tableIndex:number;
 table:LocatedExtraction['tables'][number];
 location:SourceLocation;
 requiresReview:boolean;
 rowStartIndex:number;
 rowEndIndex:number;
}

type Work=PageWork|TableWork;

function fail(code:ConstructorParameters<typeof LocatedPlanError>[0]):never{
 throw new LocatedPlanError(code);
}

function isObject(value:unknown):value is Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

function validateOptions(options:LocatedPlanOptions|undefined):{signal?:AbortSignal;timeoutMs:number;maxChunks:number;overlapCharacters:number}{
 if(options===undefined)return {timeoutMs:MAX_TOTAL_MS,maxChunks:MAX_CHUNKS,overlapCharacters:DEFAULT_OVERLAP_CHARACTERS};
 if(!isObject(options))fail('KNOWLEDGE_PLAN_INPUT_INVALID');
 const allowed=new Set(['signal','timeoutMs','maxChunks','overlapCharacters']);
 if(Object.keys(options).some(key=>!allowed.has(key)))fail('KNOWLEDGE_PLAN_INPUT_INVALID');
 const timeoutMs=options.timeoutMs??MAX_TOTAL_MS;
 const maxChunks=options.maxChunks??MAX_CHUNKS;
 const overlapCharacters=options.overlapCharacters??DEFAULT_OVERLAP_CHARACTERS;
 if(typeof timeoutMs!=='number'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_TOTAL_MS||
  typeof maxChunks!=='number'||!Number.isSafeInteger(maxChunks)||maxChunks<1||maxChunks>MAX_CHUNKS||
  typeof overlapCharacters!=='number'||!Number.isSafeInteger(overlapCharacters)||overlapCharacters<0||overlapCharacters>MAX_OVERLAP_CHARACTERS||
  options.signal!==undefined&&(!isObject(options.signal)||typeof options.signal.aborted!=='boolean'||typeof options.signal.addEventListener!=='function'))
  fail('KNOWLEDGE_PLAN_INPUT_INVALID');
 return {signal:options.signal as AbortSignal|undefined,timeoutMs,maxChunks,overlapCharacters};
}

function validateBinding(binding:LocatedPlanBinding):LocatedPlanBinding{
 if(!isObject(binding)||Object.keys(binding).some(key=>key!=='jobId'&&key!=='extractionRevision')||
  typeof binding.jobId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.test(binding.jobId)||
  !Number.isSafeInteger(binding.extractionRevision)||binding.extractionRevision<1)
  fail('KNOWLEDGE_PLAN_INPUT_INVALID');
 return {jobId:binding.jobId,extractionRevision:binding.extractionRevision};
}

function validateCounter(counter:PassageTokenCounter):void{
 if(!counter||counter.modelId!==LOCAL_EMBEDDING_MODEL||counter.revision!==LOCAL_EMBEDDING_REVISION||
  counter.dimension!==LOCAL_EMBEDDING_DIMENSION||counter.fingerprint!==LOCAL_EMBEDDING_FINGERPRINT||
  typeof counter.countPassageTokens!=='function')fail('KNOWLEDGE_PLAN_SPACE_INVALID');
}

function checkBudget(deadline:number,signal?:AbortSignal):void{
 if(signal?.aborted)fail('KNOWLEDGE_PLAN_ABORTED');
 if(Date.now()>=deadline)fail('KNOWLEDGE_PLAN_TIMEOUT');
}

function safeCounterError(error:unknown):LocatedPlanError{
 if(isObject(error)&&typeof error.code==='string'){
  if(error.code==='EMBEDDING_ABORTED')return new LocatedPlanError('KNOWLEDGE_PLAN_ABORTED');
  if(error.code==='EMBEDDING_TIMEOUT')return new LocatedPlanError('KNOWLEDGE_PLAN_TIMEOUT');
 }
 return new LocatedPlanError('KNOWLEDGE_PLAN_COUNTER_INVALID');
}

async function countBatch(counter:PassageTokenCounter,texts:string[],deadline:number,signal?:AbortSignal):Promise<number[]>{
 checkBudget(deadline,signal);
 if(texts.length<1||texts.length>MAX_BATCH||texts.some(text=>!text.trim()||encoder.encode(text).byteLength>MAX_TEXT_BYTES))
  fail('KNOWLEDGE_PLAN_INPUT_INVALID');
 const remaining=deadline-Date.now();
 if(remaining<=0)fail('KNOWLEDGE_PLAN_TIMEOUT');
 const values=await new Promise<unknown>((resolve,reject)=>{
  let settled=false;
  const finish=(action:(value:never)=>void,value:unknown):void=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);action(value as never);
  };
  const onAbort=()=>finish(reject,new LocatedPlanError('KNOWLEDGE_PLAN_ABORTED'));
  const timer=setTimeout(()=>finish(reject,new LocatedPlanError('KNOWLEDGE_PLAN_TIMEOUT')),remaining);
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted){onAbort();return;}
  Promise.resolve().then(()=>counter.countPassageTokens([...texts],{signal,timeoutMs:Math.max(1,deadline-Date.now())}))
   .then(value=>finish(resolve,value),error=>finish(reject,safeCounterError(error)));
 });
 if(!Array.isArray(values)||values.length!==texts.length||values.some(value=>!Number.isSafeInteger(value)||typeof value!=='number'||value<1||value>MAX_COUNTER_TOKENS))
  fail('KNOWLEDGE_PLAN_COUNTER_INVALID');
 return values as number[];
}

async function countWorks(works:Work[],counter:PassageTokenCounter,deadline:number,signal:AbortSignal|undefined,
 getText:(work:Work,index:number,all:Work[])=>string):Promise<number[]>{
 const counts:number[]=[];
 for(let start=0;start<works.length;start+=MAX_BATCH){
  checkBudget(deadline,signal);
  const batch=works.slice(start,start+MAX_BATCH);
  counts.push(...await countBatch(counter,batch.map((work,index)=>getText(work,start+index,works)),deadline,signal));
 }
 return counts;
}

function copyLocation(location:SourceLocation):SourceLocation{
 if(location.kind==='DOCX'||location.kind==='HTML')return {...location,headingPath:[...location.headingPath]};
 return {...location};
}

function locationsOverlap(left:SourceLocation,right:SourceLocation):boolean{
 if(left.kind!==right.kind)return false;
 if(left.kind==='PDF'&&right.kind==='PDF')return left.pageNumber===right.pageNumber&&left.blockStart<=right.blockEnd&&right.blockStart<=left.blockEnd&&
  (left.tableIndex===null||right.tableIndex===null||left.tableIndex===right.tableIndex);
 if(left.kind==='DOCX'&&right.kind==='DOCX')return left.blockStart<=right.blockEnd&&right.blockStart<=left.blockEnd&&
  (left.tableIndex===null||right.tableIndex===null||left.tableIndex===right.tableIndex);
 if(left.kind==='XLSX'&&right.kind==='XLSX')return left.sheetIndex===right.sheetIndex&&left.rowStart<=right.rowEnd&&right.rowStart<=left.rowEnd&&
  left.columnStart<=right.columnEnd&&right.columnStart<=left.columnEnd&&(left.tableIndex===null||right.tableIndex===null||left.tableIndex===right.tableIndex);
 if(left.kind==='CSV'&&right.kind==='CSV')return left.rowStart<=right.rowEnd&&right.rowStart<=left.rowEnd&&left.columnStart<=right.columnEnd&&
  right.columnStart<=left.columnEnd&&(left.tableIndex===null||right.tableIndex===null||left.tableIndex===right.tableIndex);
 if(left.kind==='HTML'&&right.kind==='HTML')return left.sourceUrl===right.sourceUrl&&left.blockStart<=right.blockEnd&&right.blockStart<=left.blockEnd&&
  (left.tableIndex===null||right.tableIndex===null||left.tableIndex===right.tableIndex);
 return false;
}

function reviewApplies(location:SourceLocation,warnings:ExtractionWarning[]):boolean{
 return warnings.some(warning=>warning.location===null||locationsOverlap(location,warning.location));
}

function headingLine(line:string):boolean{
 return /^\s*#{1,6}\s+\S/u.test(line)||/^\s*(?:ข้อ(?:ที่)?\s*[0-9๐-๙]+|บทที่\s*[0-9๐-๙]+|หมวด(?:\s|ที่|[0-9๐-๙]))/u.test(line);
}

function boundedSectionTitle(value:string|null):string|null{
 if(value===null)return null;
 let result='';
 for(const item of segmenter.segment(value)){
  if(result.length+item.segment.length>180)break;
  result+=item.segment;
 }
 return result||null;
}

function headingTitle(line:string):string|null{
 const value=line.replace(/^\s*#{1,6}\s*/u,'').trim();
 return boundedSectionTitle(value||line);
}

function preferredBreaks(text:string,start:number,end:number):number[]{
 const breaks:number[]=[];
 let cursor=start,hasBody=false,afterBlank=false;
 while(cursor<end){
  let lineEnd=text.indexOf('\n',cursor);if(lineEnd<0||lineEnd>=end)lineEnd=end;else lineEnd+=1;
  let contentEnd=lineEnd;if(contentEnd>cursor&&text[contentEnd-1]==='\n')contentEnd--;if(contentEnd>cursor&&text[contentEnd-1]==='\r')contentEnd--;
  const blank=text.slice(cursor,contentEnd).trim().length===0;
  if(blank){if(hasBody)afterBlank=true;}
  else{
   if(afterBlank&&cursor>start&&cursor<end)breaks.push(cursor);
   hasBody=true;afterBlank=false;
  }
  cursor=lineEnd;
 }
 return breaks;
}

function pageSegments(page:LocatedExtraction['pages'][number],pageIndex:number,text:string,location:SourceLocation,warnings:ExtractionWarning[]):PageSegment[]{
 const raw:Array<{start:number;end:number;sectionTitle:string|null}>=[];
 let segmentStart=0,sectionTitle=boundedSectionTitle(page.sectionTitle),cursor=0;
 while(cursor<text.length){
  let lineEnd=text.indexOf('\n',cursor);if(lineEnd<0)lineEnd=text.length;else lineEnd++;
  let contentEnd=lineEnd;if(contentEnd>cursor&&text[contentEnd-1]==='\n')contentEnd--;if(contentEnd>cursor&&text[contentEnd-1]==='\r')contentEnd--;
  const line=text.slice(cursor,contentEnd);
  if(headingLine(line)&&cursor>segmentStart){
   raw.push({start:segmentStart,end:cursor,sectionTitle});segmentStart=cursor;sectionTitle=headingTitle(line);
  }else if(headingLine(line)&&cursor===segmentStart){sectionTitle=headingTitle(line);}
  cursor=lineEnd;
 }
 if(segmentStart<text.length)raw.push({start:segmentStart,end:text.length,sectionTitle});
 if(raw.length===0&&text.length>0)raw.push({start:0,end:text.length,sectionTitle});
 const merged:Array<{start:number;end:number;sectionTitle:string|null}>=[];
 let pendingWhitespaceStart:number|null=null;
 for(const segment of raw){
  const content=text.slice(segment.start,segment.end);
  if(!content.trim()){
   if(merged.length)merged[merged.length-1].end=segment.end;
   else pendingWhitespaceStart??=segment.start;
   continue;
  }
  if(pendingWhitespaceStart!==null){segment.start=pendingWhitespaceStart;pendingWhitespaceStart=null;}
  merged.push({...segment});
 }
 if(pendingWhitespaceStart!==null&&merged.length)merged[merged.length-1].end=text.length;
 const requiresReview=page.requiresReview||reviewApplies(location,warnings);
 return merged.map((segment,index)=>({key:`page-${pageIndex}-section-${index}`,pageIndex,pageText:text,pageNumber:page.pageNumber,
  sectionTitle:segment.sectionTitle,location:copyLocation(location),requiresReview,start:segment.start,end:segment.end,
  preferredBreaks:preferredBreaks(text,segment.start,segment.end)}));
}

function nonWhitespaceBounds(text:string,start:number,end:number):{first:number;last:number}{
 let first=start,last=end;
 while(first<end&&/^\s$/u.test(text[first]))first++;
 while(last>start&&/^\s$/u.test(text[last-1]))last--;
 return {first,last};
}

function pickPreferred(text:string,start:number,end:number,breaks:number[],target:number,byteLimit?:number):number|undefined{
 const {first,last}=nonWhitespaceBounds(text,start,end);
 let low=0,high=breaks.length;
 while(low<high){const middle=(low+high)>>>1;if(breaks[middle]<=first)low=middle+1;else high=middle;}
 const begin=low;
 low=begin;high=breaks.length;
 while(low<high){const middle=(low+high)>>>1;if(breaks[middle]<last)low=middle+1;else high=middle;}
 const finish=low;
 if(begin>=finish)return undefined;
 if(byteLimit!==undefined){
  const maximum=Math.min(end,start+MAX_TEXT_BYTES);
  low=begin;high=finish;
  while(low<high){
   const middle=(low+high)>>>1,boundary=breaks[middle];
   if(boundary<=maximum&&Buffer.byteLength(text.slice(start,boundary),'utf8')<=byteLimit)low=middle+1;
   else high=middle;
  }
  return low>begin?breaks[low-1]:undefined;
 }
 low=begin;high=finish;
 while(low<high){const middle=(low+high)>>>1;if(breaks[middle]<target)low=middle+1;else high=middle;}
 const right=low<finish?breaks[low]:undefined,left=low>begin?breaks[low-1]:undefined;
 if(left===undefined)return right;
 if(right===undefined)return left;
 return Math.abs(left-target)<=Math.abs(right-target)?left:right;
}

function splitAtGrapheme(text:string,start:number,end:number,target:number,byteLimit?:number):number{
 const scanEnd=byteLimit===undefined?end:Math.min(end,start+MAX_TEXT_BYTES);
 const part=text.slice(start,scanEnd);
 const boundaries:number[]=[];
 let byteCount=0;
 for(const item of segmenter.segment(part)){
  byteCount+=encoder.encode(item.segment).byteLength;
  if(byteLimit!==undefined&&byteCount>byteLimit)break;
  const boundary=start+item.index+item.segment.length;
  if(boundary>start&&boundary<end&&(boundary<scanEnd||scanEnd===end))boundaries.push(boundary);
 }
 const {first,last}=nonWhitespaceBounds(text,start,end);
 const eligible=boundaries.filter(boundary=>boundary>first&&boundary<last);
 if(!eligible.length){
  if(boundaries.length)fail('KNOWLEDGE_PLAN_INPUT_INVALID');
  if(byteLimit!==undefined){
   const wholeTail=text.slice(start,end);
   const first=segmenter.segment(wholeTail)[Symbol.iterator]().next().value as Intl.SegmentData|undefined;
   if(first&&encoder.encode(first.segment).byteLength>byteLimit)fail('KNOWLEDGE_PLAN_GRAPHEME_TOO_LARGE');
  }
  fail('KNOWLEDGE_PLAN_GRAPHEME_TOO_LARGE');
 }
 return eligible.reduce((best,boundary)=>Math.abs(boundary-target)<Math.abs(best-target)?boundary:best,eligible[0]);
}

function byteSplit(text:string,start:number,end:number,breaks:number[]):number{
 const maxCodeUnits=Math.min(end,start+MAX_TEXT_BYTES);
 const paragraph=pickPreferred(text,start,end,breaks,maxCodeUnits,MAX_TEXT_BYTES);
 if(paragraph!==undefined)return paragraph;
 return splitAtGrapheme(text,start,end,maxCodeUnits,MAX_TEXT_BYTES);
}

function splitPageAtByteLimit(segment:PageSegment):PageWork[]{
 const works:PageWork[]=[];
 let start=segment.start;
 while(start<segment.end){
  const end=segment.end-start>MAX_TEXT_BYTES||Buffer.byteLength(segment.pageText.slice(start,segment.end),'utf8')>MAX_TEXT_BYTES
   ?byteSplit(segment.pageText,start,segment.end,segment.preferredBreaks):segment.end;
  if(!segment.pageText.slice(start,end).trim())fail('KNOWLEDGE_PLAN_INPUT_INVALID');
  works.push({kind:'PAGE',pageIndex:segment.pageIndex,segment,start,end});
  start=end;
 }
 return works;
}

function pageText(work:PageWork):string{
 return work.segment.pageText.slice(work.start,work.end);
}

function tableRowText(table:LocatedExtraction['tables'][number],rowIndex:number):string{
 return `row ${table.firstRow+rowIndex}: ${JSON.stringify(table.rows[rowIndex])}`;
}

function tableWorkText(work:TableWork):string{
 return Array.from({length:work.rowEndIndex-work.rowStartIndex+1},(_value,index)=>tableRowText(work.table,work.rowStartIndex+index)).join('\n');
}

function narrowTableLocation(location:SourceLocation,table:LocatedExtraction['tables'][number],start:number,end:number):SourceLocation{
 if(location.kind==='CSV'||location.kind==='XLSX')return {...location,rowStart:table.firstRow+start,rowEnd:table.firstRow+end};
 return copyLocation(location);
}

function tableWorks(table:LocatedExtraction['tables'][number],tableIndex:number,location:SourceLocation,requiresReview:boolean):TableWork[]{
 const rows=table.rows.map((_row,index)=>{
  const text=tableRowText(table,index);
  if(Buffer.byteLength(text,'utf8')>MAX_TEXT_BYTES)fail('KNOWLEDGE_PLAN_TABLE_ROW_TOO_LARGE');
  return text;
 });
 const works:TableWork[]=[];let start=0,bytes=0;
 for(let index=0;index<rows.length;index++){
  const rowBytes=Buffer.byteLength(rows[index],'utf8');
  const combinedBytes=bytes+(index>start?1:0)+rowBytes;
  if(index>start&&combinedBytes>MAX_TEXT_BYTES){
   works.push({kind:'TABLE',tableIndex,table,location:narrowTableLocation(location,table,start,index-1),requiresReview,rowStartIndex:start,rowEndIndex:index-1});
   start=index;bytes=rowBytes;
  }else bytes=combinedBytes;
 }
 works.push({kind:'TABLE',tableIndex,table,location:narrowTableLocation(location,table,start,rows.length-1),requiresReview,rowStartIndex:start,rowEndIndex:rows.length-1});
 return works;
}

function workText(work:Work):string{
 return work.kind==='PAGE'?pageText(work):tableWorkText(work);
}

function splitPageWork(work:PageWork):[PageWork,PageWork]{
 const boundary=pickPreferred(work.segment.pageText,work.start,work.end,work.segment.preferredBreaks,
  work.start+Math.floor((work.end-work.start)/2))??splitAtGrapheme(work.segment.pageText,work.start,work.end,
  work.start+Math.floor((work.end-work.start)/2));
 return [{...work,end:boundary},{...work,start:boundary}];
}

function splitTableWork(work:TableWork):[TableWork,TableWork]{
 if(work.rowStartIndex===work.rowEndIndex)fail('KNOWLEDGE_PLAN_TABLE_ROW_TOO_LARGE');
 const middle=Math.floor((work.rowStartIndex+work.rowEndIndex)/2);
 return [
  {...work,rowEndIndex:middle,location:narrowTableLocation(work.location,work.table,work.rowStartIndex,middle)},
  {...work,rowStartIndex:middle+1,location:narrowTableLocation(work.location,work.table,middle+1,work.rowEndIndex)},
 ];
}

function splitWork(work:Work):[Work,Work]{
 return work.kind==='PAGE'?splitPageWork(work):splitTableWork(work);
}

function orderKey(location:SourceLocation):number[]{
 if(location.kind==='PDF')return [location.pageNumber,location.blockStart,location.tableIndex??0];
 if(location.kind==='DOCX')return [location.blockStart,location.blockEnd,location.tableIndex??0];
 if(location.kind==='XLSX')return [location.sheetIndex,location.rowStart,location.columnStart,location.tableIndex??0];
 if(location.kind==='CSV')return [location.rowStart,location.columnStart,location.tableIndex??0];
 return [location.blockStart,location.blockEnd,location.tableIndex??0];
}

function workLocation(work:Work):SourceLocation{
 return work.kind==='PAGE'?work.segment.location:work.location;
}

function compareWorks(left:Work,right:Work):number{
 const a=orderKey(workLocation(left)),b=orderKey(workLocation(right));
 for(let index=0;index<Math.max(a.length,b.length);index++){
  const difference=(a[index]??0)-(b[index]??0);if(difference)return difference;
 }
 if(left.kind!==right.kind)return left.kind==='PAGE'?-1:1;
 if(left.kind==='PAGE'&&right.kind==='PAGE')return left.pageIndex-right.pageIndex||left.start-right.start;
 if(left.kind==='TABLE'&&right.kind==='TABLE')return left.tableIndex-right.tableIndex||left.rowStartIndex-right.rowStartIndex;
 return 0;
}

function sourceUnits(extraction:LocatedExtraction,options:{maxChunks:number}):Work[]{
 const works:Work[]=[];
 for(let index=0;index<extraction.pages.length;index++){
  const page=extraction.pages[index];
  if(!page.text.length)continue;
  if(!page.text.trim())fail('KNOWLEDGE_PLAN_INPUT_INVALID');
  const location=extraction.locations.pages[index];
  for(const segment of pageSegments(page,index,page.text,location,extraction.report.warnings))works.push(...splitPageAtByteLimit(segment));
  if(works.length>options.maxChunks)fail('KNOWLEDGE_PLAN_LIMIT_EXCEEDED');
 }
 const anyPageReview=extraction.pages.some(page=>page.requiresReview);
 for(let index=0;index<extraction.tables.length;index++){
  const table=extraction.tables[index],location=extraction.locations.tables[index];
  const requiresReview=anyPageReview||reviewApplies(location,extraction.report.warnings);
  works.push(...tableWorks(table,index,location,requiresReview));
  if(works.length>options.maxChunks)fail('KNOWLEDGE_PLAN_LIMIT_EXCEEDED');
 }
 works.sort(compareWorks);
 return works;
}

function overlapStart(work:PageWork,previous:PageWork|undefined,overlapCharacters:number):number{
 if(!previous||previous.segment.key!==work.segment.key||previous.end!==work.start||overlapCharacters===0)return work.start;
 let cursor=work.start,count=0;
 const floor=Math.max(work.segment.start,previous.start);
 while(cursor>floor&&count<overlapCharacters){
  let prior=cursor-1;
  const unit=work.segment.pageText.charCodeAt(prior);
  if(unit>=0xdc00&&unit<=0xdfff&&prior>floor){const high=work.segment.pageText.charCodeAt(prior-1);if(high>=0xd800&&high<=0xdbff)prior--;}
  cursor=prior;count++;
 }
 const preceding=work.segment.pageText.slice(floor,work.start);
 let start=floor;
 for(const item of segmenter.segment(preceding)){
  const boundary=floor+item.index+item.segment.length;
  if(boundary<=cursor)start=boundary;
 }
 return start;
}

function finalText(work:Work,index:number,works:Work[],overlapCharacters:number):string{
 if(work.kind==='TABLE')return tableWorkText(work);
 const previous=works[index-1];
 const priorPage=previous?.kind==='PAGE'?previous:undefined;
 return work.segment.pageText.slice(overlapStart(work,priorPage,overlapCharacters),work.end);
}

function pageCoverage(work:PageWork,index:number,works:Work[],overlapCharacters:number):LocatedChunkCoverage{
 const previous=works[index-1];
 const previousPage=previous?.kind==='PAGE'?previous:undefined;
 const start=overlapStart(work,previousPage,overlapCharacters);
 return {kind:'PAGE',index:work.pageIndex,start,end:work.end,overlapPrefixLength:work.start-start};
}

function tableCoverage(work:TableWork):LocatedChunkCoverage{
 return {kind:'TABLE',index:work.tableIndex,rowStartIndex:work.rowStartIndex,rowEndIndex:work.rowEndIndex};
}

function sourceLocationsFor(work:Work):SourceLocation[]{
 const location=copyLocation(workLocation(work));
 if(location.kind==='DOCX'||location.kind==='HTML')return [{...location,headingPath:[...location.headingPath]}];
 return [location];
}

function makeDrafts(works:Work[],counts:number[],overlapCharacters:number):LocatedChunkDraft[]{
 return works.map((work,index)=>{
  const coverage=work.kind==='PAGE'?pageCoverage(work,index,works,overlapCharacters):tableCoverage(work);
  return {index,pageNumber:work.kind==='PAGE'?work.segment.pageNumber:
   work.table.pageNumber,sectionTitle:work.kind==='PAGE'?work.segment.sectionTitle:boundedSectionTitle(work.table.sectionTitle),
   content:finalText(work,index,works,overlapCharacters),requiresReview:work.kind==='PAGE'?work.segment.requiresReview:work.requiresReview,
   sourceLocations:sourceLocationsFor(work),passageTokenCount:counts[index],coverage};
 });
}

function cloneWarnings(warnings:ExtractionWarning[]):ExtractionWarning[]{
 return warnings.map(warning=>({...warning,location:warning.location?copyLocation(warning.location):null}));
}

function digestFor(binding:LocatedPlanBinding,sourceChecksum:string,chunks:LocatedChunkDraft[],warnings:ExtractionWarning[]):string{
 const identity={model:LOCAL_EMBEDDING_MODEL,modelRevision:LOCAL_EMBEDDING_REVISION,embeddingFingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  dimension:LOCAL_EMBEDDING_DIMENSION};
 const payload={schemaVersion:1,chunkerVersion:'located-e5-v1',binding:{...binding},sourceChecksum,identity,
  chunks:chunks.map(chunk=>({index:chunk.index,content:chunk.content,coverage:{...chunk.coverage},sourceLocations:chunk.sourceLocations.map(copyLocation),
   passageTokenCount:chunk.passageTokenCount,pageNumber:chunk.pageNumber,sectionTitle:chunk.sectionTitle,requiresReview:chunk.requiresReview})),
  warnings:cloneWarnings(warnings)};
 return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Creates a no-vector, review-bound-input plan; it neither embeds nor publishes knowledge. */
export async function buildLocatedChunkPlan(source:ImportSource,extraction:LocatedExtraction,binding:LocatedPlanBinding,
 counter:PassageTokenCounter,options?:LocatedPlanOptions):Promise<LocatedChunkPlan>{
 const startedAt=Date.now();
 const checkedOptions=validateOptions(options),checkedBinding=validateBinding(binding);validateCounter(counter);
 let verifiedSource:ImportSource,checkedExtraction:LocatedExtraction;
 try{
  verifiedSource=verifyImportSource(source);
  checkedExtraction=validateLocatedExtraction(verifiedSource,extraction);
 }catch{fail('KNOWLEDGE_PLAN_INPUT_INVALID');}
 const deadline=startedAt+checkedOptions.timeoutMs;
 checkBudget(deadline,checkedOptions.signal);
 const warnings=cloneWarnings(checkedExtraction.report.warnings);
 let works=sourceUnits(checkedExtraction,{maxChunks:checkedOptions.maxChunks});
 if(works.length===0)fail('KNOWLEDGE_PLAN_INPUT_INVALID');
 if(works.length>checkedOptions.maxChunks)fail('KNOWLEDGE_PLAN_LIMIT_EXCEEDED');

 // First split byte-bounded source units until every unoverlapped candidate fits the actual tokenizer.
 let lowerBound=works.length;
 while(works.length){
  const counts=await countWorks(works,counter,deadline,checkedOptions.signal,workText);
  const next:Work[]=[];let splitCount=0;
  for(let index=0;index<works.length;index++){
   const work=works[index];
   if(counts[index]<=MAX_PASSAGE_TOKENS){next.push(work);continue;}
   const split=splitWork(work);next.push(...split);splitCount++;
  }
  lowerBound+=splitCount;
  if(lowerBound>checkedOptions.maxChunks)fail('KNOWLEDGE_PLAN_LIMIT_EXCEEDED');
  works=next.sort(compareWorks);
  if(splitCount===0)break;
 }

 // Recount every final raw passage after in-unit overlap; split again if overlap changes either bound.
 for(;;){
  checkBudget(deadline,checkedOptions.signal);
  const byteSplits:Work[]=[];let changed=false;
  for(let index=0;index<works.length;index++){
   const work=works[index],text=finalText(work,index,works,checkedOptions.overlapCharacters);
   if(Buffer.byteLength(text,'utf8')<=MAX_TEXT_BYTES){byteSplits.push(work);continue;}
   byteSplits.push(...splitWork(work));changed=true;lowerBound++;
   if(lowerBound>checkedOptions.maxChunks)fail('KNOWLEDGE_PLAN_LIMIT_EXCEEDED');
  }
  if(changed){works=byteSplits.sort(compareWorks);continue;}
  const counts=await countWorks(works,counter,deadline,checkedOptions.signal,(work,index,all)=>finalText(work,index,all,checkedOptions.overlapCharacters));
  const next:Work[]=[];let splitCount=0;
  for(let index=0;index<works.length;index++){
   const work=works[index];
   if(counts[index]<=MAX_PASSAGE_TOKENS){next.push(work);continue;}
   next.push(...splitWork(work));splitCount++;
  }
  lowerBound+=splitCount;
  if(lowerBound>checkedOptions.maxChunks)fail('KNOWLEDGE_PLAN_LIMIT_EXCEEDED');
  if(splitCount){works=next.sort(compareWorks);continue;}
  checkBudget(deadline,checkedOptions.signal);
  const drafts=makeDrafts(works,counts,checkedOptions.overlapCharacters);
  const digest=digestFor(checkedBinding,verifiedSource.checksum,drafts,warnings);
  return {schemaVersion:1,chunkerVersion:'located-e5-v1',binding:{...checkedBinding},sourceChecksum:verifiedSource.checksum,
   model:LOCAL_EMBEDDING_MODEL,modelRevision:LOCAL_EMBEDDING_REVISION,embeddingFingerprint:LOCAL_EMBEDDING_FINGERPRINT,
   chunks:drafts,warnings:cloneWarnings(warnings),digest};
 }
}
