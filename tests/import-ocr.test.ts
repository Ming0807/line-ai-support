import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {OCR_MODEL,OCR_REVISION,OcrError,readOcrConfig,requestPdfOcr,type OcrConfig} from '../lib/imports/ocr-client';
import {draftImportOcr,type ImportOcrDeps} from '../lib/imports/import-ocr';
import {ImportStagingError} from '../lib/imports/import-staging';
import {applyOcrDrafts,ocrEligiblePages} from '../app/(dashboard)/knowledge/import/ocr-draft';

const mocks=vi.hoisted(()=>({apiStaffId:vi.fn(),authorize:vi.fn(),draft:vi.fn()}));
vi.mock('../lib/tickets/api',async original=>({...await original<typeof import('../lib/tickets/api')>(),apiStaffId:mocks.apiStaffId}));
vi.mock('../lib/imports/import-staging',async original=>({...await original<typeof import('../lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('../lib/imports/import-ocr',async original=>({...await original<typeof import('../lib/imports/import-ocr')>(),draftImportOcrForRoute:mocks.draft}));
import {POST as ocrRoute} from '../app/api/knowledge/imports/[id]/ocr/route';

const pdf=new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
const config:OcrConfig={url:'http://127.0.0.1:8010',key:null};
function ocrBody(pages:number[],overrides:Record<string,unknown>={}){
 return {model:OCR_MODEL,revision:OCR_REVISION,pages:pages.map(page=>({page,text:`หน้า ${page}\nค่าบำรุง ๖,๐๐๐ บาท\n๑๐O Uาท`,
  lines:[{text:`หน้า ${page}`,confidence:0.97},{text:'ค่าบำรุง ๖,๐๐๐ บาท',confidence:0.95},{text:'๑๐O Uาท',confidence:0.853}]})),...overrides};
}
function jsonResponse(body:unknown,init:ResponseInit={}){return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'},...init});}

describe('OCR-IMP-01 OCR service configuration',()=>{
 it('is off unless explicitly enabled with a valid endpoint',()=>{
  expect(readOcrConfig({})).toBeNull();
  expect(readOcrConfig({OCR_API_URL:'http://127.0.0.1:8010'})).toBeNull();
  expect(readOcrConfig({KNOWLEDGE_IMPORT_OCR_ENABLED:'true',OCR_API_URL:'http://127.0.0.1:8010'})).toEqual({url:'http://127.0.0.1:8010',key:null});
  expect(readOcrConfig({KNOWLEDGE_IMPORT_OCR_ENABLED:'true',OCR_API_URL:'http://localhost:8010/'})).toEqual({url:'http://localhost:8010',key:null});
 });
 it('allows plain http only on loopback and requires a key for https',()=>{
  const on={KNOWLEDGE_IMPORT_OCR_ENABLED:'true'};
  for(const url of ['http://10.0.0.5:8010','http://ocr.example.edu','https://ocr.example.edu','https://u:p@ocr.example.edu','http://127.0.0.1:8010/x','http://127.0.0.1:8010?a=1','ftp://127.0.0.1','not a url'])
   expect(readOcrConfig({...on,OCR_API_URL:url}),url).toBeNull();
  expect(readOcrConfig({...on,OCR_API_URL:'https://ocr.example.edu',OCR_API_KEY:'k'.repeat(32)})).toEqual({url:'https://ocr.example.edu',key:'k'.repeat(32)});
  expect(readOcrConfig({...on,OCR_API_URL:'https://ocr.example.edu',OCR_API_KEY:'short'})).toBeNull();
 });
});

describe('OCR-IMP-01 requestPdfOcr',()=>{
 it('posts the raw PDF with the page list and validates the pinned model output',async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>jsonResponse(ocrBody([2,5])));
  const result=await requestPdfOcr({...config,key:'k'.repeat(32)},pdf,[2,5],{fetch});
  const [url,init]=fetch.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:8010/ocr/pdf');
  const headers=new Headers(init?.headers);
  expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');expect(init?.cache).toBe('no-store');
  expect(headers.get('content-type')).toBe('application/pdf');expect(headers.get('x-yru-pages')).toBe('2,5');
  expect(headers.get('authorization')).toBe(`Bearer ${'k'.repeat(32)}`);
  expect(result.pages.map(page=>page.pageNumber)).toEqual([2,5]);
  expect(result.pages[0].lines[2]).toEqual({text:'๑๐O Uาท',confidence:0.853});
 });
 it('rejects invalid page lists before any request',async()=>{
  const fetch=vi.fn();
  for(const pages of [[],[0],[3,2],[2,2],Array.from({length:21},(_,i)=>i+1),[1.5],[1001]])
   await expect(requestPdfOcr(config,pdf,pages as number[],{fetch})).rejects.toBeInstanceOf(OcrError);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('fails closed on HTTP errors, wrong model/revision, page mismatch, bad shapes and oversized bodies',async()=>{
  const cases:Response[]=[
   new Response('busy',{status:503}),new Response('{}',{status:200,headers:{'content-type':'text/html'}}),
   jsonResponse(ocrBody([2],{model:'other/model'})),jsonResponse(ocrBody([2],{revision:'0'.repeat(40)})),
   jsonResponse(ocrBody([3])),jsonResponse({...ocrBody([2]),extra:true}),
   jsonResponse(ocrBody([2],{pages:[{page:2,text:'x',lines:[{text:'x',confidence:1.5}]}]})),
   new Response(new Uint8Array(4*1024*1024+1),{status:200,headers:{'content-type':'application/json'}}),
  ];
  for(const response of cases)
   await expect(requestPdfOcr(config,pdf,[2],{fetch:vi.fn(async()=>response)})).rejects.toBeInstanceOf(OcrError);
  await expect(requestPdfOcr(config,pdf,[2],{fetch:vi.fn(async()=>{throw new Error('ECONNREFUSED');})})).rejects.toBeInstanceOf(OcrError);
 });
 it('times out a hung service',async()=>{
  const fetch=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
  await expect(requestPdfOcr(config,pdf,[1],{fetch:fetch as unknown as typeof globalThis.fetch,timeoutMs:20})).rejects.toBeInstanceOf(OcrError);
 });
});

function snapshot(options:{format?:'PDF'|'DOCX';revision?:number}={}){
 const pages=[{pageNumber:1,text:'ข้อความเดิม',requiresReview:false,sectionTitle:null},
  {pageNumber:2,text:'',requiresReview:true,sectionTitle:null},{pageNumber:3,text:'',requiresReview:true,sectionTitle:null}];
 return {source:{format:options.format??'PDF',bytes:pdf},preview:{job:{id:randomUUID(),revision:options.revision??4},
  extraction:{pages,report:{warnings:[{code:'OCR_REQUIRED',severity:'BLOCKING',location:{kind:'PDF',pageNumber:2},count:1},
   {code:'OCR_REQUIRED',severity:'BLOCKING',location:{kind:'PDF',pageNumber:3},count:1}]}}}};
}
function deps(overrides:Partial<ImportOcrDeps>={}):ImportOcrDeps{
 return {config,loadSnapshot:vi.fn(async()=>snapshot()) as unknown as ImportOcrDeps['loadSnapshot'],
  ocr:vi.fn(async(_config:OcrConfig,_pdf:Uint8Array,pages:number[])=>({model:OCR_MODEL,revision:OCR_REVISION,
   pages:ocrBody(pages).pages.map(page=>({pageNumber:page.page,text:page.text,lines:page.lines}))})),...overrides};
}

describe('OCR-IMP-01 draftImportOcr',()=>{
 it('returns drafts only for OCR_REQUIRED pages, mapping page indexes and flagging low-confidence lines',async()=>{
  const d=deps();
  const result=await draftImportOcr('actor',randomUUID(),{revision:4,pages:[1,2]},d);
  expect(d.ocr).toHaveBeenCalledWith(config,pdf,[2,3],expect.anything());
  expect(result.model).toEqual({name:OCR_MODEL,revision:OCR_REVISION});
  expect(result.lowConfidenceBelow).toBe(0.9);
  expect(result.pages.map(page=>[page.pageIndex,page.pageNumber])).toEqual([[1,2],[2,3]]);
  expect(result.pages[0].lowConfidence).toEqual([{line:3,text:'๑๐O Uาท',confidence:0.853}]);
  expect(result.pages[0].text).toContain('๖,๐๐๐');
 });
 it('refuses a stale revision, a non-PDF source, pages that do not need OCR and too many pages without calling OCR',async()=>{
  const id=randomUUID();
  const cases:[Parameters<typeof draftImportOcr>[2],Partial<ImportOcrDeps>,string][]=[
   [{revision:3,pages:[1]},{},'CONFLICT'],
   [{revision:4,pages:[1]},{loadSnapshot:vi.fn(async()=>snapshot({format:'DOCX'})) as unknown as ImportOcrDeps['loadSnapshot']},'INVALID_REQUEST'],
   [{revision:4,pages:[0]},{},'INVALID_REQUEST'],[{revision:4,pages:[9]},{},'INVALID_REQUEST'],[{revision:4,pages:[]},{},'INVALID_REQUEST'],
   [{revision:4,pages:[1,1]},{},'INVALID_REQUEST'],[{revision:4,pages:Array.from({length:21},(_,i)=>i)},{},'INVALID_REQUEST'],
  ];
  for(const [input,override,code] of cases){
   const d=deps(override);
   await expect(draftImportOcr('actor',id,input,d)).rejects.toMatchObject({code});
   expect(d.ocr).not.toHaveBeenCalled();
  }
 });
 it('is unavailable without configuration and maps service failures to OcrError',async()=>{
  await expect(draftImportOcr('actor',randomUUID(),{revision:4,pages:[1]},deps({config:null}))).rejects.toBeInstanceOf(OcrError);
  await expect(draftImportOcr('actor',randomUUID(),{revision:4,pages:[1]},deps({ocr:vi.fn(async()=>{throw new OcrError('UNAVAILABLE');})}))).rejects.toBeInstanceOf(OcrError);
 });
});

const host='helpdesk.example.edu',jobId=randomUUID();
function routeRequest(body:unknown,options:{origin?:string|null;contentType?:string;raw?:string}={}){
 const headers:Record<string,string>={host,'x-forwarded-proto':'https','content-type':options.contentType??'application/json'};
 if(options.origin!==null)headers.origin=options.origin??`https://${host}`;
 return new Request(`https://${host}/api/knowledge/imports/${jobId}/ocr`,{method:'POST',headers,body:options.raw??JSON.stringify(body)});
}
const context={params:Promise.resolve({id:jobId})};
describe('OCR-IMP-01 POST /api/knowledge/imports/[id]/ocr',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('KNOWLEDGE_IMPORT_OCR_ENABLED','true');vi.stubEnv('OCR_API_URL','http://127.0.0.1:8010');
  mocks.apiStaffId.mockResolvedValue(randomUUID());mocks.authorize.mockResolvedValue(undefined);
  mocks.draft.mockResolvedValue({model:{name:OCR_MODEL,revision:OCR_REVISION},lowConfidenceBelow:0.9,pages:[]});
  vi.spyOn(console,'error').mockImplementation(()=>undefined);});
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
 it('is hidden when OCR is not configured',async()=>{
  vi.stubEnv('KNOWLEDGE_IMPORT_OCR_ENABLED','false');
  expect((await ocrRoute(routeRequest({revision:4,pages:[1]}),context)).status).toBe(404);expect(mocks.apiStaffId).not.toHaveBeenCalled();
 });
 it('checks origin, Staff, import admin, content type and a strict small body',async()=>{
  expect((await ocrRoute(routeRequest({revision:4,pages:[1]},{origin:'https://evil.example'}),context)).status).toBe(403);
  mocks.apiStaffId.mockResolvedValueOnce(null);
  expect((await ocrRoute(routeRequest({revision:4,pages:[1]}),context)).status).toBe(401);
  mocks.authorize.mockRejectedValueOnce(new ImportStagingError('NOT_FOUND'));
  expect((await ocrRoute(routeRequest({revision:4,pages:[1]}),context)).status).toBe(404);
  expect((await ocrRoute(routeRequest({revision:4,pages:[1]},{contentType:'text/plain'}),context)).status).toBe(400);
  expect((await ocrRoute(routeRequest({revision:4,pages:[1],extra:1}),context)).status).toBe(400);
  expect((await ocrRoute(routeRequest(null,{raw:'x'.repeat(5000)}),context)).status).toBe(413);
  expect(mocks.draft).not.toHaveBeenCalled();
 });
 it('returns the draft as private no-store JSON and maps OCR failure to 503',async()=>{
  const ok=await ocrRoute(routeRequest({revision:4,pages:[1]}),context);
  expect(ok.status).toBe(200);expect(ok.headers.get('cache-control')).toContain('no-store');
  expect(mocks.draft).toHaveBeenCalledWith(expect.any(String),jobId,{revision:4,pages:[1]},expect.anything());
  mocks.draft.mockRejectedValueOnce(new OcrError('UNAVAILABLE'));
  const failed=await ocrRoute(routeRequest({revision:4,pages:[1]}),context);
  expect(failed.status).toBe(503);expect(await failed.json()).toEqual({error:'OCR_UNAVAILABLE'});
 });
});

describe('OCR-IMP-01 review form helpers',()=>{
 const extraction=snapshot().preview.extraction;
 it('lists only pages the server would accept',()=>{expect(ocrEligiblePages(extraction as never)).toEqual([1,2]);});
 it('fills untouched pages and never overwrites a reviewer edit',()=>{
  const result=applyOcrDrafts(extraction as never,{2:'คนพิมพ์เองแล้ว'},{pages:[{pageIndex:1,text:'OCR หน้า 2'},{pageIndex:2,text:'OCR หน้า 3'}]});
  expect(result.drafts).toEqual({1:'OCR หน้า 2',2:'คนพิมพ์เองแล้ว'});
  expect(result.applied).toEqual([1]);expect(result.skipped).toEqual([2]);
 });
});

describe('OCR-IMP-01 draft response parser',()=>{
 it('accepts the server draft shape and rejects anything else',async()=>{
  const {parseOcrDraft}=await import('../app/(dashboard)/knowledge/import/ocr-draft');
  const good={pages:[{pageIndex:1,pageNumber:2,text:'x',lineCount:1,meanConfidence:0.9,lowConfidence:[{line:1,text:'x',confidence:0.8}]}]};
  expect(parseOcrDraft(good)?.pages[0]).toEqual({pageIndex:1,text:'x',meanConfidence:0.9,lowConfidence:[{line:1,text:'x',confidence:0.8}]});
  for(const bad of [null,{},{pages:'x'},{pages:[{pageIndex:'1',text:'x',meanConfidence:null,lowConfidence:[]}]},{pages:[{pageIndex:1,text:'x',meanConfidence:2,lowConfidence:[]}]},
   {pages:[{pageIndex:1,text:'x',meanConfidence:null,lowConfidence:[{line:1,text:'x',confidence:-1}]}]}])expect(parseOcrDraft(bad)).toBeNull();
 });
});
