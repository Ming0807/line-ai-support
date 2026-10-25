import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {createPriceReader,type PriceQuery} from '../lib/ai/pricing';
import {generate} from '../lib/ai/gateway';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';
import type {AIModelConfig,AIAttempt} from '../lib/ai/types';
import {encryptValue} from '../lib/security/identity';

const OPENROUTER='https://openrouter.ai/api/v1';
const ZEN='https://opencode.ai/zen/v1';
const KILO='https://api.kilo.ai/api/gateway';
const MODEL='openai/gpt-test:free';
const KEY=Buffer.alloc(32,9).toString('base64');
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const outputSchema=z.object({answer:z.string()}).strict();
const pricing={prompt:0,completion:0};
const supportedRow=(overrides:Record<string,unknown>={})=>({id:MODEL,pricing,
 reasoning:{mandatory:false},supported_parameters:['reasoning'],...overrides});
const query=(overrides:Partial<PriceQuery>={}):PriceQuery=>({adapter:'OPENROUTER',baseUrl:OPENROUTER,modelId:MODEL,purpose:'GENERATION',...overrides});

function completionResponse(){return json({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'{"answer":"hello"}'}}],
 usage:{prompt_tokens:3,completion_tokens:2}});}

function configuredModel(adapter='OPENROUTER',baseUrl=OPENROUTER,modelId=MODEL):AIModelConfig{return {
 id:'model-row',providerId:'provider-row',adapter,modelId,baseUrl,apiKeyEncrypted:encryptValue('fixture-key',KEY),
 providerRevision:1,modelRevision:1,providerPriority:0,priority:0,timeoutMs:6000,supportsJson:true,supportsTools:false,
 inputPricePerMillion:0,outputPricePerMillion:0,costMode:'FREE_ONLY',apiFormat:'CHAT',
};}

async function generateWithCatalog(row:Record<string,unknown>,reasoningMode?:string,overrides:{adapter?:string;baseUrl?:string;modelId?:string}={}){
 const model=configuredModel(overrides.adapter,overrides.baseUrl,overrides.modelId);
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
  const url=String(input);
  if(url===`${OPENROUTER}/models`)return json({data:[row]});
  if(url===`${OPENROUTER}/chat/completions`)return completionResponse();
  if(url==='https://models.dev/api.json')return json({opencode:{api:ZEN,models:{'fixture-zen':{
   id:'fixture-zen',cost:{input:0,output:0},provider:{npm:'@ai-sdk/openai-compatible'},
   reasoning:{mandatory:false},supported_parameters:['reasoning'],
  }}}});
  if(url===`${ZEN}/models`)return json({data:[{id:'fixture-zen'}]});
  if(url===`${KILO}/models`)return json({data:[{id:'kilo-auto/free',pricing,reasoning:{mandatory:false},supported_parameters:['reasoning']}]});
  throw new Error(`Unexpected fixture URL or method: ${init?.method} ${url}`);
 });
 const attempts:AIAttempt[]=[];
 const input={taskType:'SOCIAL',messages:[{role:'user' as const,content:'สวัสดี'}],responseSchema:outputSchema,responseName:'answer',timeoutMs:9000,
  ...(reasoningMode===undefined?{}:{reasoningMode})} as never;
 const result=await generate(input,{key:KEY,store:{loadModels:async()=>[model],recordAttempt:async(attempt:AIAttempt)=>{attempts.push(attempt);}},
  priceReader:createPriceReader({fetchImpl}),adapters:{OPENROUTER:createChatCompletionsAdapter({fetchImpl}),
   ZEN:createChatCompletionsAdapter({fetchImpl}),COMPATIBLE:createChatCompletionsAdapter({fetchImpl})}});
 const call=fetchImpl.mock.calls.find(([url])=>String(url).endsWith('/chat/completions'));
 return {result,attempts,fetchImpl,body:call?JSON.parse(String(call[1]?.body)) as Record<string,unknown>:undefined};
}

