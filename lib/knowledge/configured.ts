import type {Pool} from 'pg';
import {generate} from '../ai/gateway';
import {createLocalE5EmbeddingProvider,embedLocalConfigured} from './embedding-client';
import {createAIStore} from '../ai/store';
import {createProviderRegistry} from '../ai/provider-registry';
import type {CompatibleTransport} from '../ai/compatible-network';
import {createPriceReader} from '../ai/pricing';
import {createKnowledgeToolRegistry} from '../ai/backend-tools';
import type {AIWorkerOptions} from '../ai/run-worker';
import {AIProviderError,type AIErrorCode} from '../ai/types';
import {createSupportProducer} from '../ai/support-producer';
import {citationEvidenceSchema} from './citations';
import type {StructuredSearchResult} from './structured-search';
import type {StructuredDataset} from './structured-payload';
import {createStudentWebFallback} from './owned-web-fallback';
import {createAssistantDecision,assistantDecisionSchema,type AssistantDecision} from '../ai/assistant-decision';
import {screenMixedRepair} from '../ai/mixed-repair';
import {createAssistantOrchestrator} from '../ai/assistant-orchestrator';
import {createScopedAssistantDecision} from '../ai/scoped-assistant-decision';
import {createEvidenceFirstMixedComposer} from '../ai/evidence-first-mixed';
import {createKnowledgeProducer,bounded,validEmbedding,type KnowledgeProducerOptions,type KnowledgeValidationDiagnostic} from './answer-producer';
import {createTurnFlowV2,type SectionSearchResult} from '../ai/turn-flow-v2';
import {createSectionComposer} from './section-answer';
import type {KnowledgeScope} from './types';
import {z} from 'zod';
import {createDurableTurnBudget,ASSISTANT_TURN_ATTEMPT_LIMIT} from '../ai/durable-turn-budget';
import {createConversationReply,generalReplyEvidenceReason,type GeneralEvidenceReason} from '../ai/conversation-reply';
import {lookupPlanSchema,decodeLookupSelection} from './lookup-plan';

export type AssistantGenerationDiagnostic=
 |{taskType:'KNOWLEDGE_VALIDATION';outcome:'REJECTED';stage:KnowledgeValidationDiagnostic['stage'];reason:KnowledgeValidationDiagnostic['reason']}
 |{taskType:'STRUCTURED_SEARCH';outcome:'SUCCESS';searchStatus:StructuredSearchResult['status']}
 |{taskType:'STRUCTURED_DISCOVERY';outcome:'SUCCESS';planDataset:StructuredDataset;searchStatus:StructuredSearchResult['status']}
 |{taskType:'STRUCTURED_SEARCH';outcome:'FAILURE';errorCode:'DATABASE_ERROR';databaseCode?:string}
 |{taskType:string;outcome:'SUCCESS';decisionAction?:AssistantDecision['action'];generalAccepted?:boolean;generalScreenReason?:GeneralEvidenceReason;
   repairAcceptedParts?:number;repairRejectedParts?:number;
   planMethod?:'RAG'|'STRUCTURED'|'DISCOVER_FORMS'|'DISCOVER_CALENDAR'|'DISCOVER_SERVICES'|'DISCOVER_FORM_PURPOSE';planDataset?:StructuredDataset;planFilterFields?:string[];planProcedureTopic?:string}
 |{taskType:string;outcome:'FAILURE';errorCode:AIErrorCode};
type DiagnosticObserver=(event:AssistantGenerationDiagnostic)=>void;

function safelyObserve(observer:DiagnosticObserver|undefined,event:AssistantGenerationDiagnostic):void {
 if(!observer)return;
 try{
  const result=observer(event) as unknown;
  if(result&&typeof (result as {then?:unknown}).then==='function')void Promise.resolve(result).catch(()=>undefined);
 }catch{
  // Diagnostics must never change provider or answer behavior.
 }
}

function decisionAction(output:unknown):AssistantDecision['action']|undefined {
 if(typeof output!=='object'||output===null||!('decision' in output))return undefined;
 const parsed=assistantDecisionSchema.safeParse(output.decision);
 return parsed.success?parsed.data.action:undefined;
}

