import {z} from 'zod';
import {decryptValue} from '../security/identity';
import {AIProviderError,type AIMessage,type AITool,type AIStore,type AIProviderAdapter,type AIModelConfig,type ProviderResponse,type ProviderHealth} from './types';
import {createPriceReader,type PriceReader} from './pricing';
import {authorizeModelCost} from './cost-policy';
import {compareModelPriority,supportsGeneration,MODEL_REGISTRY_LIMIT,isModelCoolingDown} from './model-selection';

export interface GenerateInput<T> {
 taskType:string;messages:AIMessage[];responseSchema:z.ZodType<T>;responseName:string;
 tools?:AITool[];timeoutMs?:number;conversationId?:string;ticketId?:string;signal?:AbortSignal;
}
export interface GatewayOptions {store:AIStore;key:string;adapters:Record<string,AIProviderAdapter>;priceReader?:PriceReader}
const responseShape=z.object({output:z.unknown(),toolCalls:z.array(z.object({id:z.string().min(1).max(200),name:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),arguments:z.unknown()}).strict()).max(8),
 inputTokens:z.number().int().min(0).max(100_000_000).nullable(),outputTokens:z.number().int().min(0).max(100_000_000).nullable(),
 httpStatus:z.number().int().min(100).max(599).optional()}).strict();
const messageSchema=z.array(z.object({role:z.enum(['system','user','assistant']),content:z.string().min(1).max(20_000)}).strict()).min(1).max(32);

/** An ignoring adapter cannot extend the deadline; every timer/listener is released. */
async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,milliseconds:number,outer?:AbortSignal):Promise<T>{
 if(outer?.aborted)throw new AIProviderError('CANCELLED');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{
  abort=()=>{reject(new AIProviderError('CANCELLED'));controller.abort();};
  outer?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{reject(new AIProviderError('TIMEOUT'));controller.abort();},milliseconds);
 });
 try{return await Promise.race([boundary,Promise.resolve().then(()=>work(controller.signal))]);}
 finally{if(timer)clearTimeout(timer);outer?.removeEventListener('abort',abort);}
}
async function privateState<T>(work:()=>Promise<T>,milliseconds:number,signal?:AbortSignal):Promise<T>{
 try{return await bounded(work,milliseconds,signal);}
 catch(error){throw error instanceof AIProviderError?error:new AIProviderError('PROVIDER_UNAVAILABLE');}
}
const healthFor=(code:string):ProviderHealth=>code==='RATE_LIMITED'?'RATE_LIMITED':
 ['PROVIDER_UNAVAILABLE','MODEL_UNAVAILABLE','AUTH_ERROR'].includes(code)?'OFFLINE':'DEGRADED';
function cost(model:AIModelConfig,response:ProviderResponse):number|null {
 if(response.inputTokens===null||response.outputTokens===null||model.inputPricePerMillion===null||model.outputPricePerMillion===null)return null;
 return Math.round((response.inputTokens*model.inputPricePerMillion+response.outputTokens*model.outputPricePerMillion)/1_000_000*1e8)/1e8;
}

