import {request as httpsRequest} from 'node:https';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {createBrotliDecompress,createGunzip,createInflate} from 'node:zlib';
import {pipeline,type Transform} from 'node:stream';
import {isIP} from 'node:net';
import {AIProviderError} from '../ai/types';
import {isPublicAddress,resolvePublicAddresses,type ResolvedAddress} from '../ai/public-addresses';
import {createImportSource,isOfficialYruUrl} from './source';
import {IMPORT_LIMITS,type ImportSource} from './types';

const MAX_URL_LENGTH=2048;
const MAX_QUERY_LENGTH=1024;
const MAX_REDIRECTS=3;
const TOTAL_TIMEOUT_MS=10_000;
const MAX_HEADER_VALUE=2048;
const invalid=():never=>{throw new OfficialUrlImportError('IMPORT_URL_INVALID');};

export type OfficialUrlImportErrorCode='IMPORT_URL_INVALID'|'IMPORT_URL_UNAVAILABLE'|'IMPORT_URL_TIMEOUT'|'IMPORT_URL_CANCELLED'|
 'IMPORT_URL_TOO_LARGE'|'IMPORT_URL_REDIRECT_LIMIT'|'IMPORT_URL_CONTENT_TYPE_UNSUPPORTED'|'IMPORT_URL_CONTENT_MISMATCH';
