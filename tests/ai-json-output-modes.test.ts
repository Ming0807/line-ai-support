import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {generate} from '../lib/ai/gateway';
import {createPriceReader} from '../lib/ai/pricing';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';
import {encryptValue} from '../lib/security/identity';
import {AIProviderError,type AIModelConfig,type AIAttempt,type AIProviderAdapter} from '../lib/ai/types';

const base='https://openrouter.ai/api/v1',slug='fixture/json-only:free',key=Buffer.alloc(32,13).toString('base64');
const schema=z.strictObject({decision:z.strictObject({action:z.literal('GENERAL_REPLY'),text:z.string().min(1)})});
const messages=[{role:'system' as const,content:'Preserve the supplied history and answer in Thai.'},
 {role:'assistant' as const,content:'ส่งคำตอบก่อนหน้านี้แล้ว'}, {role:'user' as const,content:'ถามต่อจากเมื่อครู่'}];
const model:AIModelConfig={id:'backup',providerId:'router',adapter:'OPENROUTER',modelId:slug,baseUrl:base,
 apiKeyEncrypted:encryptValue('synthetic-key',key),providerRevision:1,modelRevision:1,providerPriority:1,priority:0,
 timeoutMs:5000,supportsJson:true,supportsTools:true,inputPricePerMillion:0,outputPricePerMillion:0,costMode:'FREE_ONLY',apiFormat:'CHAT'};
const valid={decision:{action:'GENERAL_REPLY',text:'คำตอบภาษาไทย'}};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function fixture(parameters:unknown=['response_format'],content=JSON.stringify(valid),status=200){
 const attempts:AIAttempt[]=[],row={id:slug,pricing:{prompt:'0',completion:'0'},supported_parameters:parameters};
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async url=>{
  if(String(url)===base+'/models')return json({data:[row]});
  if(String(url)===base+'/chat/completions')return json(status===200?{
   choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:20,completion_tokens:10},
  }:{error:{message:'Controlled unsupported parameter'}},status);
  throw new Error('Unexpected controlled URL');
 });
 const options={key,store:{loadModels:async()=>[model],recordAttempt:async(a:AIAttempt)=>{attempts.push(a);}},
  priceReader:createPriceReader({fetchImpl}),adapters:{OPENROUTER:createChatCompletionsAdapter({fetchImpl})}};
 const input={taskType:'ASSISTANT_DECISION',messages,responseName:'assistant_decision',responseSchema:schema,timeoutMs:9000};
 const bodies=()=>fetchImpl.mock.calls.filter(([url])=>String(url).endsWith('/chat/completions')).map(([,init])=>JSON.parse(String(init?.body)));
 return {fetchImpl,row,attempts,options,input,bodies};
}

it('uses explicitly advertised JSON object transport with backend schema instruction and every original message intact',async()=>{
 const f=fixture();const result=await generate(f.input,f.options),body=f.bodies()[0];
 expect(result.output).toEqual(valid);expect(body.response_format).toEqual({type:'json_object'});
 expect(body.messages).toContainEqual(expect.objectContaining({role:'system',content:expect.stringContaining('additionalProperties')}));
 expect(body.messages.slice(-messages.length)).toEqual(messages);
 expect(body.provider).toEqual({max_price:{prompt:0,completion:0},require_parameters:true});
 expect(f.fetchImpl).toHaveBeenCalledTimes(2);expect(f.attempts[0]).toMatchObject({status:'SUCCESS',httpStatus:200});
});

it.each([[['structured_outputs','response_format']],[['structured_outputs']]])('prefers strict schema when explicitly supported: %j',async parameters=>{
 const f=fixture(parameters);await generate(f.input,f.options);const body=f.bodies()[0];
 expect(body.response_format.type).toBe('json_schema');expect(body.response_format.json_schema.strict).toBe(true);
 expect(body.messages).toEqual(messages);
});

it('limits catalog output-mode evidence to generation and rejects duplicate exact model identities',async()=>{
 const f=fixture(),read=createPriceReader({fetchImpl:f.fetchImpl}),query={adapter:'OPENROUTER',baseUrl:base,modelId:slug,purpose:'GENERATION' as const};
 expect(await read(query,new AbortController().signal)).toMatchObject({jsonOutputMode:'JSON_OBJECT'});
 f.fetchImpl.mockResolvedValueOnce(json({data:[f.row]}));
 expect(await read({...query,purpose:'EMBEDDING'},new AbortController().signal)).not.toHaveProperty('jsonOutputMode');
 f.fetchImpl.mockResolvedValueOnce(json({data:[f.row,f.row]}));
 expect(await read(query,new AbortController().signal)).toMatchObject({status:'UNKNOWN'});
});

