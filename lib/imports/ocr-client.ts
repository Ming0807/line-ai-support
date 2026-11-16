import 'server-only';
import {z} from 'zod';

/**
 * OCR-IMP-01 client for the private local OCR service (`services/ocr`). Output is a draft for a human
 * reviewer, never publishable text by itself. Document text is never logged.
 */
export const OCR_MODEL='iapp/OpenThai2.0-OCR-Text';
export const OCR_REVISION='40e8e9ff752b65153b1a71d521ec9390882afd7e';
export const OCR_MAX_PAGES=20;
export const OCR_LOW_CONFIDENCE=0.9;
const MAX_RESPONSE_BYTES=4*1024*1024;
const loopbacks=new Set(['127.0.0.1','localhost','[::1]']);

export class OcrError extends Error{constructor(public readonly code:'UNAVAILABLE'|'INVALID'){super(`OCR_${code}`);}}
export type OcrConfig={url:string;key:string|null};
export type OcrLine={text:string;confidence:number};
export type OcrPage={pageNumber:number;text:string;lines:OcrLine[]};
export type OcrResult={model:string;revision:string;pages:OcrPage[]};

export function readOcrConfig(env:Record<string,string|undefined>=process.env):OcrConfig|null{
 if(env.KNOWLEDGE_IMPORT_OCR_ENABLED!=='true'||!env.OCR_API_URL)return null;
 let url:URL;try{url=new URL(env.OCR_API_URL);}catch{return null;}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')return null;
 const key=env.OCR_API_KEY?.length?env.OCR_API_KEY:null;
 if(key!==null&&(key.length<16||key.length>512||/\s/u.test(key)))return null;
 if(url.protocol==='http:'){if(!loopbacks.has(url.hostname))return null;}
 else if(url.protocol!=='https:'||key===null)return null;
 return {url:url.origin,key};
}

const responseSchema=z.strictObject({model:z.string(),revision:z.string(),pages:z.array(z.strictObject({
 page:z.number().int().min(1).max(1000),text:z.string().max(1_000_000),
 lines:z.array(z.strictObject({text:z.string().max(2000),confidence:z.number().min(0).max(1)})).max(500),
})).min(1).max(OCR_MAX_PAGES)});

function validPages(pages:number[]):boolean{
 return Array.isArray(pages)&&pages.length>=1&&pages.length<=OCR_MAX_PAGES&&
  pages.every((page,index)=>Number.isInteger(page)&&page>=1&&page<=1000&&(index===0||page>pages[index-1]));
}
async function readBounded(response:Response):Promise<Uint8Array>{
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_RESPONSE_BYTES))throw new OcrError('INVALID');
 if(!response.body)throw new OcrError('INVALID');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>MAX_RESPONSE_BYTES){await reader.cancel().catch(()=>undefined);throw new OcrError('INVALID');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}

/** `pageNumbers` are 1-based, strictly ascending, at most 20. Runs outside any SQL transaction. */
export async function requestPdfOcr(config:OcrConfig,pdf:Uint8Array,pageNumbers:number[],
 options:{fetch?:typeof globalThis.fetch;signal?:AbortSignal;timeoutMs?:number}={}):Promise<OcrResult>{
 if(!validPages(pageNumbers)||!(pdf instanceof Uint8Array)||pdf.byteLength===0)throw new OcrError('INVALID');
 const timeout=options.timeoutMs??Math.min(90_000,10_000+5_000*pageNumbers.length);
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeout);
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 try{
  const headers:Record<string,string>={'Content-Type':'application/pdf','X-Yru-Pages':pageNumbers.join(','),Accept:'application/json'};
  if(config.key)headers.Authorization=`Bearer ${config.key}`;
  let response:Response;
  try{response=await (options.fetch??globalThis.fetch)(`${config.url}/ocr/pdf`,{method:'POST',headers,body:new Uint8Array(pdf),
   redirect:'error',cache:'no-store',signal:controller.signal});}
  catch{throw new OcrError('UNAVAILABLE');}
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);throw new OcrError('UNAVAILABLE');}
  if(!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??'')){void response.body?.cancel().catch(()=>undefined);throw new OcrError('INVALID');}
  let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(response)));}
  catch(error){if(error instanceof OcrError)throw error;throw new OcrError(controller.signal.aborted?'UNAVAILABLE':'INVALID');}
  const parsed=responseSchema.safeParse(raw);
  if(!parsed.success||parsed.data.model!==OCR_MODEL||parsed.data.revision!==OCR_REVISION||
   parsed.data.pages.length!==pageNumbers.length||parsed.data.pages.some((page,index)=>page.page!==pageNumbers[index]))throw new OcrError('INVALID');
  return {model:parsed.data.model,revision:parsed.data.revision,pages:parsed.data.pages.map(page=>({pageNumber:page.page,text:page.text,lines:page.lines}))};
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
