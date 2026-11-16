import 'server-only';
import {z} from 'zod';
import {loadImportPreviewSnapshot} from './import-extraction';
import {ImportStagingError} from './import-staging';
import {OCR_LOW_CONFIDENCE,OCR_MAX_PAGES,OCR_MODEL,OCR_REVISION,OcrError,readOcrConfig,requestPdfOcr,type OcrConfig,type OcrResult} from './ocr-client';
import type {LocatedExtraction} from './types';

/**
 * OCR-IMP-01: drafts text for scanned PDF pages that the parser marked OCR_REQUIRED. Nothing is stored here:
 * the reviewer puts the draft into the existing page editor, corrects it and saves an EDITED revision, and the
 * unchanged publication contract still requires that edit and a CORRECTED disposition.
 */
export type ImportOcrDeps={
 config:OcrConfig|null;
 loadSnapshot:(actor:string,id:string,options:{signal?:AbortSignal})=>Promise<{source:{format:string;bytes:Uint8Array};preview:{job:{revision:number};extraction:Pick<LocatedExtraction,'pages'|'report'>}}>;
 ocr:(config:OcrConfig,pdf:Uint8Array,pages:number[],options?:{signal?:AbortSignal})=>Promise<OcrResult>;
};
export type ImportOcrDraft={
 model:{name:string;revision:string};lowConfidenceBelow:number;
 pages:{pageIndex:number;pageNumber:number;text:string;lineCount:number;meanConfidence:number|null;lowConfidence:{line:number;text:string;confidence:number}[]}[];
};
const inputSchema=z.strictObject({revision:z.number().int().min(0).max(999_999_999),pages:z.array(z.number().int().min(0).max(999)).min(1).max(OCR_MAX_PAGES)});

/** Page indexes whose text must be supplied by a reviewer: an OCR_REQUIRED warning or an empty page that needs review. */
export function ocrRequiredPageIndexes(extraction:Pick<LocatedExtraction,'pages'|'report'>):number[]{
 const flagged=new Set(extraction.report.warnings.filter(w=>w.code==='OCR_REQUIRED'&&w.location?.kind==='PDF').map(w=>(w.location as {pageNumber:number}).pageNumber));
 return extraction.pages.flatMap((page,index)=>page.pageNumber!==null&&(flagged.has(page.pageNumber)||(page.requiresReview&&!page.text.trim()))?[index]:[]);
}

export async function draftImportOcr(actor:string,id:string,input:{revision:number;pages:number[]},deps:ImportOcrDeps,signal?:AbortSignal):Promise<ImportOcrDraft>{
 if(!deps.config)throw new OcrError('UNAVAILABLE');
 const parsed=inputSchema.safeParse(input);
 if(!parsed.success||new Set(parsed.data.pages).size!==parsed.data.pages.length)throw new ImportStagingError('INVALID_REQUEST');
 const {source,preview}=await deps.loadSnapshot(actor,id,{signal});
 if(preview.job.revision!==parsed.data.revision)throw new ImportStagingError('CONFLICT');
 if(source.format!=='PDF')throw new ImportStagingError('INVALID_REQUEST');
 const eligible=new Set(ocrRequiredPageIndexes(preview.extraction));
 const indexes=[...parsed.data.pages].sort((a,b)=>a-b);
 if(indexes.some(index=>!eligible.has(index)))throw new ImportStagingError('INVALID_REQUEST');
 const numbers=indexes.map(index=>preview.extraction.pages[index].pageNumber as number);
 const result=await deps.ocr(deps.config,source.bytes,numbers,{signal});
 if(result.model!==OCR_MODEL||result.revision!==OCR_REVISION)throw new OcrError('INVALID');
 return {model:{name:result.model,revision:result.revision},lowConfidenceBelow:OCR_LOW_CONFIDENCE,pages:result.pages.map((page,position)=>{
  const confidences=page.lines.map(line=>line.confidence);
  return {pageIndex:indexes[position],pageNumber:page.pageNumber,text:page.text,lineCount:page.lines.length,
   meanConfidence:confidences.length?Math.round(1e4*confidences.reduce((a,b)=>a+b,0)/confidences.length)/1e4:null,
   lowConfidence:page.lines.flatMap((line,lineIndex)=>line.confidence<OCR_LOW_CONFIDENCE?[{line:lineIndex+1,text:line.text,confidence:line.confidence}]:[])};
 })};
}

/** Route entry: production dependencies only; nothing here is accepted from the request. */
export function draftImportOcrForRoute(actor:string,id:string,input:{revision:number;pages:number[]},options:{signal?:AbortSignal}={}):Promise<ImportOcrDraft>{
 return draftImportOcr(actor,id,input,{config:readOcrConfig(),loadSnapshot:(a,i,o)=>loadImportPreviewSnapshot(a,i,o),ocr:requestPdfOcr},options.signal);
}
