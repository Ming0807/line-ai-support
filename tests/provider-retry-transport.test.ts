import {expect,it,vi} from 'vitest';
import {createOpenAIAdapter,createZenResponsesAdapter} from '../lib/ai/providers/openai';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';
import {createOpenAIEmbeddingAdapter} from '../lib/ai/providers/openai-embeddings';
import {createOpenRouterEmbeddingAdapter} from '../lib/ai/providers/openrouter-embeddings';
import {AIProviderError,type ProviderRequest} from '../lib/ai/types';

const at=Date.parse('2026-10-05T00:00:00Z');
const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
const request=(baseUrl:string,modelId:string):ProviderRequest=>({baseUrl,modelId,apiKey:'fixture-key',messages:[{role:'user',content:'fixture'}],
 responseSchema:{name:'probe',schema},signal:new AbortController().signal});
const cases:[string,(fetchImpl:typeof fetch)=>Promise<unknown>][]=[
 ['OpenRouter Chat',fetchImpl=>createChatCompletionsAdapter({fetchImpl}).generate({...request('https://openrouter.ai/api/v1','fixture/chat'),apiFormat:'CHAT'})],
 ['Zen Chat',fetchImpl=>createChatCompletionsAdapter({fetchImpl}).generate({...request('https://opencode.ai/zen/v1','fixture-chat'),apiFormat:'CHAT'})],
 ['Zen Responses',fetchImpl=>createZenResponsesAdapter({fetchImpl}).generate({...request('https://opencode.ai/zen/v1','fixture-chat'),apiFormat:'RESPONSES'})],
 ['native Responses',fetchImpl=>createOpenAIAdapter({fetchImpl}).generate(request('https://api.openai.com/v1','fixture-chat'))],
 ['OpenRouter Embeddings',fetchImpl=>createOpenRouterEmbeddingAdapter({fetchImpl}).embed({baseUrl:'https://openrouter.ai/api/v1',modelId:'fixture/vector',apiKey:'fixture-key',input:['fixture'],dimensions:2,signal:new AbortController().signal})],
 ['native Embeddings',fetchImpl=>createOpenAIEmbeddingAdapter({fetchImpl}).embed({baseUrl:'https://api.openai.com/v1',modelId:'text-embedding-3-small',apiKey:'fixture-key',input:['fixture'],dimensions:2,signal:new AbortController().signal})],
];
for(const [name,call] of cases){
 it.each([429,503])(`${name} preserves safe Retry-After receipt evidence for HTTP %s`,async status=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(at);
  try{
   const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('discarded upstream body',{status,headers:{'Retry-After':'120'}}));
   await expect(call(fetchImpl)).rejects.toMatchObject({httpStatus:status,retryEvidence:{source:'RETRY_AFTER',observedAt:new Date(at).toISOString(),retryAt:new Date(at+120_000).toISOString()}});
   expect(fetchImpl).toHaveBeenCalledOnce();
  }finally{clock.mockRestore();}
 });
 it(`${name} does not infer cooldown from credential failure even with Retry-After`,async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:401,headers:{'Retry-After':'120'}}));
  const error=await call(fetchImpl).catch(value=>value);
  if(!(error instanceof AIProviderError))throw new Error('EXPECTED_PROVIDER_ERROR');
  expect(error).toMatchObject({code:'AUTH_ERROR',httpStatus:401});expect(error.retryEvidence).toBeUndefined();
 });
}
