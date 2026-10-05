import type {CompatibleHttpResponse,PinnedHttpsRequest} from './compatible-network';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {AIProviderError} from './types';

const signalError=(signal:AbortSignal,status?:number)=>new AIProviderError(
 signal.reason instanceof DOMException&&signal.reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED',status);
const singleHeader=(value:string|string[]|undefined,max=256):string|null=>typeof value==='string'&&value.length<=max?value:null;

/** Internal socket boundary. Production callers must supply the pin from the public resolver. */
export function createPinnedHttpsRequest(options:{requestImpl?:typeof httpsRequest}={}):PinnedHttpsRequest{
 const request=options.requestImpl??httpsRequest;
 return input=>new Promise<CompatibleHttpResponse>((resolve,reject)=>{
  const {signal}=input;let settled=false,status:number|undefined,req:ClientRequest|undefined,res:IncomingMessage|undefined;
  const finish=(error:AIProviderError|null,result?:CompatibleHttpResponse)=>{
   if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);
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
     bytes+=chunk.byteLength;
     if(bytes>input.maxResponseBytes){finish(new AIProviderError('INVALID_OUTPUT',status));return;}
     chunks.push(chunk);
    });
    response.on('end',()=>{
     ended=true;if(settled)return;
     if(signal.aborted){onAbort();return;}
     try{
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
      finish(null,{status:status!,contentType,retryAfter,json:JSON.parse(text)});
     }catch{finish(new AIProviderError('INVALID_OUTPUT',status));}
    });
   });
   req.on('error',()=>finish(signal.aborted?signalError(signal,status):new AIProviderError('PROVIDER_UNAVAILABLE',status)));
   if(signal.aborted){onAbort();return;}
   req.end(input.body??undefined);
  }catch{finish(signal.aborted?signalError(signal,status):new AIProviderError('PROVIDER_UNAVAILABLE',status));}
 });
}
