import {AIProviderError,type ProviderApiFormat} from './types';

export interface PriceQuery {
 adapter:string;baseUrl:string;modelId:string;purpose:'GENERATION'|'EMBEDDING';
}
export interface ModelPricing {
 status:'FREE'|'PAID'|'UNKNOWN';inputPricePerMillion:number|null;outputPricePerMillion:number|null;
 checkedAt:string;apiFormat:ProviderApiFormat|null;
}
export type PriceReader=(query:PriceQuery,signal:AbortSignal)=>Promise<ModelPricing>;
const OPENROUTER='https://openrouter.ai/api/v1';
const ZEN='https://opencode.ai/zen/v1';
const MAX_BYTES=8*1024*1024;
const MAX_METADATA_MS=10_000;
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>typeof value==='object'&&value!==null&&!Array.isArray(value);
function price(value:unknown):number|null {
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&(value.length>64||!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)))return null;
 const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:null;
}
function unknown():ModelPricing {
 return {status:'UNKNOWN',inputPricePerMillion:null,outputPricePerMillion:null,checkedAt:new Date().toISOString(),apiFormat:null};
}
function fromPrices(value:unknown,inputKey:string,outputKey:string,multiplier:number,apiFormat:ProviderApiFormat|null):ModelPricing {
 if(!object(value)||!Object.hasOwn(value,inputKey)||!Object.hasOwn(value,outputKey))return unknown();
 const values=Object.values(value).map(price),input=price(value[inputKey]),output=price(value[outputKey]);
 if(!values.length||values.includes(null)||input===null||output===null||
  !Number.isFinite(input*multiplier)||!Number.isFinite(output*multiplier))return unknown();
 return {status:values.some(value=>value!>0)?'PAID':'FREE',inputPricePerMillion:input*multiplier,
  outputPricePerMillion:output*multiplier,checkedAt:new Date().toISOString(),apiFormat};
}
function catalogModel(catalog:unknown,modelId:string):ObjectValue|null {
 if(!object(catalog)||!Array.isArray(catalog.data)||catalog.data.length>20_000)return null;
 const matches=catalog.data.filter(value=>object(value)&&value.id===modelId);
 return matches.length===1?matches[0] as ObjectValue:null;
}
function httpError(status:number):AIProviderError {
 return new AIProviderError(status===429?'RATE_LIMITED':status>=500?'SERVER_ERROR':
  status===401||status===403?'AUTH_ERROR':'PROVIDER_UNAVAILABLE',status);
}

/** Public, fixed-host catalogs only. This reader never receives or sends an API key. */
export function createPriceReader(options:{fetchImpl?:typeof fetch}={}):PriceReader {
 const fetchImpl=options.fetchImpl??fetch;
 return async(query,outer)=>{
  if(outer.aborted)throw new AIProviderError('CANCELLED');
  const base=query.baseUrl.replace(/\/+$/,'');
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(query.modelId)||
   (query.purpose!=='GENERATION'&&query.purpose!=='EMBEDDING')||
   !((query.adapter==='OPENROUTER'&&base===OPENROUTER)||(query.adapter==='ZEN'&&base===ZEN)))return unknown();
  if(query.adapter==='ZEN'&&query.purpose==='EMBEDDING')return unknown();

  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let cancel=()=>{};
  const boundary=new Promise<never>((_resolve,reject)=>{
   cancel=()=>{reject(new AIProviderError('CANCELLED'));controller.abort();void reader?.cancel().catch(()=>undefined);};
   outer.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>{reject(new AIProviderError('TIMEOUT'));controller.abort();void reader?.cancel().catch(()=>undefined);},MAX_METADATA_MS);
  });
  async function readCatalog(url:string):Promise<unknown> {
   if(controller.signal.aborted)throw new AIProviderError(outer.aborted?'CANCELLED':'TIMEOUT');
   const response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>undefined);throw new AIProviderError(outer.aborted?'CANCELLED':'TIMEOUT');}
   if(!response.ok){void response.body?.cancel().catch(()=>undefined);throw httpError(response.status);}
   const length=response.headers.get('content-length');
   if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES)){
    void response.body?.cancel().catch(()=>undefined);throw new AIProviderError('INVALID_OUTPUT',response.status);
   }
   if(!response.body)throw new AIProviderError('INVALID_OUTPUT',response.status);
   reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
   try{
    while(true){
     if(controller.signal.aborted)throw new AIProviderError(outer.aborted?'CANCELLED':'TIMEOUT');
     const chunk=await reader.read();if(chunk.done)break;
     if(!(chunk.value instanceof Uint8Array)||(bytes+=chunk.value.byteLength)>MAX_BYTES)
      throw new AIProviderError('INVALID_OUTPUT',response.status);
     chunks.push(chunk.value);
    }
    const buffer=new Uint8Array(bytes);let offset=0;
    for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}
    catch{throw new AIProviderError('INVALID_OUTPUT',response.status);}
   }finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();reader=undefined;}
  }
  async function work():Promise<ModelPricing> {
   if(query.adapter==='OPENROUTER'){
    const model=catalogModel(await readCatalog(`${OPENROUTER}/${query.purpose==='EMBEDDING'?'embeddings/':''}models`),query.modelId);
    return model?fromPrices(model.pricing,'prompt','completion',1_000_000,'CHAT'):unknown();
   }
   const metadata=await readCatalog('https://models.dev/api.json');
   const available=await readCatalog(`${ZEN}/models`);
   if(!object(metadata)||!object(metadata.opencode)||metadata.opencode.api!==ZEN||
    !object(metadata.opencode.models)||!catalogModel(available,query.modelId))return unknown();
   const model=metadata.opencode.models[query.modelId];
   if(!object(model)||model.id!==query.modelId)return unknown();
   const npm=object(model.provider)?model.provider.npm:metadata.opencode.npm;
   const apiFormat=npm==='@ai-sdk/openai'?'RESPONSES':npm==='@ai-sdk/openai-compatible'?'CHAT':null;
   if(apiFormat===null)return unknown();
   return fromPrices(model.cost,'input','output',1,apiFormat);
  }
  try{return await Promise.race([boundary,Promise.resolve().then(work)]);}
  catch(error){throw error instanceof AIProviderError?error:new AIProviderError('PROVIDER_UNAVAILABLE');}
  finally{if(timer)clearTimeout(timer);outer.removeEventListener('abort',cancel);controller.abort();void reader?.cancel().catch(()=>undefined);}
 };
}
