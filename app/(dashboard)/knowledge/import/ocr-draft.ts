/** OCR-IMP-01 review-form helpers (pure, client-safe). The server re-checks eligibility. */
type PageLike={pageNumber:number|null;text:string;requiresReview:boolean};
type WarningLike={code:string;location:{kind:string;pageNumber?:number}|null};
export type OcrDraftPage={pageIndex:number;text:string};

export function ocrEligiblePages(extraction:{pages:PageLike[];report:{warnings:WarningLike[]}}):number[]{
 const flagged=new Set(extraction.report.warnings.filter(w=>w.code==='OCR_REQUIRED'&&w.location?.kind==='PDF').map(w=>w.location?.pageNumber));
 return extraction.pages.flatMap((page,index)=>page.pageNumber!==null&&(flagged.has(page.pageNumber)||(page.requiresReview&&!page.text.trim()))?[index]:[]);
}

/** Fills only pages the reviewer has not typed into; a reviewer's own text is never overwritten. */
export function applyOcrDrafts(extraction:{pages:PageLike[]},drafts:Record<number,string>,result:{pages:OcrDraftPage[]}):{drafts:Record<number,string>;applied:number[];skipped:number[]}{
 const next={...drafts},applied:number[]=[],skipped:number[]=[];
 for(const page of result.pages){
  const original=extraction.pages[page.pageIndex]?.text;
  if(original===undefined)continue;
  const current=drafts[page.pageIndex];
  if(current!==undefined&&current!==original&&current.trim()!==''){skipped.push(page.pageIndex);continue;}
  next[page.pageIndex]=page.text;applied.push(page.pageIndex);
 }
 return {drafts:next,applied,skipped};
}

export type OcrPageReport={meanConfidence:number|null;lowConfidence:{line:number;text:string;confidence:number}[]};
export type OcrDraftResponse={pages:(OcrDraftPage&OcrPageReport)[]};
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const isUnit=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
/** Accepts only the server's draft shape; anything else is treated as a failure. */
export function parseOcrDraft(body:unknown):OcrDraftResponse|null{
 if(!isRecord(body)||!Array.isArray(body.pages)||body.pages.length>20)return null;
 const pages:OcrDraftResponse['pages']=[];
 for(const page of body.pages){
  if(!isRecord(page)||!Number.isInteger(page.pageIndex)||typeof page.text!=='string'||!(page.meanConfidence===null||isUnit(page.meanConfidence))||!Array.isArray(page.lowConfidence))return null;
  const low=[];
  for(const line of page.lowConfidence){
   if(!isRecord(line)||!Number.isInteger(line.line)||typeof line.text!=='string'||!isUnit(line.confidence))return null;
   low.push({line:line.line as number,text:line.text,confidence:line.confidence});
  }
  pages.push({pageIndex:page.pageIndex as number,text:page.text,meanConfidence:page.meanConfidence as number|null,lowConfidence:low});
 }
 return {pages};
}
