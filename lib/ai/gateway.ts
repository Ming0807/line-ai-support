import {z} from 'zod';
import {decryptValue} from '../security/identity';
import {AIProviderError,type AIOutputSubreason,type AIMessage,type AITool,type AIStore,type AIProviderAdapter,type AIModelConfig,type ProviderResponse,type ProviderHealth} from './types';
import {createPriceReader,type PriceReader} from './pricing';
import {authorizeModelCost} from './cost-policy';
import {compareModelPriority,supportsGeneration,MODEL_REGISTRY_LIMIT,isModelCoolingDown} from './model-selection';
import type {TurnBudget,TurnAttempt} from './turn-budget';

export interface GenerateInput<T> {
 taskType:string;messages:AIMessage[];responseSchema:z.ZodType<T>;responseName:string;
 tools?:AITool[];timeoutMs?:number;conversationId?:string;ticketId?:string;signal?:AbortSignal;reasoningMode?:'DEFAULT'|'OFF_IF_SUPPORTED';
}
export interface GatewayOptions {store:AIStore;key:string;adapters:Record<string,AIProviderAdapter>;priceReader?:PriceReader;turnBudget?:TurnBudget}
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

function invalidOutput(subreason:AIOutputSubreason,httpStatus?:number):AIProviderError {
 return new AIProviderError('INVALID_OUTPUT',httpStatus,undefined,subreason);
}

function logInvalidOutput(model:AIModelConfig,taskType:string,error:AIProviderError):void {
 if(error.code!=='INVALID_OUTPUT'||!error.outputSubreason)return;
 // Keep this record useful for diagnosis while excluding prompts, outputs, keys and exception details.
 console.warn('AI_INVALID_OUTPUT',JSON.stringify({providerId:model.providerId,modelId:model.id,adapter:model.adapter,
  taskType,httpStatus:error.httpStatus??null,subreason:error.outputSubreason}));
}