function observeSuccess(observer:DiagnosticObserver|undefined,taskType:string,output:unknown,snapshot:Parameters<AIWorkerOptions['produce']>[0]):void {
 if(!observer)return;
 try{
  let event:AssistantGenerationDiagnostic={taskType,outcome:'SUCCESS'};
  if(taskType==='ASSISTANT_DECISION'||taskType==='ASSISTANT_DECISION_REPAIR'){
   const repaired=taskType==='ASSISTANT_DECISION_REPAIR'?screenMixedRepair(output,snapshot):null;
   if(repaired)event={...event,decisionAction:'MIXED_REPLY',generalAccepted:repaired.decision!==null,
    repairAcceptedParts:repaired.acceptedParts,repairRejectedParts:repaired.rejectedParts,...(repaired.reason?{generalScreenReason:repaired.reason}:{})};
   const action=decisionAction(output);
   if(action)event={...event,decisionAction:action};
   if(typeof output==='object'&&output!==null&&'decision' in output){
    const decision=assistantDecisionSchema.safeParse(output.decision);
    if(decision.success&&decision.data.action==='MIXED_REPLY'){
     const reason=generalReplyEvidenceReason(decision.data.generalText,snapshot.question,snapshot.history);
     event={...event,generalAccepted:createConversationReply(snapshot,decision.data.generalText)!==null,...(reason?{generalScreenReason:reason}:{})};
    }
    if(decision.success&&(decision.data.action==='GENERAL_REPLY'||decision.data.action==='CLARIFY')){
     const reason=generalReplyEvidenceReason(decision.data.text,snapshot.question,snapshot.history);
     event={...event,generalAccepted:createConversationReply(snapshot,decision.data.text)!==null,...(reason?{generalScreenReason:reason}:{})};
    }
   }
  }
  if(taskType==='KNOWLEDGE_PLAN'){
   const plan=lookupPlanSchema.safeParse(output);
   if(plan.success){
    try{
     const selection=decodeLookupSelection(plan.data.selection);
     event={...event,planMethod:selection.method,
      ...(selection.method==='STRUCTURED'?{planDataset:selection.query.dataset}:{}),
      ...(selection.method==='RAG'&&selection.notApplicable?{planProcedureTopic:selection.notApplicable.topic}:{}),
      planFilterFields:selection.method==='STRUCTURED'?Object.keys(selection.query.filters).sort():[]};
    }catch{
     // A schema-valid but non-decodable proposal is not a valid plan diagnostic.
    }
   }
  }
  safelyObserve(observer,event);
 }catch{
  // Output inspection is diagnostic work and cannot turn a successful call into a failure.
 }
}

