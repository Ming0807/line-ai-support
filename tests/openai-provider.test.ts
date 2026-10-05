import {expect,it,vi} from 'vitest';
import {createOpenAIAdapter} from '../lib/ai/providers/openai';
import type {ProviderRequest} from '../lib/ai/types';

function request(signal:AbortSignal):ProviderRequest {
 return {
  modelId:'gpt-test-1',baseUrl:'https://api.openai.com/v1',apiKey:'test-key-never-log',
  messages:[{role:'system',content:'Return JSON.'},{role:'user',content:'Hello'}],
  responseSchema:{name:'answer',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}},
  signal,maxOutputTokens:64,
 };
}

function fetchFor(payload:unknown,status=200):typeof fetch {
 return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload),{status}));
}

it('sends strict Responses JSON schema and normalizes one structured assistant result',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
  status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"answer":"hello"}'}]}],
  usage:{input_tokens:5,output_tokens:3},
 }),{status:200,headers:{'content-type':'application/json'}}));
 const adapter=createOpenAIAdapter({fetchImpl});
 const signal=new AbortController().signal;

 const result=await adapter.generate(request(signal));

 expect(fetchImpl).toHaveBeenCalledTimes(1);
 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe('https://api.openai.com/v1/responses');
 expect(init?.method).toBe('POST');
 expect(init?.redirect).toBe('error');
 expect(init?.signal).toBe(signal);
 expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key-never-log');
 const body=JSON.parse(String(init?.body));
 expect(body.model).toBe('gpt-test-1');
 expect(body.max_output_tokens).toBe(64);
 expect(body.text.format).toEqual({
  type:'json_schema',name:'answer',strict:true,
  schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false},
 });
 expect(body.store).toBe(false);
 expect(body.input).toEqual([
  {role:'system',content:'Return JSON.'},{role:'user',content:'Hello'},
 ]);
 expect(result).toEqual({output:{answer:'hello'},toolCalls:[],inputTokens:5,outputTokens:3,httpStatus:200});
});

it('rejects unexpected request fields before contacting the provider',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const input=request(new AbortController().signal);
 Object.assign(input.messages[0]!,{unexpected:'must not be serialized'});

 const adapter=createOpenAIAdapter({fetchImpl});

 await expect(adapter.generate(input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('returns OFFLINE from model health when the network is unavailable',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private network details'));
 const adapter=createOpenAIAdapter({fetchImpl});

 await expect(adapter.healthCheck({modelId:'gpt-test-1',baseUrl:'https://api.openai.com/v1',
  apiKey:'test-key-never-log',signal:new AbortController().signal})).resolves.toBe('OFFLINE');
});

it('rejects unexpected health configuration fields before contacting the provider',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const config=Object.assign({modelId:'gpt-test-1',baseUrl:'https://api.openai.com/v1',apiKey:'test-key-never-log',
  signal:new AbortController().signal},{unexpected:'must not be serialized'});

 await expect(createOpenAIAdapter({fetchImpl}).healthCheck(config)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('sends strict function tools and returns tool calls as data',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
  status:'completed',output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'lookup_department',
   arguments:'{"code":"IT"}',status:'completed'}],usage:{input_tokens:9,output_tokens:4},
 }),{status:200}));
 const input=request(new AbortController().signal);
 input.tools=[{name:'lookup_department',description:'Find a department by code.',parameters:{
  type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false,
 }}];
 const result=await createOpenAIAdapter({fetchImpl}).generate(input);

 const [,init]=fetchImpl.mock.calls[0]!;
 const body=JSON.parse(String(init?.body));
 expect(body.tools).toEqual([{type:'function',name:'lookup_department',description:'Find a department by code.',
  parameters:input.tools[0]!.parameters,strict:true}]);
 expect(result).toEqual({output:null,toolCalls:[{id:'call_1',name:'lookup_department',arguments:{code:'IT'}}],inputTokens:9,outputTokens:4,httpStatus:200});
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('rejects a schema that cannot honor strict object requirements before HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const input=request(new AbortController().signal);
 input.tools=[{name:'lookup_department',description:'Find a department by code.',parameters:{
  type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:true,
 }}];

 await expect(createOpenAIAdapter({fetchImpl}).generate(input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a non-object JSON result for an object response schema',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
  status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'[]'}]}],
 }),{status:200}));

 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('rejects non-finite numbers produced by JSON parsing',async()=>{
 const fetchImpl=fetchFor({status:'completed',output:[{type:'message',role:'assistant',content:[{
  type:'output_text',text:'{"answer":"hello","value":1e999}',
 }]}]});
 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

const invalidResponses:Array<[string,unknown]>=[
 ['a refusal',{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'private refusal text'}]}]}],
 ['an incomplete response',{status:'incomplete',output:[]}],
 ['malformed JSON',{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'not-json'}]}]}],
 ['multiple JSON outputs',{status:'completed',output:[
  {type:'message',role:'assistant',content:[{type:'output_text',text:'{"answer":"one"}'}]},
  {type:'message',role:'assistant',content:[{type:'output_text',text:'{"answer":"two"}'}]},
 ]}],
];