export async function generate<T>(input:GenerateInput<T>,options:GatewayOptions):Promise<{output:T|null;toolCalls:ProviderResponse['toolCalls'];providerId:string;modelId:string;fallbackUsed:boolean}> {
 const timeout=input.timeoutMs??20_000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>45_000||!/^[A-Z_]{1,32}$/.test(input.taskType)||!/^[A-Za-z0-9_-]{1,64}$/.test(input.responseName)||
  (input.reasoningMode!==undefined&&!['DEFAULT','OFF_IF_SUPPORTED'].includes(input.reasoningMode))||
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
  if(isModelCoolingDown(model)||options.turnBudget&&!await privateState(async()=>options.turnBudget!.canAttempt(model),remaining,input.signal))continue;
  let turnAttempt:TurnAttempt|undefined;
  let inferred=false,observedStatus:number|undefined,pricedModel=model;
  const attemptDeadline=Math.min(deadline,started+model.timeoutMs);
  const budget=attemptDeadline-Date.now();
  if(budget<=0){lastError=new AIProviderError('TIMEOUT');if(Date.now()>=deadline)throw lastError;continue;}
  try{
   const adapter=options.adapters[model.adapter];if(!adapter)throw new AIProviderError('PROVIDER_UNAVAILABLE');
   const raw=await bounded(async signal=>{
    const permission=await authorizeModelCost(model,'GENERATION',readPrice,signal,options.store.readAccountFreeUntil);
    if(!permission)return null;
    if(signal.aborted)throw new AIProviderError(input.signal?.aborted?'CANCELLED':'TIMEOUT');
    if(permission.pricing)pricedModel={...model,inputPricePerMillion:permission.pricing.inputPricePerMillion,
     outputPricePerMillion:permission.pricing.outputPricePerMillion};
    // An operator's account confirmation is not a provider billing observation.
    else if(permission.accountConfirmedFree)pricedModel={...model,inputPricePerMillion:null,outputPricePerMillion:null};
    if(options.turnBudget){const reserved=await options.turnBudget.reserve(model);if(!reserved)return null;turnAttempt=reserved;
     if(signal.aborted)throw new AIProviderError(input.signal?.aborted?'CANCELLED':'TIMEOUT');}
    if(permission.accountConfirmedFree&&options.store.readAccountFreeUntil){
     const until=await options.store.readAccountFreeUntil(model),remaining=until?Date.parse(until)-Date.now():NaN;
     if(!Number.isFinite(remaining)||remaining<=0||remaining>30*86400000)throw new AIProviderError('PROVIDER_UNAVAILABLE');
     if(signal.aborted)throw new AIProviderError(input.signal?.aborted?'CANCELLED':'TIMEOUT');
    }
    const apiKey=decryptValue(model.apiKeyEncrypted,options.key);
    const transportTimeoutMs=attemptDeadline-Date.now();
    if(transportTimeoutMs<=0)throw new AIProviderError('TIMEOUT');
    inferred=true;inferenceAttempts++;
    return adapter.generate({modelId:model.modelId,baseUrl:model.baseUrl,apiKey,
     messages:input.messages,responseSchema:{name:input.responseName,schema:jsonSchema},tools,signal,
     ...(model.adapter==='COMPATIBLE'||model.adapter==='OPENROUTER'||model.adapter==='ZEN'&&permission.apiFormat==='CHAT'?{timeoutMs:transportTimeoutMs}:{}),
     ...(model.adapter==='OPENROUTER'&&input.reasoningMode==='OFF_IF_SUPPORTED'&&permission.pricing?.canDisableReasoning===true?{disableReasoning:true}:{}),
     ...(model.adapter==='OPENROUTER'&&model.baseUrl==='https://openrouter.ai/api/v1'&&tools.length===0&&permission.pricing?.jsonOutputMode==='JSON_OBJECT'?{jsonOutputMode:'JSON_OBJECT' as const}:{}),
     ...(['ZEN','OPENROUTER','COMPATIBLE'].includes(model.adapter)?{costMode:permission.costMode,apiFormat:permission.apiFormat}:{})});
   },budget,input.signal);
   if(raw===null)continue;
   observedStatus=z.number().int().min(100).max(599).safeParse(raw?.httpStatus).data;
   try{response=responseShape.parse(raw);}
   catch(error){if(error instanceof z.ZodError)throw invalidOutput('ADAPTER_SHAPE',observedStatus);throw error;}
   if(response.toolCalls.some(call=>!tools.some(tool=>tool.name===call.name))||new Set(response.toolCalls.map(call=>call.id)).size!==response.toolCalls.length)throw invalidOutput('ADAPTER_SHAPE',response.httpStatus??observedStatus);
   if(response.output===null){if(!response.toolCalls.length)throw invalidOutput('ADAPTER_SHAPE',response.httpStatus??observedStatus);}
   else{const parsed=input.responseSchema.safeParse(response.output);if(!parsed.success)throw invalidOutput('SCHEMA',response.httpStatus??observedStatus);output=parsed.data;}
  }catch(caught){
   error=caught instanceof AIProviderError?caught:caught instanceof z.ZodError?invalidOutput('ADAPTER_SHAPE',observedStatus):new AIProviderError('PROVIDER_UNAVAILABLE');
   if(error.code==='INVALID_OUTPUT'&&!error.outputSubreason)error=invalidOutput('ADAPTER_SHAPE',error.httpStatus??observedStatus);
  }
  // A cancelled/expired generation must still account for HTTP already attempted.
  // This failure-only audit cannot return an answer or grant another inference.
  let auditDeadline=error&&(input.signal?.aborted||Date.now()>=deadline)?Date.now()+500:undefined;
  const persist=async(work:()=>Promise<unknown>):Promise<void>=>{
   if(auditDeadline!==undefined&&Date.now()>=auditDeadline)return;
   // Keep the same write promise if cancellation arrives mid-write: never replay it.
   const pending=Promise.resolve().then(work);
   if(auditDeadline===undefined){
    try{await privateState(()=>pending,Math.max(1,deadline-Date.now()),input.signal);return;}
    catch(caught){
     if(!(caught instanceof AIProviderError)||!['CANCELLED','TIMEOUT'].includes(caught.code))throw caught;
     error??=caught;auditDeadline=Date.now()+500;
    }
   }
   const remaining=auditDeadline-Date.now();
   try{await privateState(()=>pending,Math.max(1,remaining));}catch{
    // A failed audit leaves the reservation charged; never replace the original error.
   }
  };
  if(turnAttempt)await persist(async()=>turnAttempt!.finish(error?.code));
  if(!inferred){
   if(error?.code==='CANCELLED'||(error?.code==='TIMEOUT'&&attemptDeadline===deadline))throw error;
   if(error)lastError=error;
   continue;
  }
  if(error)logInvalidOutput(model,input.taskType,error);
  // Persist observations only after provider HTTP completes; no business transaction spans generation.
  await persist(()=>options.store.recordAttempt({providerId:model.providerId,modelId:model.id,requestType:input.taskType,purpose:'GENERATION',
   providerRevision:model.providerRevision,modelRevision:model.modelRevision,
   providerNetworkRevision:model.providerNetworkRevision,modelNetworkRevision:model.modelNetworkRevision,retryEvidence:error?.retryEvidence,
   conversationId:input.conversationId,ticketId:input.ticketId,latencyMs:Math.max(0,Date.now()-started),
   inputTokens:response?.inputTokens??null,outputTokens:response?.outputTokens??null,estimatedCost:response?cost(pricedModel,response):null,
   status:error?'ERROR':'SUCCESS',fallbackUsed:inferenceAttempts>1,errorCode:error?.code,httpStatus:error?.httpStatus??observedStatus,
   health:error?healthFor(error.code):'HEALTHY'}));
  if(!error)return {output,toolCalls:response!.toolCalls,providerId:model.providerId,modelId:model.id,fallbackUsed:inferenceAttempts>1};
  lastError=error;
  if(!error.retryable||(error.code==='TIMEOUT'&&attemptDeadline===deadline))throw error;
  if(error.code==='RATE_LIMITED'){
   // Give another configured provider a chance without claiming account-wide exhaustion.
   const pending=models.splice(index+1);
   models.push(...pending.filter(candidate=>candidate.providerId!==model.providerId),
    ...pending.filter(candidate=>candidate.providerId===model.providerId));
  }
 }
 throw lastError;
}