/** Generation uses the dashboard registry; V1 embeddings use private local infrastructure. */
export function createConfiguredKnowledgeProducer(pool:Pool,key:string,options:{fetchImpl?:typeof fetch;compatibleTransport?:CompatibleTransport;assistantEnabled?:boolean;
 /** Candidate-only evaluation. Normal workers do not enable this before owned quality acceptance. */
 evidenceFirstMixed?:boolean;
 /** Prospective scope/composition separation; held off until actual workflow acceptance. */
 scopeFirst?:boolean;
 /** Evaluation-only joint scope/composition; retains all downstream admission guards. */
 scopedSinglePass?:boolean;
 /** CONV-V2 (DEC-195): decision call, backend section search and one compose call. Off until measured acceptance. */
 conversationFlowV2?:boolean;
 /** Prospective partial-evidence completion contract, opt-in until actual acceptance. */
 ragCoverage?:boolean;
 /** In-process observer for guarded synthetic evaluation only; normal workers leave this unset. */
 onAssistantGenerationDiagnostic?:DiagnosticObserver}={}):AIWorkerOptions['produce']{
 if(options.scopeFirst&&options.evidenceFirstMixed)throw new Error('ASSISTANT_CANDIDATES_INCOMPATIBLE');
 if(options.scopedSinglePass&&!options.scopeFirst)throw new Error('ASSISTANT_SINGLE_PASS_REQUIRES_SCOPE');
 if(options.conversationFlowV2&&(options.assistantEnabled!==true||options.scopeFirst||options.evidenceFirstMixed||options.scopedSinglePass))
  throw new Error('CONVERSATION_FLOW_V2_INCOMPATIBLE');
 const store=createAIStore(pool);
 const generation=createProviderRegistry(options),embedding=createLocalE5EmbeddingProvider(options);
 const priceReader=createPriceReader(options);
 return (snapshot,signal)=>{
 const owner=snapshot.leaseToken?{kind:'AI' as const,id:snapshot.jobId,leaseToken:snapshot.leaseToken}:undefined;
 const budgets=options.assistantEnabled===true&&owner?{
  decision:createDurableTurnBudget(pool,owner,key,{limit:ASSISTANT_TURN_ATTEMPT_LIMIT,reservedSlots:2}),
  plan:createDurableTurnBudget(pool,owner,key,{limit:ASSISTANT_TURN_ATTEMPT_LIMIT,reservedSlots:1}),
  completion:createDurableTurnBudget(pool,owner,key,{limit:ASSISTANT_TURN_ATTEMPT_LIMIT}),
 }:undefined;
 if(options.assistantEnabled===true&&!budgets)throw new Error('ASSISTANT_LEASE_REQUIRED');
 const bound:KnowledgeProducerOptions={
  compactPlanning:options.assistantEnabled===true,
  ragCoverage:options.ragCoverage===true,
  onValidationDiagnostic:event=>{
   if(options.assistantEnabled===true)safelyObserve(options.onAssistantGenerationDiagnostic,{taskType:'KNOWLEDGE_VALIDATION',outcome:'REJECTED',...event});
  },
  webFallback:createStudentWebFallback(pool,key,snapshot),
  generate:async input=>{
   const turnBudget=budgets?(['KNOWLEDGE_ANSWER','KNOWLEDGE_EXACT_ANSWER','SUPPORT_INTENT','ASSISTANT_GENERAL_COMPOSE','TURN_COMPOSE'].includes(input.taskType)?budgets.completion:
    ['KNOWLEDGE_PLAN','KNOWLEDGE_PLAN_REPAIR','KNOWLEDGE_WEB_PLAN'].includes(input.taskType)?budgets.plan:budgets.decision):undefined;
   try{
    const result=await generate(input,{store,key,adapters:generation,priceReader,...(turnBudget?{turnBudget}:{})});
    if(options.assistantEnabled===true)observeSuccess(options.onAssistantGenerationDiagnostic,input.taskType,result.output,snapshot);
    return result;
   }catch(error){
    if(options.assistantEnabled===true)safelyObserve(options.onAssistantGenerationDiagnostic,{taskType:input.taskType,outcome:'FAILURE',
     errorCode:error instanceof AIProviderError?error.code:'PROVIDER_UNAVAILABLE'});
    throw error;
   }
  },
  embed:input=>embedLocalConfigured(input,embedding),
  discoverStructured:async input=>{
   const registry=createKnowledgeToolRegistry(pool,{key});
   const result=await registry.execute({name:'discover_public_structured',arguments:input},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['discover_public_structured']) as StructuredSearchResult;
   safelyObserve(options.onAssistantGenerationDiagnostic,{taskType:'STRUCTURED_DISCOVERY',outcome:'SUCCESS',planDataset:input.dataset,searchStatus:result.status});
   return result;
  },
  discoverForms:async input=>{
   const registry=createKnowledgeToolRegistry(pool,{key});
   return await registry.execute({name:'discover_public_forms',arguments:input},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['discover_public_forms']) as StructuredSearchResult;
  },
  structuredSearch:async input=>{
   const registry=createKnowledgeToolRegistry(pool,{key});
   try{
   const result=await registry.execute({name:'search_structured',arguments:input},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['search_structured']);
   const status=(result as StructuredSearchResult).status;
   if(['READY','EMPTY','UNAVAILABLE','CONTEXT_INCOMPLETE','CLARIFICATION_REQUIRED'].includes(status))safelyObserve(options.onAssistantGenerationDiagnostic,{taskType:'STRUCTURED_SEARCH',outcome:'SUCCESS',searchStatus:status});
   return result as StructuredSearchResult;
   }catch(error){
    const code=error&&typeof error==='object'&&'code' in error?error.code:undefined;
    safelyObserve(options.onAssistantGenerationDiagnostic,{taskType:'STRUCTURED_SEARCH',outcome:'FAILURE',errorCode:'DATABASE_ERROR',...(typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?{databaseCode:code}:{})});throw error;
   }
  },
  search:async input=>{
   const registry=createKnowledgeToolRegistry(pool,{vector:input.vector,fingerprint:input.fingerprint});
   const result=await registry.execute({name:'search_knowledge',arguments:{query:snapshot.question,scope:input.scope}},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['search_knowledge']);
   if(typeof result==='object'&&result!==null&&'status' in result&&result.status==='SCOPE_AMBIGUOUS')throw new Error('KNOWLEDGE_SCOPE_AMBIGUOUS');
   return citationEvidenceSchema.array().max(12).parse(result);
  },
  publicAuthorityExists:async()=>{
   const registry=createKnowledgeToolRegistry(pool,{});
   const result=await registry.execute({name:'check_public_authority',arguments:{}},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['check_public_authority']);
   if(!result||typeof result!=='object'||!('exists' in result)||typeof result.exists!=='boolean')throw new Error('KNOWLEDGE_CATALOG_INVALID');
   return result.exists;
  },
  publicFamilyCatalog:async()=>{
   const registry=createKnowledgeToolRegistry(pool,{});
   return registry.execute({name:'get_public_family_catalog',arguments:{}},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['get_public_family_catalog']);
  },
 };
 const support=createSupportProducer(bound);
 const context={lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision};
 if(options.conversationFlowV2===true)return createTurnFlowV2({
  decide:createAssistantDecision({generate:input=>bound.generate({...input,reasoningMode:'OFF_IF_SUPPORTED'})}),
  searchSections:(scope,queries,abort)=>searchSections(pool,bound,context,snapshot.question,scope,queries,abort),
  compose:createSectionComposer({generate:bound.generate}),
  fullLookup:(current,abort,hint)=>createKnowledgeProducer(hint===undefined?bound:{...bound,retrievalHint:hint})(current,abort),
  handoff:(current,abort,reason)=>createSupportProducer(bound,{handoffReason:reason})(current,abort),
 })(snapshot,signal);
 return (options.assistantEnabled===true?createAssistantOrchestrator({repairRejectedGeneral:!options.scopeFirst,decide:(options.scopeFirst?createScopedAssistantDecision:createAssistantDecision)({
  // The Gateway keeps provider defaults unless fresh metadata explicitly permits
  // optional reasoning. Grounded planning/completion still use bound.generate directly.
  generate:input=>bound.generate({...input,reasoningMode:'OFF_IF_SUPPORTED'}),
  ...(options.scopedSinglePass?{singlePass:true}:{}),
 }),
  ...(options.evidenceFirstMixed?{composeMixed:createEvidenceFirstMixedComposer({generate:bound.generate})}:{}),
  lookup:(context,abort,retrievalHint)=>createKnowledgeProducer(retrievalHint===undefined?bound:{...bound,retrievalHint})(context,abort),
  handoff:(context,abort,reason)=>createSupportProducer(bound,{handoffReason:reason})(context,abort)}):support)(snapshot,signal);
 };
}

const sectionSearchResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('READY'),evidence:citationEvidenceSchema.array().max(12),incompleteSections:z.number().int().nonnegative()}),
 z.strictObject({status:z.literal('SCOPE_AMBIGUOUS')}),
]);

/** CONV-V2 backend-only search: embed each query in turn, stop at the first non-empty eligible result. */
async function searchSections(pool:Pool,bound:KnowledgeProducerOptions,context:{lineSessionId:string;conversationId:string;conversationRevision:number},
 question:string,scope:KnowledgeScope,queries:string[],signal:AbortSignal):Promise<SectionSearchResult>{
 for(const query of queries){
  let embedded;
  try{
   embedded=await bounded(stageSignal=>bound.embed({input:[query],requestType:'EMBEDDING_QUERY',conversationId:context.conversationId,timeoutMs:15_000,signal:stageSignal}),15_000,signal);
  }catch(error){if(signal.aborted)throw error;return {status:'FAILED'};}
  if(!validEmbedding(embedded))return {status:'FAILED'};
  const vector=embedded.vectors[0]!,registry=createKnowledgeToolRegistry(pool,{vector,fingerprint:embedded.fingerprint});
  let raw:unknown;
  try{
   raw=await bounded(()=>registry.execute({name:'search_knowledge_sections',arguments:{query:question,scope}},context,['search_knowledge_sections']),8_000,signal);
  }catch(error){if(signal.aborted)throw error;return {status:'FAILED'};}
  const parsed=sectionSearchResultSchema.safeParse(raw);
  if(!parsed.success)return {status:'FAILED'};
  if(parsed.data.status==='SCOPE_AMBIGUOUS')return {status:'SCOPE_AMBIGUOUS'};
  if(parsed.data.evidence.length>0)return {status:'READY',evidence:parsed.data.evidence,incompleteSections:parsed.data.incompleteSections,queryVector:vector,fingerprint:embedded.fingerprint};
 }
 return {status:'EMPTY'};
}
