import type {Pool} from 'pg';
import {generate} from '../ai/gateway';
import {createLocalE5EmbeddingProvider,embedLocalConfigured} from './embedding-client';
import {createAIStore} from '../ai/store';
import {createProviderRegistry} from '../ai/provider-registry';
import {createPriceReader} from '../ai/pricing';
import {createKnowledgeToolRegistry} from '../ai/backend-tools';
import type {AIWorkerOptions} from '../ai/run-worker';
import {createKnowledgeProducer} from './answer-producer';
import {citationEvidenceSchema} from './citations';

/** Generation uses the dashboard registry; V1 embeddings use private local infrastructure. */
export function createConfiguredKnowledgeProducer(pool:Pool,key:string,options:{fetchImpl?:typeof fetch}={}):AIWorkerOptions['produce']{
 const store=createAIStore(pool);
 const generation=createProviderRegistry(options),embedding=createLocalE5EmbeddingProvider(options);
 const priceReader=createPriceReader(options);
 return (snapshot,signal)=>createKnowledgeProducer({
  generate:input=>generate(input,{store,key,adapters:generation,priceReader}),
  embed:input=>embedLocalConfigured(input,embedding),
  search:async input=>{
   const registry=createKnowledgeToolRegistry(pool,{vector:input.vector,fingerprint:input.fingerprint});
   const result=await registry.execute({name:'search_knowledge',arguments:{query:snapshot.question,scope:input.scope}},
    {lineSessionId:snapshot.sessionId,conversationId:snapshot.conversationId,conversationRevision:snapshot.revision},['search_knowledge']);
   if(typeof result==='object'&&result!==null&&'status' in result&&result.status==='SCOPE_AMBIGUOUS')throw new Error('KNOWLEDGE_SCOPE_AMBIGUOUS');
   return citationEvidenceSchema.array().max(12).parse(result);
  },
 })(snapshot,signal);
}
