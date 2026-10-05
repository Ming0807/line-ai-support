import {createOpenAIAdapter,createZenResponsesAdapter} from './providers/openai';
import {createOpenAIEmbeddingAdapter} from './providers/openai-embeddings';
import {createChatCompletionsAdapter} from './providers/chat-completions';
import {createOpenRouterEmbeddingAdapter} from './providers/openrouter-embeddings';
import {AIProviderError,type AIProviderAdapter} from './types';
import type {EmbeddingAdapter} from './embedding-types';
import {createCompatibleTransport,type CompatibleTransport} from './compatible-network';
import {createCompatibleChatAdapter} from './providers/compatible-chat-completions';
import {createCompatibleEmbeddingAdapter} from './providers/compatible-embeddings';

function pinned(base:string,adapter:AIProviderAdapter):AIProviderAdapter {
 const allowed=(value:string)=>value===base||value===`${base}/`;
 return {
  generate:request=>allowed(request.baseUrl)?adapter.generate(request):Promise.reject(new AIProviderError('INVALID_REQUEST')),
  healthCheck:config=>allowed(config.baseUrl)?adapter.healthCheck(config):Promise.reject(new AIProviderError('INVALID_REQUEST')),
 };
}

/** Only backend-installed adapters are selectable; database text never loads executable code. */
export function createProviderRegistry(options:{fetchImpl?:typeof fetch;compatibleTransport?:CompatibleTransport}={}):Record<string,AIProviderAdapter>{
 const chat=createChatCompletionsAdapter(options),responses=createZenResponsesAdapter(options);
 return {COMPATIBLE:createCompatibleChatAdapter({transport:options.compatibleTransport??createCompatibleTransport()}),
 OPENAI:createOpenAIAdapter(options),OPENROUTER:pinned('https://openrouter.ai/api/v1',chat),ZEN:pinned('https://opencode.ai/zen/v1',{
  generate(request){
   if(request.apiFormat==='CHAT')return chat.generate(request);
   if(request.apiFormat==='RESPONSES')return responses.generate(request);
   return Promise.reject(new AIProviderError('INVALID_REQUEST'));
  },healthCheck:config=>chat.healthCheck(config),
 })};
}

export function createEmbeddingProviderRegistry(options:{fetchImpl?:typeof fetch;compatibleTransport?:CompatibleTransport}={}):Record<string,EmbeddingAdapter>{
 return {COMPATIBLE:createCompatibleEmbeddingAdapter({transport:options.compatibleTransport??createCompatibleTransport()}),
 OPENAI:createOpenAIEmbeddingAdapter(options),OPENROUTER:createOpenRouterEmbeddingAdapter(options)};
}