it.each([
 {parameters:undefined},{parameters:null},{parameters:[]},{parameters:['reasoning']},
 {parameters:['response_format',false]},{parameters:['response_format','response_format']},
])('does not infer JSON-only capability from unknown or malformed metadata: %j',async({parameters})=>{
 const f=fixture(parameters);f.row.supported_parameters=parameters;await generate(f.input,f.options);
 expect(f.bodies()[0].response_format.type).toBe('json_schema');
});

it('does not grant a model tools through a JSON-only response',async()=>{
 const f=fixture();f.fetchImpl.mockImplementation(async url=>String(url).endsWith('/models')?json({data:[f.row]}):json({
  choices:[{index:0,finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{
   id:'forged-call',type:'function',function:{name:'create_ticket',arguments:'{}'},
  }]}}],usage:{prompt_tokens:20,completion_tokens:10},
 }));
 await expect(generate(f.input,f.options)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 expect(f.bodies()[0].response_format.type).toBe('json_object');expect(f.attempts[0].status).toBe('ERROR');
});

it.each([
 JSON.stringify({decision:{action:'DELETE_DATABASE',text:'invalid'}}),
 JSON.stringify({...valid,extra:'must not be accepted'}),
 JSON.stringify({decision:{action:'GENERAL_REPLY',text:42}}),
])('rejects schema-invalid JSON with HTTP200 and never reports it as successful: %s',async content=>{
 const f=fixture(['response_format'],content);
 await expect(generate(f.input,f.options)).rejects.toMatchObject({code:'INVALID_OUTPUT',outputSubreason:'SCHEMA',httpStatus:200});
 expect(f.bodies()[0].response_format.type).toBe('json_object');expect(f.bodies()).toHaveLength(1);
 expect(f.attempts[0]).toMatchObject({status:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
});

it('rejects fenced output without stripping or repairing it',async()=>{
 const f=fixture(['response_format'],'```json\n'+JSON.stringify(valid)+'\n```');
 await expect(generate(f.input,f.options)).rejects.toMatchObject({code:'INVALID_OUTPUT',outputSubreason:'JSON_PARSE'});
 expect(f.bodies()[0].response_format.type).toBe('json_object');expect(f.bodies()).toHaveLength(1);
});

it('does not use JSON object transport for a native-tool request',async()=>{
 const f=fixture();await generate({...f.input,tools:[{name:'search_knowledge',description:'Controlled lookup',parameters:{
  type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false,
 }}]},f.options);
 const body=f.bodies()[0];expect(body.response_format.type).toBe('json_schema');expect(body.tools[0].function.strict).toBe(true);
});

it('does not retry or switch wire format after a400 response',async()=>{
 const f=fixture(['response_format'],undefined,400);
 await expect(generate(f.input,f.options)).rejects.toMatchObject({code:'INVALID_REQUEST',httpStatus:400});
 expect(f.bodies()).toHaveLength(1);expect(f.bodies()[0].response_format.type).toBe('json_object');
});

it.each(['STALE','PAID'] as const)('does not allow JSON capability to bypass %s pricing',async condition=>{
 const f=fixture();f.options.priceReader=async()=>({status:condition==='PAID'?'PAID':'FREE',
  inputPricePerMillion:condition==='PAID'?1:0,outputPricePerMillion:condition==='PAID'?1:0,
  apiFormat:'CHAT',checkedAt:new Date(Date.now()-(condition==='STALE'?61000:0)).toISOString(),jsonOutputMode:'JSON_OBJECT'});
 await expect(generate(f.input,f.options)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(f.bodies()).toHaveLength(0);
});

it.each([false,true])('keeps Gemini primary first and uses JSON-only OpenRouter only after primary failure=%s',async fail=>{
 const f=fixture(),primary={...model,id:'primary',providerId:'google',adapter:'COMPATIBLE',
  modelId:'gemini-3.5-flash-lite',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',providerPriority:0};
 const adapter:AIProviderAdapter={generate:vi.fn(async()=>{
  if(fail)throw new AIProviderError('RATE_LIMITED',429);
  return {output:valid,toolCalls:[],inputTokens:20,outputTokens:10,httpStatus:200};
 }),healthCheck:vi.fn()};
 const result=await generate(f.input,{...f.options,store:{...f.options.store,loadModels:async()=>[primary,model],
  readAccountFreeUntil:async()=>new Date(Date.now()+86400000).toISOString()},adapters:{...f.options.adapters,COMPATIBLE:adapter}});
 expect(result.fallbackUsed).toBe(fail);expect(vi.mocked(adapter.generate).mock.calls[0][0]).not.toHaveProperty('jsonOutputMode');
 if(fail)expect(f.bodies()[0].response_format).toEqual({type:'json_object'});else expect(f.fetchImpl).not.toHaveBeenCalled();
});
