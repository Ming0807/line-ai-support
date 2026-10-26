import {z} from 'zod';
import type {Pool} from 'pg';
import type {AIModelConfig,AIProviderAdapter,AIStore} from './types';
import {compareModelPriority,supportsGeneration} from './model-selection';
import {generate as gateway,type GatewayOptions,type GenerateInput} from './gateway';
import type {KnowledgeProducerOptions} from '../knowledge/answer-producer';
import {staffKnowledgeAdviceSchema} from '../staff/knowledge-assistance-contracts';

const revisionSchema=z.number().int().min(0).max(2_147_483_647);
const uuidSchema=z.uuid();
const querySchema=z.string().trim().min(1).max(400);
const MAX_TOOL_RESULT_BYTES=7600;

export function parseCopilotArguments(argv:string[]):{staffId:string;ticketId:string;revision:number}{
 if(!Array.isArray(argv)||argv.length!==4)throw new Error('PILOT_CONFIGURATION_INVALID');
 const fields=new Map<string,string>();
 let copilot=false;
 for(const argument of argv){
  if(argument==='--copilot'){
   if(copilot)throw new Error('PILOT_CONFIGURATION_INVALID');
   copilot=true;continue;
  }
  const match=/^(--staff-id|--ticket-id|--revision)=(.*)$/u.exec(argument);
  if(!match||fields.has(match[1]!))throw new Error('PILOT_CONFIGURATION_INVALID');
  fields.set(match[1]!,match[2]!);
 }
 const staffId=fields.get('--staff-id'),ticketId=fields.get('--ticket-id'),revisionText=fields.get('--revision');
 if(!copilot||fields.size!==3||!staffId||!ticketId||!revisionText||!uuidSchema.safeParse(staffId).success||
  !uuidSchema.safeParse(ticketId).success||!/^(?:0|[1-9]\d*)$/u.test(revisionText))throw new Error('PILOT_CONFIGURATION_INVALID');
 const revision=Number(revisionText);
 if(!revisionSchema.safeParse(revision).success)throw new Error('PILOT_CONFIGURATION_INVALID');
 return {staffId,ticketId,revision};
}

const pinFields=(model:AIModelConfig)=>({
 id:model.id,providerId:model.providerId,providerRevision:model.providerRevision,modelRevision:model.modelRevision,
 providerNetworkRevision:model.providerNetworkRevision,modelNetworkRevision:model.modelNetworkRevision,
 adapter:model.adapter,modelId:model.modelId,baseUrl:model.baseUrl,costMode:model.costMode,
 supportsJson:model.supportsJson,supportsTools:model.supportsTools,timeoutMs:model.timeoutMs,apiFormat:model.apiFormat,
 apiKeyEncrypted:model.apiKeyEncrypted,
});
export interface PinnedGenerationModel extends ReturnType<typeof pinFields>{model:AIModelConfig}

function validPinModel(model:AIModelConfig):boolean{
 return uuidSchema.safeParse(model.id).success&&uuidSchema.safeParse(model.providerId).success&&
  revisionSchema.safeParse(model.providerRevision).success&&revisionSchema.safeParse(model.modelRevision).success&&
  revisionSchema.safeParse(model.providerNetworkRevision).success&&revisionSchema.safeParse(model.modelNetworkRevision).success&&
  model.costMode==='FREE_ONLY'&&supportsGeneration(model,false);
}

/** Choose exactly one enabled, FREE_ONLY model; all later calls are restricted to its captured registry identity. */
export function capturePinnedGenerationModel(models:AIModelConfig[]):PinnedGenerationModel{
 const candidates=models.filter(validPinModel).sort(compareModelPriority);
 const selected=candidates[0];
 if(!selected)throw new Error('PILOT_MODEL_UNAVAILABLE');
 return {...pinFields(selected),model:structuredClone(selected)};
}

function samePin(current:AIModelConfig,pin:PinnedGenerationModel):boolean{
 const currentFields=pinFields(current);
 const capturedFields=Object.fromEntries(Object.keys(currentFields).map(key=>[key,(pin as unknown as Record<string,unknown>)[key]]));
 return validPinModel(current)&&JSON.stringify(currentFields)===JSON.stringify(capturedFields);
}

export async function modelsForPinnedGeneration(loadModels:()=>Promise<AIModelConfig[]>,pin:PinnedGenerationModel):Promise<AIModelConfig[]>{
 const models=await loadModels();
 const selected=models.filter(model=>model.id===pin.id);
 if(selected.length!==1||!samePin(selected[0]!,pin))throw new Error('PINNED_MODEL_DRIFT');
 return [selected[0]!];
}

