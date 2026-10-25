import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {generate} from '../lib/ai/gateway';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';
import {encryptValue} from '../lib/security/identity';
import {AIProviderError,type AIModelConfig,type AIAttempt,type ProviderRequest} from '../lib/ai/types';

const secret='fixture-key-never-log',apiKey='test-key-never-log',key=Buffer.alloc(32,7).toString('base64');
const schema=z.object({answer:z.string()}).strict();

function chatRequest():ProviderRequest {
 return {modelId:'openai/gpt-test:free',baseUrl:'https://openrouter.ai/api/v1',apiKey,
  messages:[{role:'system',content:'Return JSON.'},{role:'user',content:'Private user question'}],
  responseSchema:{name:'answer',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}},
  signal:new AbortController().signal,maxOutputTokens:64,apiFormat:'CHAT',costMode:'FREE_ONLY'};
}

function adapterResponse(content:string|null,extra:Record<string,unknown>={}):Response {
 return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content,...extra}}],
  usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});
}

function model():AIModelConfig {
 return {id:'model-row-safe-id',providerId:'provider-row-safe-id',adapter:'MOCK',modelId:'safe-model',baseUrl:'https://api.openai.com/v1',
  apiKeyEncrypted:encryptValue(secret,key),providerRevision:0,modelRevision:0,providerPriority:1,priority:1,timeoutMs:1000,
  supportsJson:true,supportsTools:false,inputPricePerMillion:0,outputPricePerMillion:0,costMode:'ALLOW_PAID'};
}

it('labels malformed provider JSON without retaining its contents and preserves HTTP status',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('{provider-private-text',{
  status:200,headers:{'content-type':'application/json'}}));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(chatRequest()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200,outputSubreason:'JSON_PARSE',message:'INVALID_OUTPUT'});
});

it('labels refusal and truncated provider completions with safe fixed subreasons',async()=>{
 const refusal=createChatCompletionsAdapter({fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(adapterResponse(null,{refusal:'private refusal detail'}))});
 await expect(refusal.generate(chatRequest())).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200,outputSubreason:'REFUSAL'});
 const truncated=createChatCompletionsAdapter({fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
  choices:[{index:0,finish_reason:'length',message:{role:'assistant',content:'{"answer":"partial'}}],
  usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}),{status:200}))});
 await expect(truncated.generate(chatRequest())).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200,outputSubreason:'TRUNCATION'});
});

it('logs only enum subreason and safe attempt metadata for rejected structured output',async()=>{
 const attempts:AIAttempt[]=[],m=model(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const adapter={generate:vi.fn().mockResolvedValue({output:{answer:'private provider output',extra:'private detail'},toolCalls:[],inputTokens:3,outputTokens:2,httpStatus:200}),
  healthCheck:vi.fn()};
 try{
  await expect(generate({taskType:'SUPPORT_INTENT',messages:[{role:'user',content:'private question'}],responseSchema:schema,responseName:'answer',timeoutMs:500},
   {key,adapters:{MOCK:adapter},store:{loadModels:async()=>[m],recordAttempt:async(attempt:AIAttempt)=>{attempts.push(attempt);}}}))
   .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200,outputSubreason:'SCHEMA'});
  expect(attempts).toMatchObject([{status:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200}]);
  const logged=warn.mock.calls.map(call=>call.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ')).join('\n');
  expect(logged).toContain('INVALID_OUTPUT');expect(logged).toContain('SCHEMA');expect(logged).toContain('SUPPORT_INTENT');
  expect(logged).not.toContain(secret);expect(logged).not.toContain(apiKey);expect(logged).not.toContain('private question');
  expect(logged).not.toContain('private provider output');expect(logged).not.toContain('private detail');
 }finally{warn.mockRestore();}
});

it('preserves adapter subreason through gateway fallback while keeping provider error text private',async()=>{
 const attempts:AIAttempt[]=[],models=[model(),{...model(),id:'second-model-row',providerId:'second-provider-row',priority:2}],
  warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),adapter={
   generate:vi.fn().mockRejectedValueOnce(new AIProviderError('INVALID_OUTPUT',200,undefined,'JSON_PARSE'))
    .mockResolvedValue({output:{answer:'ok'},toolCalls:[],inputTokens:3,outputTokens:2,httpStatus:200}),healthCheck:vi.fn(),
  };
 try{
  const result=await generate({taskType:'SUPPORT_SOCIAL',messages:[{role:'user',content:'private question'}],responseSchema:schema,responseName:'answer',timeoutMs:1000},
   {key,adapters:{MOCK:adapter},store:{loadModels:async()=>models,recordAttempt:async(attempt:AIAttempt)=>{attempts.push(attempt);}}});
  expect(result.output).toEqual({answer:'ok'});expect(attempts[0]).toMatchObject({status:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
  const logged=JSON.stringify(warn.mock.calls);expect(logged).toContain('JSON_PARSE');expect(logged).not.toContain(secret);expect(logged).not.toContain('private question');
 }finally{warn.mockRestore();}
});