it('grants disable permission only to an exact OpenRouter row with optional reasoning support',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[supportedRow()]}));
 const result=await createPriceReader({fetchImpl})(query(),new AbortController().signal);
 expect(result).toMatchObject({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,apiFormat:'CHAT',canDisableReasoning:true});
 expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${OPENROUTER}/models`);
});

it.each([
 ['mandatory reasoning',supportedRow({reasoning:{mandatory:true}})],
 ['missing reasoning metadata',supportedRow({reasoning:undefined})],
 ['missing supported parameter',supportedRow({supported_parameters:[]})],
 ['missing supported parameters',supportedRow({supported_parameters:undefined})],
])('does not grant disable permission for %s catalog metadata',async(_label,row)=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[row]}));
 const result=await createPriceReader({fetchImpl})(query(),new AbortController().signal);
 expect(result.status).toBe('FREE');expect(result).not.toHaveProperty('canDisableReasoning');
});

it('omits disable permission for embedding, Zen, and Kilo even when metadata advertises it',async()=>{
 const openrouterFetch=vi.fn<typeof fetch>().mockResolvedValue(json({data:[supportedRow()]}));
 const embedding=await createPriceReader({fetchImpl:openrouterFetch})(query({purpose:'EMBEDDING'}),new AbortController().signal);
 expect(embedding.status).toBe('FREE');expect(embedding).not.toHaveProperty('canDisableReasoning');
 expect(openrouterFetch.mock.calls[0]?.[0]).toBe(`${OPENROUTER}/embeddings/models`);

 for(const provider of [
  {adapter:'ZEN',baseUrl:ZEN,modelId:'fixture-zen'},
  {adapter:'COMPATIBLE',baseUrl:KILO,modelId:'kilo-auto/free'},
 ]){
  const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async(input)=>{
   const url=String(input);
   if(url==='https://models.dev/api.json')return json({opencode:{api:ZEN,models:{'fixture-zen':{
    id:'fixture-zen',cost:{input:0,output:0},provider:{npm:'@ai-sdk/openai-compatible'},
    reasoning:{mandatory:false},supported_parameters:['reasoning'],
   }}}});
   if(url===`${ZEN}/models`)return json({data:[{id:'fixture-zen'}]});
   return json({data:[{id:'kilo-auto/free',pricing,reasoning:{mandatory:false},supported_parameters:['reasoning']}]});
  });
  const result=await createPriceReader({fetchImpl})({...provider,purpose:'GENERATION'},new AbortController().signal);
  expect(result.status).toBe('FREE');expect(result).not.toHaveProperty('canDisableReasoning');
 }
});

it('uses freshly authorized OpenRouter catalog permission for OFF_IF_SUPPORTED and preserves free routing bounds',async()=>{
 const f=await generateWithCatalog(supportedRow(),'OFF_IF_SUPPORTED');
 expect(f.result.output).toEqual({answer:'hello'});expect(f.attempts[0]).toMatchObject({status:'SUCCESS',httpStatus:200});
 expect(f.body).toMatchObject({reasoning:{enabled:false},provider:{max_price:{prompt:0,completion:0},require_parameters:true}});
 expect(f.fetchImpl.mock.calls.map(([url])=>String(url))).toEqual([`${OPENROUTER}/models`,`${OPENROUTER}/chat/completions`]);
});

it.each([
 ['default mode',undefined,supportedRow()],
 ['mandatory reasoning', 'OFF_IF_SUPPORTED',supportedRow({reasoning:{mandatory:true}})],
 ['missing metadata','OFF_IF_SUPPORTED',supportedRow({reasoning:undefined})],
 ['unsupported parameter','OFF_IF_SUPPORTED',supportedRow({supported_parameters:[]})],
])('does not disable reasoning for %s',async(_label,mode,row)=>{
 const f=await generateWithCatalog(row,mode);
 expect(f.result.output).toEqual({answer:'hello'});expect(f.body).not.toHaveProperty('reasoning');
});

it('rejects malformed reasoning preference before reading a catalog or making provider HTTP',async()=>{
 const model=configuredModel(),fetchImpl=vi.fn<typeof fetch>();
 const adapter=createChatCompletionsAdapter({fetchImpl});
 const input={taskType:'SOCIAL',messages:[{role:'user' as const,content:'Hi'}],responseSchema:outputSchema,responseName:'answer',
  reasoningMode:'ALWAYS_OFF'} as never;
 await expect(generate(input,{key:KEY,store:{loadModels:async()=>[model],recordAttempt:vi.fn()},priceReader:createPriceReader({fetchImpl}),
  adapters:{OPENROUTER:adapter}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('sends disableReasoning only for OpenRouter true and rejects Zen true before HTTP',async()=>{
 for(const value of [undefined,false,true]){
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(completionResponse());
  const request={modelId:MODEL,baseUrl:OPENROUTER,apiKey:'fixture-key',messages:[{role:'user' as const,content:'hello'}],
   responseSchema:{name:'answer',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}},
   signal:new AbortController().signal,costMode:'FREE_ONLY',apiFormat:'CHAT',...(value===undefined?{}:{disableReasoning:value})};
  await createChatCompletionsAdapter({fetchImpl}).generate(request as never);
  const body=JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string,unknown>;
  if(value===true)expect(body.reasoning).toEqual({enabled:false});else expect(body).not.toHaveProperty('reasoning');
 }
 const fetchImpl=vi.fn<typeof fetch>();
 await expect(createChatCompletionsAdapter({fetchImpl}).generate({
  modelId:'fixture-zen',baseUrl:ZEN,apiKey:'fixture-key',messages:[{role:'user',content:'hello'}],
  responseSchema:{name:'answer',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}},
  signal:new AbortController().signal,apiFormat:'CHAT',disableReasoning:true,
 } as never)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});
