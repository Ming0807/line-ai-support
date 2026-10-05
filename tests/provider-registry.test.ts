import {expect,it,vi} from 'vitest';
import {createProviderRegistry,createEmbeddingProviderRegistry} from '../lib/ai/provider-registry';
import type {ProviderRequest} from '../lib/ai/types';
import {createZenResponsesAdapter} from '../lib/ai/providers/openai';
const zen='https://opencode.ai/zen/v1';
function request():ProviderRequest {
 return {baseUrl:zen,apiKey:'fixture-key',modelId:'fixture-free',costMode:'FREE_ONLY',apiFormat:'RESPONSES',
  messages:[{role:'user',content:'probe'}],signal:new AbortController().signal,
  responseSchema:{name:'answer',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}}};
}
const responses={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"answer":"ok"}'}]}],usage:{input_tokens:1,output_tokens:1}};
const chat={model:'fixture-free',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'{"answer":"ok"}'}}],usage:{prompt_tokens:1,completion_tokens:1}};
it('registers the fixed official Zen/OpenRouter generation and embedding transports',()=>{
 expect(createProviderRegistry()).toHaveProperty('ZEN');expect(createProviderRegistry()).toHaveProperty('OPENROUTER');
 expect(createEmbeddingProviderRegistry()).toHaveProperty('OPENROUTER');
 expect(createEmbeddingProviderRegistry()).not.toHaveProperty('ZEN');
});
it('dispatches Zen Responses using verified protocol metadata and returns actual HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(responses)));
 expect(await createProviderRegistry({fetchImpl}).ZEN.generate(request())).toMatchObject({output:{answer:'ok'},httpStatus:200});
 expect(fetchImpl.mock.calls[0][0]).toBe(`${zen}/responses`);
 expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({model:'fixture-free',store:false});
});
it('dispatches Zen Chat using verified protocol metadata',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(chat)));
 expect(await createProviderRegistry({fetchImpl}).ZEN.generate({...request(),apiFormat:'CHAT'})).toMatchObject({output:{answer:'ok'},httpStatus:200});
 expect(fetchImpl.mock.calls[0][0]).toBe(`${zen}/chat/completions`);
});
it('rejects missing, unsupported or foreign-host Zen protocol rather than guessing',async()=>{
 const fetchImpl=vi.fn<typeof fetch>(),registry=createProviderRegistry({fetchImpl});
 for(const input of [{...request(),apiFormat:undefined},{...request(),apiFormat:'ANTHROPIC' as ProviderRequest['apiFormat']},
  {...request(),baseUrl:'https://attacker.example/v1'}])
  await expect(registry.ZEN.generate(input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});
it('keeps native OpenAI restricted to its own host and original request fields',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 await expect(createProviderRegistry({fetchImpl}).OPENAI.generate(request())).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});
it('preserves actual HTTP200 when the Responses body is invalid',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('{invalid'));
 await expect(createProviderRegistry({fetchImpl}).ZEN.generate(request())).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});
it('does not send a provider credential to the other official provider host',async()=>{
 const fetchImpl=vi.fn<typeof fetch>(),registry=createProviderRegistry({fetchImpl});
 await expect(registry.OPENROUTER.generate({...request(),apiFormat:'CHAT'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(registry.ZEN.generate({...request(),apiFormat:'CHAT',baseUrl:'https://openrouter.ai/api/v1',modelId:'fixture/free'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(registry.OPENROUTER.healthCheck({baseUrl:zen,modelId:'fixture-free',apiKey:'fixture-key',signal:request().signal})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});
it('rejects ambiguous Zen Responses that contain both an answer and a tool call',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...responses,output:[...responses.output,
  {type:'function_call',call_id:'call-1',name:'lookup',arguments:'{}',status:'completed'}]})));
 await expect(createProviderRegistry({fetchImpl}).ZEN.generate({...request(),tools:[{name:'lookup',description:'probe',
  parameters:{type:'object',properties:{},required:[],additionalProperties:false}}]})).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});
it('uses the documented Zen model catalog for direct and registry health without inference',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({data:[{id:'fixture-free'}]})));
 const config={baseUrl:zen,modelId:'fixture-free',apiKey:'fixture-key',signal:request().signal};
 expect(await createZenResponsesAdapter({fetchImpl}).healthCheck(config)).toBe('HEALTHY');
 expect(await createProviderRegistry({fetchImpl}).ZEN.healthCheck(config)).toBe('HEALTHY');
 expect(fetchImpl.mock.calls.map(([url,init])=>[url,init?.method])).toEqual([[`${zen}/models`,'GET'],[`${zen}/models`,'GET']]);
});