it.each(invalidResponses)('maps %s to a fixed INVALID_OUTPUT error',async(_label,payload)=>{
 const adapter=createOpenAIAdapter({fetchImpl:fetchFor(payload)});
 await expect(adapter.generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('maps a malformed HTTP response document to fixed INVALID_OUTPUT',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('{invalid provider document',{status:200}));
 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('rejects a function-call item that is not completed',async()=>{
 const input=request(new AbortController().signal);
 input.tools=[{name:'lookup_department',description:'Lookup a department.',parameters:{
  type:'object',properties:{},required:[],additionalProperties:false,
 }}];
 const fetchImpl=fetchFor({status:'completed',output:[{type:'function_call',call_id:'call_1',name:'lookup_department',
  arguments:'{}',status:'incomplete'}]});

 await expect(createOpenAIAdapter({fetchImpl}).generate(input))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it.each([
 ['malformed arguments','lookup_department','{bad-json}'],
 ['an unrequested function','unlisted_tool','{}'],
] as const)('rejects %s as fixed INVALID_OUTPUT',async(_label,name,argumentsText)=>{
 const input=request(new AbortController().signal);
 input.tools=[{name:'lookup_department',description:'Lookup a department.',parameters:{
  type:'object',properties:{},required:[],additionalProperties:false,
 }}];
 const fetchImpl=fetchFor({status:'completed',output:[{type:'function_call',call_id:'call_1',name,arguments:argumentsText}]});

 await expect(createOpenAIAdapter({fetchImpl}).generate(input))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('rejects duplicate function call IDs',async()=>{
 const input=request(new AbortController().signal);
 input.tools=[{name:'lookup_department',description:'Lookup a department.',parameters:{
  type:'object',properties:{},required:[],additionalProperties:false,
 }}];
 const call={type:'function_call',call_id:'same_id',name:'lookup_department',arguments:'{}'};
 const fetchImpl=fetchFor({status:'completed',output:[call,call]});
 await expect(createOpenAIAdapter({fetchImpl}).generate(input))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

const httpErrorCases:Array<[number,string,boolean]>=[
 [400,'INVALID_REQUEST',false],[401,'AUTH_ERROR',false],[403,'AUTH_ERROR',false],
 [404,'MODEL_UNAVAILABLE',true],[429,'RATE_LIMITED',true],[500,'SERVER_ERROR',true],[503,'SERVER_ERROR',true],
];

it.each(httpErrorCases)('maps HTTP %i to %s without reading its body',async(status,code,retryable)=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('provider-private-error'));},
  cancel(){cancelled=true;},
 }),{status});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);

 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code,message:code,httpStatus:status,retryable});
 expect(cancelled).toBe(true);
 const [,init]=fetchImpl.mock.calls[0]!;
 expect(init?.redirect).toBe('error');
});

it('normalizes network-down errors without exposing provider details',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private transport detail'));

 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
});

