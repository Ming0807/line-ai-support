import {EmbeddingServiceError,type EmbeddingCallOptions,type EmbeddingProvider} from './embedding-client';
import {LOCAL_EMBEDDING_DIMENSION,LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from './embedding-space';
import type {LocatedChunkPlan} from './located-plan-types';
import {validateLocatedChunkPlan} from './located-plan-validation';

const MAX_BATCH=16;
const MAX_TIMEOUT_MS=45_000;
const VECTOR_NORM_TOLERANCE=0.001;

export type LocatedEmbeddingPreparationErrorCode='KNOWLEDGE_EMBEDDING_INPUT_INVALID'|'KNOWLEDGE_EMBEDDING_SPACE_INVALID'|
 'KNOWLEDGE_EMBEDDING_TIMEOUT'|'KNOWLEDGE_EMBEDDING_ABORTED'|'KNOWLEDGE_EMBEDDING_UNAVAILABLE';

export class LocatedEmbeddingPreparationError extends Error {
 constructor(public readonly code:LocatedEmbeddingPreparationErrorCode){super(code);this.name='LocatedEmbeddingPreparationError';}
}

interface CheckedOptions {signal?:AbortSignal;timeoutMs:number}
interface FixedIdentity {modelId:string;revision:string;dimension:number;fingerprint:string;embedPassages:EmbeddingProvider['embedPassages']}

function fail(code:LocatedEmbeddingPreparationErrorCode):never{
 throw new LocatedEmbeddingPreparationError(code);
}

function isRecord(value:unknown):value is Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

function checkedOptions(value:EmbeddingCallOptions|undefined):CheckedOptions{
 if(value===undefined)return {timeoutMs:MAX_TIMEOUT_MS};
 try{
  if(!isRecord(value)||Object.keys(value).some(key=>key!=='signal'&&key!=='timeoutMs'))return fail('KNOWLEDGE_EMBEDDING_INPUT_INVALID');
  const timeoutMs=value.timeoutMs??MAX_TIMEOUT_MS,signal=value.signal;
  if(typeof timeoutMs!=='number'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_TIMEOUT_MS||
   signal!==undefined&&(!isRecord(signal)||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))
   return fail('KNOWLEDGE_EMBEDDING_INPUT_INVALID');
  return {signal:signal as AbortSignal|undefined,timeoutMs};
 }catch(error){
  if(error instanceof LocatedEmbeddingPreparationError)throw error;
  return fail('KNOWLEDGE_EMBEDDING_INPUT_INVALID');
 }
}

function fixedProvider(provider:EmbeddingProvider):FixedIdentity{
 try{
  if(!isRecord(provider)||provider.modelId!==LOCAL_EMBEDDING_MODEL||provider.revision!==LOCAL_EMBEDDING_REVISION||
   provider.dimension!==LOCAL_EMBEDDING_DIMENSION||provider.fingerprint!==LOCAL_EMBEDDING_FINGERPRINT||typeof provider.embedPassages!=='function')
   return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
  return {modelId:provider.modelId as string,revision:provider.revision as string,dimension:provider.dimension as number,
   fingerprint:provider.fingerprint as string,embedPassages:provider.embedPassages as EmbeddingProvider['embedPassages']};
 }catch(error){
  if(error instanceof LocatedEmbeddingPreparationError)throw error;
  return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
 }
}

function identityStillFixed(provider:EmbeddingProvider,identity:FixedIdentity):boolean{
 try{return provider.modelId===identity.modelId&&provider.revision===identity.revision&&provider.dimension===identity.dimension&&
  provider.fingerprint===identity.fingerprint&&provider.embedPassages===identity.embedPassages;}catch{return false;}
}

function clonedVectors(value:unknown,expected:number):number[][]{
 try{
  if(!Array.isArray(value)||value.length!==expected)return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
  return value.map(candidate=>{
   if(!Array.isArray(candidate)||candidate.length!==LOCAL_EMBEDDING_DIMENSION)return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
   const vector=candidate.map(item=>{
    if(typeof item!=='number'||!Number.isFinite(item))return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
    return item;
   });
   if(Math.abs(Math.hypot(...vector)-1)>VECTOR_NORM_TOLERANCE)return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
   return vector;
  });
 }catch(error){
  if(error instanceof LocatedEmbeddingPreparationError)throw error;
  return fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
 }
}

function providerFailure(error:unknown):LocatedEmbeddingPreparationError{
 if(error instanceof LocatedEmbeddingPreparationError)return error;
 if(error instanceof EmbeddingServiceError){
  if(error.code==='EMBEDDING_TIMEOUT')return new LocatedEmbeddingPreparationError('KNOWLEDGE_EMBEDDING_TIMEOUT');
  if(error.code==='EMBEDDING_ABORTED')return new LocatedEmbeddingPreparationError('KNOWLEDGE_EMBEDDING_ABORTED');
 }
 return new LocatedEmbeddingPreparationError('KNOWLEDGE_EMBEDDING_UNAVAILABLE');
}

/** Embeds the exact validated located passages; it never rechunks, recounts, persists or publishes them. */
export async function embedLocatedChunkPlan(input:unknown,provider:EmbeddingProvider,options?:EmbeddingCallOptions):Promise<{plan:LocatedChunkPlan;embeddings:number[][]}>{
 const startedAt=performance.now();
 let plan:LocatedChunkPlan;
 try{plan=structuredClone(validateLocatedChunkPlan(input));}catch{fail('KNOWLEDGE_EMBEDDING_INPUT_INVALID');}
 const checked=checkedOptions(options),identity=fixedProvider(provider),deadline=startedAt+checked.timeoutMs;
 if(checked.signal?.aborted)fail('KNOWLEDGE_EMBEDDING_ABORTED');
 if(deadline-performance.now()<1)fail('KNOWLEDGE_EMBEDDING_TIMEOUT');

 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let cancellationError:LocatedEmbeddingPreparationError|undefined;
 let settled=false;
 let rejectCancellation:(error:LocatedEmbeddingPreparationError)=>void=()=>{};
 const cancellation=new Promise<never>((_resolve,reject)=>{rejectCancellation=reject;});
 void cancellation.catch(()=>undefined);
 const cancel=(code:'KNOWLEDGE_EMBEDDING_TIMEOUT'|'KNOWLEDGE_EMBEDDING_ABORTED')=>{
  if(settled)return;
  settled=true;cancellationError=new LocatedEmbeddingPreparationError(code);controller.abort();rejectCancellation(cancellationError);
 };
 const onAbort=()=>cancel('KNOWLEDGE_EMBEDDING_ABORTED');
 const remaining=deadline-performance.now();
 if(checked.signal){
  checked.signal.addEventListener('abort',onAbort,{once:true});
  if(checked.signal.aborted)onAbort();
 }
 if(!cancellationError)timer=setTimeout(()=>cancel('KNOWLEDGE_EMBEDDING_TIMEOUT'),remaining);
 const embeddings:number[][]=[];

 try{
  for(let start=0;start<plan.chunks.length;start+=MAX_BATCH){
   const left=deadline-performance.now();
   if(checked.signal?.aborted)cancel('KNOWLEDGE_EMBEDDING_ABORTED');
   else if(left<1)cancel('KNOWLEDGE_EMBEDDING_TIMEOUT');
   if(cancellationError)throw cancellationError;
   if(!identityStillFixed(provider,identity))fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
   const batch=plan.chunks.slice(start,start+MAX_BATCH),passages=batch.map(chunk=>chunk.content);
   let response:unknown;
   try{
    response=await Promise.race([Promise.resolve().then(()=>identity.embedPassages.call(provider,[...passages],{
     signal:controller.signal,timeoutMs:Math.max(1,Math.floor(deadline-performance.now())),
    })),cancellation]);
   }catch(error){throw providerFailure(error);}
   if(checked.signal?.aborted)cancel('KNOWLEDGE_EMBEDDING_ABORTED');
   else if(deadline-performance.now()<1)cancel('KNOWLEDGE_EMBEDDING_TIMEOUT');
   if(cancellationError)throw cancellationError;
   if(!identityStillFixed(provider,identity))fail('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
   embeddings.push(...clonedVectors(response,batch.length));
  }
  return {plan,embeddings};
 }catch(error){
  throw providerFailure(error);
 }finally{
  settled=true;
  if(timer!==undefined)clearTimeout(timer);
  checked.signal?.removeEventListener('abort',onAbort);
  controller.abort();
 }
}
