import {createImportSource} from '../lib/imports/source';
import type {ExtractionWarning,ImportFormat,ImportSource,LocatedExtraction,SourceLocation} from '../lib/imports/types';
import {LOCAL_EMBEDDING_DIMENSION,LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../lib/knowledge/embedding-space';
import type {PassageTokenCounter} from '../lib/knowledge/embedding-client';
import {buildLocatedChunkPlan} from '../lib/knowledge/located-chunk-plan';
import {afterEach,describe,expect,it,vi} from 'vitest';

const encoder=new TextEncoder();
const JOB_ID='123e4567-e89b-42d3-a456-426614174000';
const otherJobId='123e4567-e89b-42d3-a456-426614174001';

function sourceFor(format:ImportFormat):ImportSource{
 const inputs:Record<ImportFormat,{bytes:Uint8Array;filename:string;mimeType:string}>={
  PDF:{bytes:encoder.encode('%PDF-1.7 fixture'),filename:'fixture.pdf',mimeType:'application/pdf'},
  DOCX:{bytes:Uint8Array.from([80,75,3,4,1]),filename:'fixture.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
  XLSX:{bytes:Uint8Array.from([80,75,3,4,1]),filename:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
  CSV:{bytes:encoder.encode('a,b\n'),filename:'fixture.csv',mimeType:'text/csv'},
  HTML:{bytes:encoder.encode('<!doctype html><html></html>'),filename:'fixture.html',mimeType:'text/html'},
 };
 const input=inputs[format];
 return createImportSource({...input,sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
}

function pageLocation(format:ImportFormat,index:number):SourceLocation{
 if(format==='PDF')return {kind:'PDF',pageNumber:index+1,blockStart:1,blockEnd:1,tableIndex:null};
 if(format==='DOCX')return {kind:'DOCX',blockStart:index+1,blockEnd:index+1,headingPath:[],tableIndex:null};
 if(format==='XLSX')return {kind:'XLSX',sheetName:'Sheet 1',sheetIndex:1,rowStart:1,rowEnd:1,columnStart:1,columnEnd:1,tableIndex:null};
 if(format==='CSV')return {kind:'CSV',rowStart:1,rowEnd:1,columnStart:1,columnEnd:1,tableIndex:null};
 return {kind:'HTML',sourceUrl:null,blockStart:index+1,blockEnd:index+1,headingPath:[],tableIndex:null};
}

function tableLocation(format:ImportFormat,rowCount:number,width:number):SourceLocation{
 if(format==='PDF')return {kind:'PDF',pageNumber:1,blockStart:2,blockEnd:2,tableIndex:1};
 if(format==='DOCX')return {kind:'DOCX',blockStart:2,blockEnd:2,headingPath:['Fees'],tableIndex:1};
 if(format==='XLSX')return {kind:'XLSX',sheetName:'Sheet 1',sheetIndex:1,rowStart:1,rowEnd:rowCount,columnStart:1,columnEnd:width,tableIndex:1};
 if(format==='CSV')return {kind:'CSV',rowStart:1,rowEnd:rowCount,columnStart:1,columnEnd:width,tableIndex:1};
 return {kind:'HTML',sourceUrl:null,blockStart:2,blockEnd:2,headingPath:['Fees'],tableIndex:1};
}

function extractionFor(source:ImportSource,options:{pages?:LocatedExtraction['pages'];rows?:string[][];warnings?:ExtractionWarning[]}={}):LocatedExtraction{
 const pages=options.pages??[{pageNumber:source.format==='PDF'?1:null,text:'',sectionTitle:null,requiresReview:false}];
 const rows=options.rows?structuredClone(options.rows):[];
 const tables=rows.length?[{pageNumber:source.format==='PDF'?1:null,sectionTitle:'Fees',sheetName:source.format==='XLSX'?'Sheet 1':null,firstRow:1,rows}]:[];
 const strings=[...pages.map(page=>page.text),...tables.flatMap(table=>table.rows.flat())];
 const warnings=structuredClone(options.warnings??[]);
 return {
  title:'Fixture',pages,tables,flags:[...new Set(warnings.map(warning=>warning.code))] as LocatedExtraction['flags'],
  locations:{pages:pages.map((_page,index)=>pageLocation(source.format,index)),tables:tables.map(table=>tableLocation(source.format,table.rows.length,Math.max(...table.rows.map(row=>row.length))))},
  report:{schemaVersion:1,parser:{name:'fixture',version:'1'},inputBytes:source.bytes.length,pages:pages.length,tables:tables.length,
   cells:tables.reduce((sum,table)=>sum+table.rows.reduce((total,row)=>total+row.length,0),0),
   textCharacters:strings.reduce((sum,text)=>sum+text.length,0),replacementCharacters:strings.reduce((sum,text)=>sum+[...text].filter(character=>character==='\ufffd').length,0),
   truncated:false,warnings},
 };
}

function counterFor(count:(text:string)=>number=(text)=>Math.max(1,Math.ceil(encoder.encode(text).byteLength/100))):PassageTokenCounter&{calls:string[][]}{
 const result={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:LOCAL_EMBEDDING_DIMENSION,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  calls:[] as string[][],
  async countPassageTokens(texts:string[]){result.calls.push([...texts]);return texts.map(count);},
 };
 return result;
}

const binding={jobId:JOB_ID,extractionRevision:7};
afterEach(()=>vi.useRealTimers());

describe('buildLocatedChunkPlan',()=>{
 it('preserves exact UTF-16 page slices and reconstructs narrative after declared overlap',async()=>{
  const source=sourceFor('PDF');
  const text='# แนวทาง\r\n\r\n  '+('a'.repeat(1300))+'  \r\n';
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text,sectionTitle:null,requiresReview:false}]});
  const counter=counterFor(value=>Math.ceil(value.length/2));

  const plan=await buildLocatedChunkPlan(source,extraction,binding,counter,{overlapCharacters:12});
  const chunks=plan.chunks.filter(chunk=>chunk.coverage.kind==='PAGE');
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.map(chunk=>chunk.passageTokenCount).every(count=>count>=1&&count<=512)).toBe(true);
  for(const chunk of chunks){
   if(chunk.coverage.kind!=='PAGE')throw new Error('Expected page coverage');
   expect(chunk.content).toBe(text.slice(chunk.coverage.start,chunk.coverage.end));
   expect(chunk.sourceLocations).toEqual([extraction.locations.pages[0]]);
  }
  expect(chunks.map(chunk=>chunk.content.slice(chunk.coverage.kind==='PAGE'?chunk.coverage.overlapPrefixLength:0)).join('')).toBe(text);
  expect(chunks[0].sectionTitle).toBe('แนวทาง');
 });

 it('keeps overlap inside heading sections and source pages',async()=>{
  const source=sourceFor('PDF');
  const text='# First\n'+('a'.repeat(1250))+'\n# Second\n'+('b'.repeat(30));
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text,sectionTitle:null,requiresReview:false},{pageNumber:2,text:'second page text',sectionTitle:null,requiresReview:false}]});
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counterFor(value=>Math.ceil(value.length/2)),{overlapCharacters:9});
  const secondSection=plan.chunks.find(chunk=>chunk.content.startsWith('# Second'));
  const secondPage=plan.chunks.find(chunk=>chunk.sourceLocations[0]?.kind==='PDF'&&chunk.sourceLocations[0].pageNumber===2);
  expect(secondSection?.coverage).toMatchObject({kind:'PAGE',overlapPrefixLength:0});
  expect(secondPage?.coverage).toMatchObject({kind:'PAGE',overlapPrefixLength:0});
  expect(plan.chunks.every(chunk=>!(chunk.content.includes('# First')&&chunk.content.includes('# Second')))).toBe(true);
 });

 it('caps compatibility section titles at a complete 180-UTF16-unit grapheme without changing text or heading locations',async()=>{
  const source=sourceFor('DOCX');
  const heading='👩‍🔬'.repeat(38);
  const text=`# ${heading}\nbody text`;
  const extraction=extractionFor(source,{pages:[{pageNumber:null,text,sectionTitle:null,requiresReview:false}]});
  extraction.locations.pages[0]={kind:'DOCX',blockStart:1,blockEnd:1,headingPath:[heading],tableIndex:null};
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counterFor());
  const expected=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(heading))
   .reduce((value,item)=>value.length+item.segment.length<=180?value+item.segment:value,'');
  expect(plan.chunks[0].sectionTitle).toBe(expected);
  expect(plan.chunks[0].sectionTitle?.length).toBeLessThanOrEqual(180);
  expect(plan.chunks[0].content).toBe(text);
  expect(plan.chunks[0].sourceLocations[0]).toEqual({kind:'DOCX',blockStart:1,blockEnd:1,headingPath:[heading],tableIndex:null});
 });

 it.each(['PDF','DOCX','XLSX','CSV','HTML'] as const)('includes empty-page tables losslessly for %s',async format=>{
  const source=sourceFor(format);
  const rows=[['fee',''],['','500']];
  const extraction=extractionFor(source,{rows});
  const counter=counterFor(text=>text.includes('\n')?513:1);
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counter);
  const chunks=plan.chunks.filter(chunk=>chunk.coverage.kind==='TABLE');
  expect(chunks).toHaveLength(2);
  expect(chunks.map(chunk=>chunk.content)).toEqual(['row 1: ["fee",""]','row 2: ["","500"]']);
  expect(chunks.map(chunk=>chunk.coverage)).toEqual([
   {kind:'TABLE',index:0,rowStartIndex:0,rowEndIndex:0},{kind:'TABLE',index:0,rowStartIndex:1,rowEndIndex:1},
  ]);
  expect(chunks.every(chunk=>chunk.sourceLocations.length===1)).toBe(true);
  if(format==='CSV'||format==='XLSX'){
   expect(chunks.map(chunk=>chunk.sourceLocations[0])).toMatchObject([{rowStart:1,rowEnd:1},{rowStart:2,rowEnd:2}]);
  }
 });

 it('fails closed when one atomic table row exceeds the exact token limit',async()=>{
  const source=sourceFor('CSV');const extraction=extractionFor(source,{rows:[['one row']]});
  const counter=counterFor(()=>513);
  await expect(buildLocatedChunkPlan(source,extraction,binding,counter)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_TABLE_ROW_TOO_LARGE'});
 });

 it('rejects a table row that cannot fit the UTF-8 request bound without calling the counter',async()=>{
  const source=sourceFor('CSV');const extraction=extractionFor(source,{rows:[['ก'.repeat(2100)]]});
  const counter=counterFor();
  await expect(buildLocatedChunkPlan(source,extraction,binding,counter)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_TABLE_ROW_TOO_LARGE'});
  expect(counter.calls).toHaveLength(0);
 });

 it('validates binding and the exact E5 identity before counting',async()=>{
  const source=sourceFor('PDF');const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'evidence',sectionTitle:null,requiresReview:false}]});
  const wrongCounter=counterFor();const wrongIdentity={...wrongCounter,modelId:'other-model'};
  const invalidBindingCounter=counterFor();
  await expect(buildLocatedChunkPlan(source,extraction,{jobId:'not-a-uuid',extractionRevision:7},invalidBindingCounter)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_INPUT_INVALID'});
  await expect(buildLocatedChunkPlan(source,extraction,{...binding,extractionRevision:0},counterFor())).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_INPUT_INVALID'});
  await expect(buildLocatedChunkPlan(source,extraction,binding,wrongIdentity)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_SPACE_INVALID'});
  expect(invalidBindingCounter.calls).toHaveLength(0);
  expect(wrongCounter.calls).toHaveLength(0);
 });

 it('rejects malformed count results instead of accepting or truncating them',async()=>{
  const source=sourceFor('PDF');const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'evidence',sectionTitle:null,requiresReview:false}]});
  const counter={...counterFor(),async countPassageTokens(){return [0];}};
  await expect(buildLocatedChunkPlan(source,extraction,binding,counter)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_COUNTER_INVALID'});
 });

 it('recounts exact final overlap-inclusive text and keeps the final count on each draft',async()=>{
  const source=sourceFor('PDF');const text='a'.repeat(1250);
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text,sectionTitle:null,requiresReview:false}]});
  const counter=counterFor(value=>Math.ceil(value.length/2));
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counter,{overlapCharacters:17});
  const observed=new Map(counter.calls.flatMap(batch=>batch.map(value=>[value,Math.ceil(value.length/2)] as const)));
  expect(plan.chunks.every(chunk=>chunk.passageTokenCount===observed.get(chunk.content))).toBe(true);
  expect(plan.chunks.some(chunk=>chunk.coverage.kind==='PAGE'&&chunk.coverage.overlapPrefixLength===17)).toBe(true);
 });

 it('enforces the six-thousand-byte request bound while splitting dense Unicode',async()=>{
  const source=sourceFor('PDF');const text='ก'.repeat(2200);
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text,sectionTitle:null,requiresReview:false}]});
  const counter=counterFor(value=>Math.ceil(encoder.encode(value).byteLength/2));
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counter,{overlapCharacters:0});
  expect(counter.calls.flat().every(value=>encoder.encode(value).byteLength<=6000)).toBe(true);
  expect(plan.chunks.every(chunk=>chunk.passageTokenCount<=512)).toBe(true);
  expect(plan.chunks.map(chunk=>chunk.content).join('')).toBe(text);
 });

 it('sends count requests in bounded batches of at most sixteen',async()=>{
  const source=sourceFor('PDF');
  const pages=Array.from({length:20},(_value,index)=>({pageNumber:index+1,text:`page ${index+1}`,sectionTitle:null,requiresReview:false}));
  const extraction=extractionFor(source,{pages});const counter=counterFor();
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counter);
  expect(plan.chunks).toHaveLength(20);
  expect(counter.calls.length).toBeGreaterThanOrEqual(2);
  expect(counter.calls.every(batch=>batch.length<=16)).toBe(true);
 });

 it('fails without returning a partial plan when the configured chunk bound is reached',async()=>{
  const source=sourceFor('PDF');const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'a'.repeat(1300),sectionTitle:null,requiresReview:false}]});
  await expect(buildLocatedChunkPlan(source,extraction,binding,counterFor(value=>Math.ceil(value.length/2)),{maxChunks:1})).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_LIMIT_EXCEEDED'});
 });

 it('binds deterministic digest to the reviewed tuple and ordered content',async()=>{
  const source=sourceFor('CSV');const extraction=extractionFor(source,{rows:[['a',''],['b','2']]});
  const first=await buildLocatedChunkPlan(source,extraction,binding,counterFor());
  const repeat=await buildLocatedChunkPlan(source,extraction,binding,counterFor());
  const otherBinding=await buildLocatedChunkPlan(source,extraction,{...binding,jobId:otherJobId},counterFor());
  const changed=extractionFor(source,{rows:[['a',''],['b','3']]});
  const changedPlan=await buildLocatedChunkPlan(source,changed,binding,counterFor());
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(repeat.digest).toBe(first.digest);
  expect(otherBinding.digest).not.toBe(first.digest);
  expect(changedPlan.digest).not.toBe(first.digest);
 });

 it('binds source locations into the digest',async()=>{
  const source=sourceFor('PDF');const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'same words',sectionTitle:null,requiresReview:false}]});
  const original=await buildLocatedChunkPlan(source,extraction,binding,counterFor());
  const moved=structuredClone(extraction);moved.locations.pages[0]={kind:'PDF',pageNumber:1,blockStart:2,blockEnd:2,tableIndex:null};
  const relocated=await buildLocatedChunkPlan(source,moved,binding,counterFor());
  expect(relocated.chunks[0].content).toBe(original.chunks[0].content);
  expect(relocated.digest).not.toBe(original.digest);
 });

 it('copies parser warnings and location data without granting review or retaining caller references',async()=>{
  const source=sourceFor('PDF');const location=pageLocation('PDF',0);
  const warning:ExtractionWarning={code:'PAGE_REVIEW_REQUIRED',severity:'REVIEW',location,count:1,disposition:'UNRESOLVED'};
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'needs a human review',sectionTitle:null,requiresReview:false}],warnings:[warning]});
  const original=structuredClone(extraction);
  const plan=await buildLocatedChunkPlan(source,extraction,binding,counterFor());
  expect(plan.warnings).toEqual([warning]);
  expect(plan.chunks[0].requiresReview).toBe(true);
  expect(plan.warnings).not.toBe(extraction.report.warnings);
  expect(plan.chunks[0].sourceLocations).not.toBe(extraction.locations.pages);
  plan.warnings[0].count=2;
  if(plan.chunks[0].sourceLocations[0].kind==='PDF')plan.chunks[0].sourceLocations[0].pageNumber=2;
  expect(extraction).toEqual(original);
 });

 it('does not silently drop a nonempty whitespace-only narrative page',async()=>{
  const source=sourceFor('PDF');
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'   \r\n',sectionTitle:null,requiresReview:false},
   {pageNumber:2,text:'usable content',sectionTitle:null,requiresReview:false}]});
  const counter=counterFor();
  await expect(buildLocatedChunkPlan(source,extraction,binding,counter)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_INPUT_INVALID'});
  expect(counter.calls).toHaveLength(0);
 });

 it('rejects a valid scanned-empty extraction without counting or returning an empty plan',async()=>{
  const source=sourceFor('PDF');const location=pageLocation('PDF',0);
  const warning:ExtractionWarning={code:'LOW_TEXT_QUALITY',severity:'REVIEW',location,count:1,disposition:'UNRESOLVED'};
  const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'',sectionTitle:null,requiresReview:true}],warnings:[warning]});
  const counter=counterFor();
  await expect(buildLocatedChunkPlan(source,extraction,binding,counter)).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_INPUT_INVALID'});
  expect(counter.calls).toHaveLength(0);
 });

 it('limits the entire operation and settles even when a counter ignores cancellation',async()=>{
  const source=sourceFor('PDF');const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'slow count',sectionTitle:null,requiresReview:false}]});
  const counter={...counterFor(),countPassageTokens:()=>new Promise<number[]>(()=>{})};
  await expect(buildLocatedChunkPlan(source,extraction,binding,counter,{timeoutMs:10})).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_TIMEOUT'});
 });

 it('honors caller cancellation while a counter ignores its signal',async()=>{
  const source=sourceFor('PDF');const extraction=extractionFor(source,{pages:[{pageNumber:1,text:'slow count',sectionTitle:null,requiresReview:false}]});
  const controller=new AbortController();
  const counter={...counterFor(),countPassageTokens:()=>new Promise<number[]>(()=>{})};
  const pending=buildLocatedChunkPlan(source,extraction,binding,counter,{signal:controller.signal,timeoutMs:1000});
  controller.abort();
  await expect(pending).rejects.toMatchObject({code:'KNOWLEDGE_PLAN_ABORTED'});
 });
});