it('rejects malformed configuration before HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const adapter=createOpenAIAdapter({fetchImpl});
 const invalidInputs=[
  Object.assign(request(new AbortController().signal),{baseUrl:'https://api.openai.com/v1/../attacker'}),
  Object.assign(request(new AbortController().signal),{modelId:'../model'}),
  Object.assign(request(new AbortController().signal),{apiKey:' key-with-whitespace '}),
  Object.assign(request(new AbortController().signal),{messages:[]}),
  Object.assign(request(new AbortController().signal),{responseSchema:{name:'bad schema',schema:{type:'object',properties:{},required:[],additionalProperties:false}}}),
 ];
 for(const input of invalidInputs){
  await expect(adapter.generate(input)).rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 }
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('accepts model IDs through the shared 200 character limit',async()=>{
 const modelId='m'.repeat(200);
 const input=request(new AbortController().signal);
 input.modelId=modelId;
 const fetchImpl=fetchFor({status:'completed',output:[{type:'message',role:'assistant',content:[{
  type:'output_text',text:'{"answer":"hello"}',
 }]}]});

 await createOpenAIAdapter({fetchImpl}).generate(input);
 const [,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 expect(JSON.parse(String(init?.body)).model).toBe(modelId);
});

it('cancels an oversized response stream at the 256 KiB limit',async()=>{
 let cancelled=false;
 const body=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(256*1024+1)));},
  cancel(){cancelled=true;},
 });
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(body,{status:200}));

 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
 expect(cancelled).toBe(true);
});

it('normalizes incomplete response-body reads without exposing stream errors',async()=>{
 const body=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('{'));},
  pull(controller){controller.error(new Error('private stream detail'));},
 });
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(body,{status:200}));

 await expect(createOpenAIAdapter({fetchImpl}).generate(request(new AbortController().signal)))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
});

it('cancels promptly when the response reader remains pending after abort',async()=>{
 let markReadStarted!:()=>void;
 const readStarted=new Promise<void>((resolve)=>{markReadStarted=resolve;});
 const reader={
  read:vi.fn(()=>{
   markReadStarted();
   return new Promise<ReadableStreamReadResult<Uint8Array>>(()=>{});
  }),
  cancel:vi.fn().mockResolvedValue(undefined),
  releaseLock:vi.fn(),
 };
 const response=new Response(null,{status:200});
 Object.defineProperty(response,'body',{value:{getReader:()=>reader}});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);
 const controller=new AbortController();
 const pending=createOpenAIAdapter({fetchImpl}).generate(request(controller.signal));

 await readStarted;
 controller.abort(new DOMException('private cancellation detail','AbortError'));

 const outcome=await Promise.race([
  pending.then(
   ()=>({kind:'resolved' as const}),
   (error:unknown)=>({kind:'rejected' as const,error}),
  ),
  new Promise<{kind:'pending'}>((resolve)=>setTimeout(()=>resolve({kind:'pending'}),100)),
 ]);

 expect(outcome).toMatchObject({kind:'rejected',error:{code:'CANCELLED',message:'CANCELLED'}});
 expect(reader.cancel).toHaveBeenCalledOnce();
});

it.each([
 ['user cancellation','AbortError','CANCELLED'],
 ['timeout','TimeoutError','TIMEOUT'],
] as const)('normalizes an already-aborted %s signal',async(_label,reasonName,code)=>{
 const controller=new AbortController();
 controller.abort(new DOMException('private cancellation detail',reasonName));
 const fetchImpl=vi.fn<typeof fetch>();

 await expect(createOpenAIAdapter({fetchImpl}).generate(request(controller.signal)))
  .rejects.toMatchObject({code,message:code});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('uses an encoded model path and the same credential for the health request',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:'ft:test-model'}),{status:200}));
 const adapter=createOpenAIAdapter({fetchImpl});

 await expect(adapter.healthCheck({modelId:'ft:test-model',baseUrl:'https://api.openai.com/v1/',
  apiKey:'test-key-never-log',signal:new AbortController().signal})).resolves.toBe('HEALTHY');
 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe('https://api.openai.com/v1/models/ft%3Atest-model');
 expect(init?.method).toBe('GET');
 expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key-never-log');
 expect(init?.redirect).toBe('error');
});

it.each([
 [400,'DEGRADED'],[401,'OFFLINE'],[403,'OFFLINE'],[404,'DEGRADED'],[429,'RATE_LIMITED'],[500,'OFFLINE'],
] as const)('maps health HTTP %i to %s',async(status,health)=>{
 const adapter=createOpenAIAdapter({fetchImpl:fetchFor({error:'private'},status)});
 await expect(adapter.healthCheck({modelId:'gpt-test-1',baseUrl:'https://api.openai.com/v1',
  apiKey:'test-key-never-log',signal:new AbortController().signal})).resolves.toBe(health);
});
