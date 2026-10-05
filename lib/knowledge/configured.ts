import type {Pool} from 'pg';
import {generate} from '../ai/gateway';
import {embed} from '../ai/embedding-gateway';
import {createAIStore} from '../ai/store';
import {createProviderRegistry,createEmbeddingProviderRegistry} from '../ai/provider-registry';
import {createPriceReader} from '../ai/pricing';
import {createKnowledgeToolRegistry} from '../ai/backend-tools';
import type {AIWorkerOptions} from '../ai/run-worker';
import {createKnowledgeProducer} from './answer-producer';
import {citationEvidenceSchema} from './citations';

/** Provider/model settings come from the dashboard registry, never bootstrap env aliases. */
export function createConfiguredKnowledgeProducer(pool:Pool,key:string,options:{fetchImpl?:typeof fetch}={}):AIWorkerOptions['produce']{
 const store=createAIStore(pool);
 const generation=createProviderRegistry(options),embedding=createEmbeddingProviderRegistry(options);
 const priceReader=createPriceReader(options);
 return (snapshot,signal)=>createKnowledgeProducer({
  generate:input=>generate(input,{store,key,adapters:generation,priceReader}),
  embed:input=>embed(input,{store,key,adapters:embedding,priceReader}),
  search:async input=>{
   const registry=createKnowledgeToolRegistry(pool,{vector:input.vector,fingerprint:input.fingerprint});
   const result=await registry.execute({name:'search_knowledge',arguments:{query:snapshot.question,scope:input.scope}},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['search_knowledge']);
   if(typeof result==='object'&&result!==null&&'status' in result&&result.status==='SCOPE_AMBIGUOUS')throw new Error('KNOWLEDGE_SCOPE_AMBIGUOUS');
   return citationEvidenceSchema.array().max(12).parse(result);
  },
 })(snapshot,signal);
}
