import type {CompatibleHttpResponse,PinnedHttpsRequest} from './compatible-network';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest,IncomingMessage} from 'node:http';
import type {TLSSocket} from 'node:tls';
import {AIProviderError} from './types';

export interface PinnedHttpsObservation {
 phase:'TCP_CONNECTED'|'TLS_AUTHORIZED'|'REQUEST_FINISH'|'RESPONSE_HEADERS'|'FIRST_BODY_CHUNK'|'RESPONSE_END'|'FAILED';
 elapsedMs:number;httpStatus?:number;errorCode?:AIProviderError['code'];
}

const signalError=(signal:AbortSignal,status?:number)=>new AIProviderError(
 signal.reason instanceof DOMException&&signal.reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED',status);
const singleHeader=(value:string|string[]|undefined,max=256):string|null=>typeof value==='string'&&value.length<=max?value:null;

/** Internal socket boundary. Production callers must supply the pin from the public resolver. */
export function createPinnedHttpsRequest(options:{requestImpl?:typeof httpsRequest;observe?:(event:PinnedHttpsObservation)=>void}={}):PinnedHttpsRequest{
 const request=options.requestImpl??httpsRequest;
 return input=>new Promise<CompatibleHttpResponse>((resolve,reject)=>{
  const {signal}=input;let settled=false,status:number|undefined,req:ClientRequest|undefined,res:IncomingMessage|undefined;
  const started=performance.now();
  const observe=(phase:PinnedHttpsObservation['phase'],errorCode?:AIProviderError['code'])=>{
   if(settled||!options.observe)return;
   try{options.observe({phase,elapsedMs:Math.max(0,performance.now()-started),
    ...(status===undefined?{}:{httpStatus:status}),...(errorCode===undefined?{}:{errorCode})});}catch{ /* Diagnostics never control transport. */ }
  };
  const finish=(error:AIProviderError|null,result?:CompatibleHttpResponse)=>{
   if(settled)return;if(error)observe('FAILED',error.code);settled=true;signal.removeEventListener('abort',onAbort);
   if(error){reject(error);res?.destroy();req?.destroy();}
   else if(result){resolve(result);if(result.status<200||result.status>=300){res?.destroy();req?.destroy();}}
  };
  const onAbort=()=>finish(signalError(signal,status));
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  try{
   req=request({protocol:'https:',hostname:input.url.hostname,port:443,path:input.url.pathname,method:input.method,
    headers:input.headers,agent:false,servername:input.url.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2',
    insecureHTTPParser:false,maxHeaderSize:16*1024,
    lookup:(_hostname,lookupOptions,callback)=>{
     if(signal.aborted){callback(Object.assign(new Error('CANCELLED'),{code:'ECANCELED'}),'');return;}
     const pin=input.pinnedAddress;
     if(lookupOptions.all)callback(null,[{address:pin.address,family:pin.family}]);
     else callback(null,pin.address,pin.family);
    },
   },response=>{
    res=response;
    // No raw error details escape this boundary, even after abort/redirect destruction.
    response.on('error',()=>finish(new AIProviderError('PROVIDER_UNAVAILABLE',status)));
    if(settled){response.destroy();return;}
    status=response.statusCode;
    if(!Number.isInteger(status)||status===undefined||status<100||status>599){finish(new AIProviderError('PROVIDER_UNAVAILABLE'));return;}
    observe('RESPONSE_HEADERS');
    const contentType=singleHeader(response.headers['content-type']),retryAfter=singleHeader(response.headers['retry-after'],128);
    if(status<200||status>=300){finish(null,{status,contentType,retryAfter,json:null});return;}
    if(!contentType||!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType)||
     (response.headers['content-encoding']!==undefined&&response.headers['content-encoding']!=='identity')){
     finish(new AIProviderError('INVALID_OUTPUT',status));return;
    }
    const length=response.headers['content-length'];
    if(length!==undefined&&(typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>input.maxResponseBytes)){
     finish(new AIProviderError('INVALID_OUTPUT',status));return;
    }
    let bytes=0,ended=false;const chunks:Buffer[]=[];
    response.on('aborted',()=>finish(new AIProviderError('PROVIDER_UNAVAILABLE',status)));
    response.on('close',()=>{if(!ended)finish(new AIProviderError('PROVIDER_UNAVAILABLE',status));});
    response.on('data',(chunk:Buffer)=>{
     if(settled)return;
     if(!Buffer.isBuffer(chunk)){finish(new AIProviderError('INVALID_OUTPUT',status));return;}
     if(bytes===0&&chunk.byteLength>0)observe('FIRST_BODY_CHUNK');
     bytes+=chunk.byteLength;
     if(bytes>input.maxResponseBytes){finish(new AIProviderError('INVALID_OUTPUT',status));return;}
     chunks.push(chunk);
    });
    response.on('end',()=>{
     ended=true;if(settled)return;
     observe('RESPONSE_END');
     if(signal.aborted){onAbort();return;}
     try{
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
      finish(null,{status:status!,contentType,retryAfter,json:JSON.parse(text)});
     }catch{finish(new AIProviderError('INVALID_OUTPUT',status));}
    });
   });
   req.once('socket',socket=>{
    socket.once('connect',()=>observe('TCP_CONNECTED'));
    socket.once('secureConnect',()=>{if((socket as TLSSocket).authorized===true)observe('TLS_AUTHORIZED');});
   });
   req.once('finish',()=>observe('REQUEST_FINISH'));
   req.on('error',()=>finish(signal.aborted?signalError(signal,status):new AIProviderError('PROVIDER_UNAVAILABLE',status)));
   if(signal.aborted){onAbort();return;}
   req.end(input.body??undefined);
  }catch{finish(signal.aborted?signalError(signal,status):new AIProviderError('PROVIDER_UNAVAILABLE',status));}
 });
}