export function createPinnedGenerate(input:{pin:PinnedGenerationModel;loadModels:()=>Promise<AIModelConfig[]>;store:AIStore;key:string;
 adapters:Record<string,AIProviderAdapter>;priceReader?:GatewayOptions['priceReader'];gateway?:typeof gateway}):KnowledgeProducerOptions['generate']{
 const pinnedStore:AIStore={...input.store,loadModels:()=>modelsForPinnedGeneration(input.loadModels,input.pin)};
 const gatewayOptions:GatewayOptions={store:pinnedStore,key:input.key,adapters:input.adapters,
  ...(input.priceReader?{priceReader:input.priceReader}:{})};
 const run=input.gateway??gateway;
 return async<T>(request:GenerateInput<T>)=>{
  const result=await run(request,gatewayOptions);
  if(result.providerId!==input.pin.providerId||result.modelId!==input.pin.id||result.fallbackUsed)throw new Error('PINNED_MODEL_DRIFT');
  return result;
 };
}

export interface CopilotSnapshotView {digest:string;revision:number;knowledge:{question:string}|null}
export interface CopilotSearchTool {
 description:string;
 parameters:Record<string,unknown>;
 maxToolCalls:1;
 execute:(args:{query:string},signal:AbortSignal)=>Promise<unknown>;
}
type CopilotSnapshotReader=()=>Promise<CopilotSnapshotView>;
type StaffAssistanceCall=(actorId:string,ticketId:string,input:{revision:number},options:{pool:Pool;key:string;signal:AbortSignal;
 generate:KnowledgeProducerOptions['generate']})=>Promise<unknown>;

/** A supplemental Hermes query can never alter the ticket-bound student question passed to staff assistance. */
export async function createHermesKnowledgeTool(input:{actorId:string;ticketId:string;revision:number;readSnapshot:CopilotSnapshotReader;
 assist:StaffAssistanceCall;pool:Pool;key:string;generate:KnowledgeProducerOptions['generate']}):Promise<{
 question:string;tool:CopilotSearchTool;assertCurrent:()=>Promise<void>;hasVerifiedSourceUse:()=>boolean;
}>{
 if(!uuidSchema.safeParse(input.actorId).success||!uuidSchema.safeParse(input.ticketId).success||!revisionSchema.safeParse(input.revision).success)
  throw new Error('PILOT_CONFIGURATION_INVALID');
 const initial=await input.readSnapshot();
 if(initial.revision!==input.revision||!initial.knowledge||typeof initial.knowledge.question!=='string'||!initial.knowledge.question.trim())
  throw new Error('PILOT_TICKET_UNAVAILABLE');
 const boundQuestion=initial.knowledge.question;
 const assertCurrent=async()=>{
  const current=await input.readSnapshot();
  if(current.revision!==initial.revision||current.digest!==initial.digest||!current.knowledge||current.knowledge.question!==boundQuestion)
   throw new Error('PILOT_TICKET_CHANGED');
 };
 let verifiedSourceUsed=false;
 const tool:CopilotSearchTool={
  description:'Search approved YRU knowledge for a supplemental query. The authorized ticket-bound student question remains the original task and cannot be replaced by this query.',
  parameters:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:400}},required:['query'],additionalProperties:false},
  maxToolCalls:1,
  execute:async(args,signal)=>{
   const parsed=querySchema.safeParse(args?.query);
   if(!parsed.success||signal.aborted)throw new Error('STAFF_ASSISTANCE_UNAVAILABLE');
   await assertCurrent();
   const advice=staffKnowledgeAdviceSchema.safeParse(await input.assist(input.actorId,input.ticketId,{revision:input.revision},
    {pool:input.pool,key:input.key,signal,generate:input.generate}));
   if(!advice.success||advice.data.revision!==input.revision||signal.aborted)throw new Error('STAFF_ASSISTANCE_UNAVAILABLE');
   await assertCurrent();
   const result={
    boundStudentQuestion:boundQuestion,
    supplementalSearchQuery:{value:parsed.data,replacesBoundQuestion:false},
    advice:{status:advice.data.status,answer:advice.data.answer,sources:advice.data.sources},
   };
   if(Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_TOOL_RESULT_BYTES)throw new Error('STAFF_ASSISTANCE_UNAVAILABLE');
   verifiedSourceUsed=advice.data.status==='VERIFIED'&&advice.data.sources.length>0;
   return result;
  },
 };
 return {question:boundQuestion,tool,assertCurrent,hasVerifiedSourceUse:()=>verifiedSourceUsed};
}