export async function generate<T>(input:GenerateInput<T>,options:GatewayOptions):Promise<{output:T|null;toolCalls:ProviderResponse['toolCalls'];providerId:string;modelId:string;fallbackUsed:boolean}> {
 const timeout=input.timeoutMs??20_000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>45_000||!/^[A-Z_]{1,32}$/.test(input.taskType)||!/^[A-Za-z0-9_-]{1,64}$/.test(input.responseName)||
  !messageSchema.safeParse(input.messages).success||input.messages.reduce((sum,message)=>sum+message.content.length,0)>40_000||
  (input.conversationId!==undefined&&!z.uuid().safeParse(input.conversationId).success)||(input.ticketId!==undefined&&!z.uuid().safeParse(input.ticketId).success))throw new AIProviderError('INVALID_REQUEST');
 if(input.signal?.aborted)throw new AIProviderError('CANCELLED');
 const tools=input.tools??[];
 if(tools.length>8||new Set(tools.map(tool=>tool.name)).size!==tools.length||tools.some(tool=>!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)))throw new AIProviderError('INVALID_REQUEST');
 let jsonSchema:Record<string,unknown>;
 try{jsonSchema=z.toJSONSchema(input.responseSchema,{target:'draft-7'}) as Record<string,unknown>;delete jsonSchema.$schema;}
 catch{throw new AIProviderError('INVALID_REQUEST');}
 const deadline=Date.now()+timeout;
 const registered=await privateState(()=>options.store.loadModels(),timeout,input.signal);
 const models=registered.filter(model=>supportsGeneration(model,tools.length>0)).sort(compareModelPriority).slice(0,MODEL_REGISTRY_LIMIT);
 if(!models.length)throw new AIProviderError('PROVIDER_UNAVAILABLE');
 let lastError=new AIProviderError('PROVIDER_UNAVAILABLE'),inferenceAttempts=0;
 const readPrice=options.priceReader??createPriceReader();
 for(let index=0;index<models.length&&inferenceAttempts<3;index++){
  if(input.signal?.aborted)throw new AIProviderError('CANCELLED');
  const remaining=deadline-Date.now();if(remaining<=0)throw new AIProviderError('TIMEOUT');
  const model=models[index],started=Date.now();let response:ProviderResponse|undefined,output:T|null=null,error:AIProviderError|undefined;
  if(isModelCoolingDown(model))continue;
  let inferred=false,observedStatus:number|undefined,pricedModel=model;
  const budget=Math.min(remaining,model.timeoutMs);
  try{
   const adapter=options.adapters[model.adapter];if(!adapter)throw new AIProviderError('PROVIDER_UNAVAILABLE');
   const raw=await bounded(async signal=>{
    const permission=await authorizeModelCost(model,'GENERATION',readPrice,signal);
    if(!permission)return null;
    if(signal.aborted)throw new AIProviderError(input.signal?.aborted?'CANCELLED':'TIMEOUT');
    const apiKey=decryptValue(model.apiKeyEncrypted,options.key);
    if(permission.pricing)pricedModel={...model,inputPricePerMillion:permission.pricing.inputPricePerMillion,
     outputPricePerMillion:permission.pricing.outputPricePerMillion};
    inferred=true;inferenceAttempts++;
    return adapter.generate({modelId:model.modelId,baseUrl:model.baseUrl,apiKey,
     messages:input.messages,responseSchema:{name:input.responseName,schema:jsonSchema},tools,signal,
     ...(['ZEN','OPENROUTER','COMPATIBLE'].includes(model.adapter)?{costMode:permission.costMode,apiFormat:permission.apiFormat}:{})});
   },budget,input.signal);
   if(raw===null)continue;
   observedStatus=z.number().int().min(100).max(599).safeParse(raw?.httpStatus).data;
   response=responseShape.parse(raw);
   if(response.toolCalls.some(call=>!tools.some(tool=>tool.name===call.name))||new Set(response.toolCalls.map(call=>call.id)).size!==response.toolCalls.length)throw new AIProviderError('INVALID_OUTPUT');
   if(response.output===null){if(!response.toolCalls.length)throw new AIProviderError('INVALID_OUTPUT');}
   else{const parsed=input.responseSchema.safeParse(response.output);if(!parsed.success)throw new AIProviderError('INVALID_OUTPUT');output=parsed.data;}
  }catch(caught){
   error=caught instanceof AIProviderError?caught:caught instanceof z.ZodError?new AIProviderError('INVALID_OUTPUT'):new AIProviderError('PROVIDER_UNAVAILABLE');
  }
  if(!inferred){
   if(error?.code==='CANCELLED'||(error?.code==='TIMEOUT'&&budget===remaining))throw error;
   if(error)lastError=error;
   continue;
  }
  // Persist observations only after provider HTTP completes; no business transaction spans generation.
  await privateState(()=>options.store.recordAttempt({providerId:model.providerId,modelId:model.id,requestType:input.taskType,purpose:'GENERATION',
   providerRevision:model.providerRevision,modelRevision:model.modelRevision,
   providerNetworkRevision:model.providerNetworkRevision,modelNetworkRevision:model.modelNetworkRevision,retryEvidence:error?.retryEvidence,
   conversationId:input.conversationId,ticketId:input.ticketId,latencyMs:Math.max(0,Date.now()-started),
   inputTokens:response?.inputTokens??null,outputTokens:response?.outputTokens??null,estimatedCost:response?cost(pricedModel,response):null,
   status:error?'ERROR':'SUCCESS',fallbackUsed:inferenceAttempts>1,errorCode:error?.code,httpStatus:error?.httpStatus??observedStatus,
   health:error?healthFor(error.code):'HEALTHY'}),Math.max(1,deadline-Date.now()),input.signal);
  if(!error)return {output,toolCalls:response!.toolCalls,providerId:model.providerId,modelId:model.id,fallbackUsed:inferenceAttempts>1};
  lastError=error;
  if(!error.retryable||(error.code==='TIMEOUT'&&budget===remaining))throw error;
 }
 throw lastError;
}