export class OfficialUrlImportError extends Error {
 constructor(readonly code:OfficialUrlImportErrorCode){super(code);this.name='OfficialUrlImportError';}
}
export interface OfficialUrlAcquisition {
 readonly source:ImportSource;
 /** Canonicalized input URL, retained independently from any redirect target. */
 readonly requestedUrl:string;
 /** Canonical URL that supplied the bytes and becomes ImportSource.sourceUrl. */
 readonly finalUrl:string;
 /** Canonical URL sequence from requested URL through final URL, including both ends. */
 readonly redirectChain:string[];
}
interface PinnedRequestInput {url:URL;pinnedAddress:ResolvedAddress;signal:AbortSignal}
interface PinnedResponse {
 status:number;location:string|null;contentType:string|null;contentDisposition:string|null;contentEncoding:string|null;
 body:AsyncIterable<Uint8Array>;cancel:()=>void;
}
type Resolver=(hostname:string,signal:AbortSignal)=>Promise<readonly ResolvedAddress[]>;
type Transport=(input:PinnedRequestInput)=>Promise<PinnedResponse>;
export interface OfficialUrlTestOptions {
 /** Test-only DNS boundary; production always uses the fresh system A/AAAA resolver. */
 resolvePublicAddresses?:Resolver;
 /** Test-only pinned transport boundary; production uses native HTTPS with TLS/SNI. */
 transport?:Transport;
 /** Test-only native HTTPS request seam for proving socket/SNI pinning without live traffic. */
 requestImpl?:typeof httpsRequest;
 /** Test-only clock for persisted fetch time. */
 now?:()=>number;
}
export interface OfficialUrlOptions {signal?:AbortSignal;testOnly?:OfficialUrlTestOptions}
interface Clock {now:()=>number}
const MIME_FORMATS={
 'application/pdf':{extension:'pdf',mimeType:'application/pdf'},
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{extension:'docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{extension:'xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
 'text/csv':{extension:'csv',mimeType:'text/csv'},'application/csv':{extension:'csv',mimeType:'text/csv'},
 'text/plain':{extension:'csv',mimeType:'text/csv'},'application/vnd.ms-excel':{extension:'csv',mimeType:'text/csv'},
 'text/html':{extension:'html',mimeType:'text/html'},
} as const;
type SupportedExtension=keyof typeof EXTENSION_FORMATS;
const EXTENSION_FORMATS={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',html:'text/html',htm:'text/html'} as const;

function codeFromSignal(signal:AbortSignal):OfficialUrlImportError {
 return new OfficialUrlImportError(signal.reason instanceof DOMException&&signal.reason.name==='TimeoutError'?'IMPORT_URL_TIMEOUT':'IMPORT_URL_CANCELLED');
}
function safeNetworkError(error:unknown,signal:AbortSignal):OfficialUrlImportError {
 if(signal.aborted)return codeFromSignal(signal);
 if(error instanceof OfficialUrlImportError)return error;
 if(error instanceof AIProviderError){
  if(error.code==='TIMEOUT')return new OfficialUrlImportError('IMPORT_URL_TIMEOUT');
  if(error.code==='CANCELLED')return new OfficialUrlImportError('IMPORT_URL_CANCELLED');
 }
 return new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');
}
function raceSignal<T>(work:Promise<T>,signal:AbortSignal,onLateValue?:(value:T)=>void):Promise<T> {
 const discard=(value:T)=>{try{onLateValue?.(value);}catch{}};
 if(signal.aborted){void work.then(discard,()=>undefined);return Promise.reject(codeFromSignal(signal));}
 return new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>signal.removeEventListener('abort',onAbort);
  const onAbort=()=>{if(settled)return;settled=true;cleanup();reject(codeFromSignal(signal));};
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  work.then(value=>{if(settled){discard(value);return;}settled=true;cleanup();resolve(value);},error=>{
   if(settled)return;settled=true;cleanup();reject(error);
  });
 });
}
function canonicalizeOfficialUrl(input:string,base?:URL):URL {
 if(typeof input!=='string'||input.length<1||input.length>MAX_URL_LENGTH||/[\s\\\u0000-\u001f\u007f]/u.test(input)||input.includes('#')||/%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/iu.test(input))return invalid();
 let url:URL;
 try{url=base?new URL(input,base):new URL(input);}catch{return invalid();}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port!==''||url.hash||url.search.length>MAX_QUERY_LENGTH||
  isIP(host)!==0||host.length>253||host!=='yru.ac.th'&&!host.endsWith('.yru.ac.th')||
  host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))||
  !isOfficialYruUrl(url.href))return invalid();
 return url;
}
function header(value:string|string[]|undefined,max:number):string|null {
 if(typeof value!=='string'||value.length>max||/[\r\n\u0000]/u.test(value))return null;
 return value;
}
function decoderFor(encoding:string|null):Transform|null {
 if(encoding===null||encoding===''||encoding==='identity')return null;
 if(encoding==='gzip')return createGunzip({chunkSize:64*1024});
 if(encoding==='deflate')return createInflate({chunkSize:64*1024});
 if(encoding==='br')return createBrotliDecompress({chunkSize:64*1024});
 throw new OfficialUrlImportError('IMPORT_URL_CONTENT_TYPE_UNSUPPORTED');
}
function decodedBody(response:IncomingMessage,decoder:Transform|null,signal:AbortSignal,cleanup:()=>void):AsyncIterable<Uint8Array> {
 const source=decoder??response;
 // Pipeline forwards source errors to the decoder and destroys both streams.
 // Its callback consumes completion errors; the iterator below emits only fixed codes.
 if(decoder)pipeline(response,decoder,()=>undefined);
 return {async *[Symbol.asyncIterator](){
  try{
   for await(const chunk of source){
    if(signal.aborted)throw codeFromSignal(signal);
    if(!(chunk instanceof Uint8Array))throw new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');
    yield Uint8Array.from(chunk);
   }
  }catch(error){throw safeNetworkError(error,signal);}
  finally{cleanup();}
 }};
}
/** Native transport keeps the TLS hostname/SNI while routing the socket to exactly one vetted address. */
function createPinnedTransport(requestImpl:typeof httpsRequest=httpsRequest):Transport {
 return input=>new Promise<PinnedResponse>((resolve,reject)=>{
  const {url,signal,pinnedAddress}=input;
  let request:ClientRequest|undefined,response:IncomingMessage|undefined,decoder:Transform|null=null,settled=false,headersReceived=false;
  const cleanup=()=>signal.removeEventListener('abort',onAbort);
  const destroy=()=>{try{decoder?.destroy();}catch{}try{response?.destroy();}catch{}try{request?.destroy();}catch{}cleanup();};
  const fail=(error:OfficialUrlImportError)=>{if(settled)return;settled=true;destroy();reject(error);};
  const onAbort=()=>{
   if(!headersReceived){fail(codeFromSignal(signal));return;}
   destroy();
  };
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  try{
   request=requestImpl({protocol:'https:',hostname:url.hostname,servername:url.hostname,port:443,path:`${url.pathname}${url.search}`,
    method:'GET',headers:{accept:'application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv, text/html;q=0.9, application/octet-stream;q=0.5',
     'accept-encoding':'gzip, deflate, br'},agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',insecureHTTPParser:false,maxHeaderSize:16*1024,
    lookup:(_hostname,lookupOptions,callback)=>{
     if(signal.aborted){callback(Object.assign(new Error('aborted'),{code:'ECANCELED'}),'');return;}
     if(lookupOptions.all)callback(null,[{address:pinnedAddress.address,family:pinnedAddress.family}]);
     else callback(null,pinnedAddress.address,pinnedAddress.family);
    }},incoming=>{
    response=incoming;headersReceived=true;
    const status=incoming.statusCode;
    if(!Number.isInteger(status)||status===undefined||status<100||status>599){fail(new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE'));return;}
    const location=header(incoming.headers.location,MAX_HEADER_VALUE);
    const contentType=header(incoming.headers['content-type'],200);
    const contentDisposition=header(incoming.headers['content-disposition'],512);
    const contentEncodingValue=header(incoming.headers['content-encoding'],64);
    if((incoming.headers['content-encoding']!==undefined&&contentEncodingValue===null)||
     (incoming.headers['content-type']!==undefined&&contentType===null)){fail(new OfficialUrlImportError('IMPORT_URL_CONTENT_TYPE_UNSUPPORTED'));return;}
    const contentEncoding=contentEncodingValue?.trim().toLowerCase()??null;
    try{decoder=decoderFor(contentEncoding);}catch(error){fail(safeNetworkError(error,signal));return;}
    if(settled){destroy();return;}
    settled=true;
    const body=decodedBody(incoming,decoder,signal,cleanup);
    resolve({status,location,contentType,contentDisposition,contentEncoding,body,cancel:destroy});
   });
   request.on('error',()=>{if(!headersReceived)fail(safeNetworkError(undefined,signal));else destroy();});
   if(signal.aborted){onAbort();return;}
   request.end();
  }catch{fail(safeNetworkError(undefined,signal));}
 });
}
function extensionOf(value:string|null):string|null {
 if(!value)return null;
 const name=value.split(/[\\/]/u).at(-1)??'';
 const extension=name.includes('.')?name.slice(name.lastIndexOf('.')+1).toLowerCase():'';
 return extension||null;
}
function dispositionFilename(value:string|null):string|null {
 if(!value)return null;
 let raw:string|undefined;
 const encoded=/(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]*)/iu.exec(value);
 if(encoded){try{raw=decodeURIComponent(encoded[1]!);}catch{return null;}}
 else{
  const quoted=/(?:^|;)\s*filename\s*=\s*"([^"]{1,180})"/iu.exec(value);
  const plain=/(?:^|;)\s*filename\s*=\s*([^;\s]{1,180})/iu.exec(value);
  raw=quoted?.[1]??plain?.[1];
 }
 return raw&&raw.length<=512?raw:null;
}
function safeFilename(candidate:string|null,extension:string):string {
 if(candidate){
  let value=candidate.split(/[\\/]/u).at(-1)??'';
  value=value.replace(/[\u0000-\u001f\u007f<>:"|?*]/gu,'_').trim();
  const existing=extensionOf(value);
  if(value.length>0&&value.length<=180&&existing===extension&&value!=='.'+extension&&value!=='..'+'.'+extension)return value;
 }
 return `document.${extension}`;
}
function selectFormat(contentType:string|null,disposition:string|null,url:URL):{mimeType:string;extension:string} {
 const mime=contentType?.split(';',1)[0]?.trim().toLowerCase()??'';
 const candidate=dispositionFilename(disposition);
 const ext=extensionOf(candidate)??extensionOf(decodePathname(url.pathname));
 const candidateMime=ext&&Object.hasOwn(EXTENSION_FORMATS,ext)?EXTENSION_FORMATS[ext as SupportedExtension]:undefined;
 if(mime==='application/octet-stream'){
  if(!candidateMime)return invalid();
  return {mimeType:candidateMime,extension:ext==='htm'?'html':ext!};
 }
 const format=MIME_FORMATS[mime as keyof typeof MIME_FORMATS];
 if(!format)throw new OfficialUrlImportError('IMPORT_URL_CONTENT_TYPE_UNSUPPORTED');
 if(candidateMime&&candidateMime!==format.mimeType)throw new OfficialUrlImportError('IMPORT_URL_CONTENT_MISMATCH');
 return {mimeType:format.mimeType,extension:format.extension};
}
function decodePathname(pathname:string):string|null {
 const segment=pathname.split('/').at(-1)??'';
 try{return decodeURIComponent(segment);}catch{return null;}
}
function validateAddresses(value:readonly ResolvedAddress[]):ResolvedAddress[] {
 if(!Array.isArray(value)||value.length<1||value.length>64||value.some(address=>!isPublicAddress(address)))
  throw new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');
 return [...value];
}
function onceCancelled(value:PinnedResponse):PinnedResponse {
 let cancelled=false;
 return {...value,cancel:()=>{if(cancelled)return;cancelled=true;try{value.cancel();}catch{}}};
}
function createSource(bytes:Uint8Array,filename:string,mimeType:string,sourceUrl:string,fetchedAt:string):ImportSource {
 if(mimeType==='text/csv'){
  const text=new TextDecoder().decode(bytes.subarray(0,Math.min(bytes.byteLength,4096)));
  if(new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-'||bytes[0]===0x50&&bytes[1]===0x4b||
   /^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/iu.test(text))
   throw new OfficialUrlImportError('IMPORT_URL_CONTENT_MISMATCH');
 }
 try{return createImportSource({bytes,filename,mimeType,sourceUrl,acquiredFrom:'URL',fetchedAt});}
 catch{throw new OfficialUrlImportError('IMPORT_URL_CONTENT_MISMATCH');}
}
async function readBoundedBody(response:PinnedResponse,signal:AbortSignal):Promise<Uint8Array> {
 const iterator=response.body[Symbol.asyncIterator](),chunks:Uint8Array[]=[];
 let total=0,done=false;
 try{
  while(true){
   const item=await raceSignal(Promise.resolve().then(()=>iterator.next()),signal);
   if(item.done){done=true;break;}
   if(!(item.value instanceof Uint8Array)||item.value.byteLength+total>IMPORT_LIMITS.originalBytes)
    throw new OfficialUrlImportError('IMPORT_URL_TOO_LARGE');
   total+=item.value.byteLength;chunks.push(Uint8Array.from(item.value));
  }
 }catch(error){throw safeNetworkError(error,signal);}
 finally{
  if(!done){response.cancel();void iterator.return?.().catch(()=>undefined);}
 }
 if(total<1)throw new OfficialUrlImportError('IMPORT_URL_CONTENT_MISMATCH');
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}
function fetchedAt(clock:Clock):string {
 const value=clock.now();if(!Number.isFinite(value)||value<0)throw new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');
 try{return new Date(value).toISOString();}catch{throw new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');}
}

/** Fetch one official YRU source with fresh DNS pinning on every redirect and a total 10-second deadline. */
export async function acquireOfficialUrl(requested:string,options:OfficialUrlOptions={}):Promise<OfficialUrlAcquisition> {
 let current=canonicalizeOfficialUrl(requested);
 const requestedUrl=current.href,redirectChain=[requestedUrl],controller=new AbortController();
 const outer=options.signal;let timeout=false;
 const onOuterAbort=()=>controller.abort(outer?.reason??new DOMException('','AbortError'));
 if(outer?.aborted)onOuterAbort();else outer?.addEventListener('abort',onOuterAbort,{once:true});
 const timer=setTimeout(()=>{timeout=true;controller.abort(new DOMException('','TimeoutError'));},TOTAL_TIMEOUT_MS);
 const resolver=options.testOnly?.resolvePublicAddresses??resolvePublicAddresses;
 const transport=options.testOnly?.transport??createPinnedTransport(options.testOnly?.requestImpl);
 const clock:Clock={now:options.testOnly?.now??Date.now};
 let redirects=0,response:PinnedResponse|undefined;
 try{
  if(controller.signal.aborted)throw codeFromSignal(controller.signal);
  while(true){
   if(controller.signal.aborted)throw codeFromSignal(controller.signal);
   const addresses=validateAddresses(await raceSignal(Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw codeFromSignal(controller.signal);
    return resolver(current.hostname,controller.signal);
   }),controller.signal));
   if(controller.signal.aborted)throw codeFromSignal(controller.signal);
   response=onceCancelled(await raceSignal(Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw codeFromSignal(controller.signal);
    return transport({url:current,pinnedAddress:addresses[0]!,signal:controller.signal});
   }),controller.signal,value=>{if(value&&typeof value==='object'&&typeof value.cancel==='function')value.cancel();}));
   if([301,302,303,307,308].includes(response.status)){
    const location=response.location;
    response.cancel();response=undefined;
    if(redirects>=MAX_REDIRECTS)throw new OfficialUrlImportError('IMPORT_URL_REDIRECT_LIMIT');
    if(location===null)throw new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');
    current=canonicalizeOfficialUrl(location,current);
    redirectChain.push(current.href);redirects++;
    continue;
   }
   if(response.status!==200){response.cancel();response=undefined;throw new OfficialUrlImportError('IMPORT_URL_UNAVAILABLE');}
   const selected=selectFormat(response.contentType,response.contentDisposition,current);
   const filename=safeFilename(dispositionFilename(response.contentDisposition)??decodePathname(current.pathname),selected.extension);
   const bytes=await readBoundedBody(response,controller.signal);response=undefined;
   if(controller.signal.aborted)throw codeFromSignal(controller.signal);
   const finalUrl=current.href,source=createSource(bytes,filename,selected.mimeType,finalUrl,fetchedAt(clock));
   if(controller.signal.aborted)throw codeFromSignal(controller.signal);
   return {source,requestedUrl,finalUrl,redirectChain};
  }
 }catch(error){
  response?.cancel();
  if(timeout)throw new OfficialUrlImportError('IMPORT_URL_TIMEOUT');
  throw safeNetworkError(error,controller.signal);
 }finally{
  clearTimeout(timer);outer?.removeEventListener('abort',onOuterAbort);
 }
}
