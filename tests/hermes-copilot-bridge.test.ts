import {afterEach,describe,expect,it,vi} from 'vitest';
import {startHermesPilotBridge} from '../lib/ai/hermes-pilot-bridge';

const token='synthetic-copilot-token-with-more-than-32-characters';
const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closers.splice(0))await close();});
const toolSupport={description:'ค้นคลังเอกสารที่เผยแพร่',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']},
 execute:vi.fn(async(args:{query:string})=>({rows:[{title:'คู่มือ',snippet:'เนื้อหา '+args.query}]})),maxToolCalls:2};
const copilotReply=vi.fn(async(messages:unknown[],tools:unknown)=>{
 void messages;void tools;
 return {toolCalls:[{id:'call-1',name:'search_yru_knowledge',arguments:{query:'mac address'}}]};
});
async function setup(){
 const bridge=await startHermesPilotBridge({token,maxRequests:4,reply:vi.fn(async()=>'unused'),toolSupport:{...toolSupport,reply:copilotReply}});
 closers.push(bridge.close);
 const send=(path:string,body:unknown,key=token)=>fetch(bridge.url+path,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)});
 return {bridge,send};
}
const baseRequest={model:'yru-free-pilot',messages:[{role:'user',content:'จะลงทะเบียน Mac Address อย่างไร'}],stream:false,
 tools:[{type:'function' as const,function:{name:'search_yru_knowledge',properties:{query:{type:'string'}},required:['query'],parameters:{type:'object'}}}]};

describe('Hermes copilot bridge',()=>{
 it('formats a model tool decision as an OpenAI tool_calls response',async()=>{
  const x=await setup();
  const res=await x.send('/chat/completions',baseRequest);
  expect(res.status).toBe(200);
  const body=await res.json() as {choices:{message:{tool_calls:{function:{name:string;arguments:string}}[]};finish_reason:string}[]};
  expect(body.choices[0].finish_reason).toBe('tool_calls');
  expect(body.choices[0].message.tool_calls[0].function.name).toBe('search_yru_knowledge');
  expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments)).toEqual({query:'mac address'});
 });
 it('validates and canonicalizes JSON-string tool arguments',async()=>{
  const x=await setup();
  copilotReply.mockResolvedValueOnce({toolCalls:[{id:'call-1',name:'search_yru_knowledge',arguments:'{"query":"mac address"}'}]} as never);
  const res=await x.send('/chat/completions',baseRequest);
  const body=await res.json() as {choices:{message:{tool_calls:{function:{arguments:string}}[]}}[]};
  expect(res.status).toBe(200);
  expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments)).toEqual({query:'mac address'});
 });
 it('returns plain content when the model answers directly',async()=>{
  const bridge=await startHermesPilotBridge({token,maxRequests:2,reply:vi.fn(async()=>'v1-unused'),
   toolSupport:{...toolSupport,reply:async()=>({content:'ตอบตรงๆ'})}});
  closers.push(bridge.close);
  const res=await fetch(bridge.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(baseRequest)});
  expect(((await res.json()) as {choices:{message:{content:string}}[]}).choices[0].message.content).toBe('ตอบตรงๆ');
 });
 it('executes the allowlisted read-only tool with auth, budget and shape checks',async()=>{
  const x=await setup();
  expect((await x.send('/tools/search_yru_knowledge',{query:'wifi'},'wrong')).status).toBe(401);
  expect((await x.send('/tools/search_yru_knowledge',{query:''})).status).toBe(400);
  expect((await x.send('/tools/search_yru_knowledge',{query:'wifi'})).status).toBe(200);
  expect(toolSupport.execute).toHaveBeenCalledWith({query:'wifi'},expect.any(AbortSignal));
  expect((await x.send('/tools/search_yru_knowledge',{query:'อื่นๆ'})).status).toBe(200);
  expect((await x.send('/tools/search_yru_knowledge',{query:'เกินโควตา'})).status).toBe(429);
 });
 it('accepts the agentic conversation shape (assistant tool_calls echo and tool results)',async()=>{
  const x=await setup();
  const res=await x.send('/chat/completions',{...baseRequest,messages:[
   {role:'user',content:'จะลงทะเบียน Mac Address อย่างไร'},
   {role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'search_yru_knowledge',arguments:'{"query":"mac"}'}}]},
   {role:'tool',tool_call_id:'call-1',name:'search_yru_knowledge',content:'{"rows":[{"title":"คู่มือ MAC","snippet":"เปิด Passport"}]}'},
  ]});
  expect(res.status).toBe(200);
  expect(copilotReply.mock.calls[0][1]).toEqual(baseRequest.tools);
 });
 it('still rejects foreign tool names and oversized conversations',async()=>{
  const x=await setup();
  expect((await x.send('/chat/completions',{...baseRequest,tools:[{type:'function',function:{name:'terminal'}}]})).status).toBe(400);
  expect((await x.send('/chat/completions',{...baseRequest,messages:[{role:'user',content:'x'.repeat(40000)}]})).status).toBe(400);
  expect(copilotReply).not.toHaveBeenCalled();
 });
 it('allows up to eight model requests only in copilot mode',async()=>{
  await setup();
  await expect(startHermesPilotBridge({token,maxRequests:6,reply:vi.fn(async()=>'x')})).rejects.toThrow('INVALID_PILOT_CONFIGURATION');
  const bridge=await startHermesPilotBridge({token,maxRequests:6,reply:vi.fn(async()=>'x'),toolSupport:{...toolSupport,reply:copilotReply}});
  closers.push(bridge.close);
  expect(bridge.toolUrl).toContain('/v1/tools/search_yru_knowledge');
 });
 it('allows a 90-second deadline only for tool-backed copilot mode',async()=>{
  const bridge=await startHermesPilotBridge({token,maxRequests:2,timeoutMs:90000,reply:vi.fn(async()=>'unused'),toolSupport:{...toolSupport,reply:copilotReply}});
  closers.push(bridge.close);
  await expect(startHermesPilotBridge({token,maxRequests:2,timeoutMs:90000,reply:vi.fn(async()=>'unused')}))
   .rejects.toThrow('INVALID_PILOT_CONFIGURATION');
 });

 it('returns a generic 400 for malformed, null, oversized, and foreign-tool requests without logging request data',async()=>{
  const x=await setup();
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const postRaw=(body:string)=>fetch(x.bridge.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body});
  try{
   const malformed=await postRaw('{"model":"yru-free-pilot","description":"PRIVATE_TOOL_DESCRIPTION"');
   const nullBody=await postRaw('null');
   const oversizedBody=await postRaw('x'.repeat(66000));
   const oversized=await x.send('/chat/completions',{...baseRequest,tools:[{type:'function',function:{name:'search_yru_knowledge',description:'PRIVATE_TOOL_DESCRIPTION'}}],messages:[{role:'user',content:'x'.repeat(40000)}]});
   const foreign=await x.send('/chat/completions',{...baseRequest,tools:[{type:'function',function:{name:'terminal',description:'PRIVATE_TOOL_DESCRIPTION'}}]});
   const responses=[malformed,nullBody,oversizedBody,oversized,foreign];
   expect(responses.map(response=>response.status)).toEqual([400,400,400,400,400]);
   const errorBodies=await Promise.all(responses.map(response=>response.json()));
   expect(errorBodies).toEqual(responses.map(()=>({error:{message:'UNSUPPORTED_REQUEST',type:'pilot_error',code:'UNSUPPORTED_REQUEST'}})));
   expect(JSON.stringify(errorBodies)).not.toContain('PRIVATE_TOOL_DESCRIPTION');
   expect(log).not.toHaveBeenCalled();
  }finally{log.mockRestore();}
 });

 it.each([
  ['foreign tool name',{toolCalls:[{id:'call-1',name:'terminal',arguments:{query:'private payload'}}]}],
  ['invalid query shape',{toolCalls:[{id:'call-1',name:'search_yru_knowledge',arguments:{query:'wifi',extra:'private payload'}}]}],
  ['invalid call id',{toolCalls:[{id:'call:1',name:'search_yru_knowledge',arguments:{query:'wifi'}}]}],
  ['duplicate call ids',{toolCalls:[{id:'call-1',name:'search_yru_knowledge',arguments:{query:'wifi'}},{id:'call-1',name:'search_yru_knowledge',arguments:{query:'printer'}}]}],
  ['conflicting reply fields',{content:'safe-looking answer',toolCalls:[]}],
 ] as const)('rejects unsafe callback reply: %s',async(_label,reply)=>{
  const x=await setup();
  copilotReply.mockResolvedValueOnce(reply as never);
  const res=await x.send('/chat/completions',baseRequest);
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain('private payload');
 });

 it('rejects tool calls beyond the remaining execution budget',async()=>{
  const reply=vi.fn(async()=>({toolCalls:[
   {id:'call-1',name:'search_yru_knowledge',arguments:{query:'wifi'}},
   {id:'call-2',name:'search_yru_knowledge',arguments:{query:'printer'}},
  ]}));
  const bridge=await startHermesPilotBridge({token,maxRequests:2,reply:vi.fn(async()=>'unused'),toolSupport:{...toolSupport,maxToolCalls:1,reply}});
  closers.push(bridge.close);
  const res=await fetch(bridge.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(baseRequest)});
  expect(res.status).toBe(503);
 });

 it.each([0,1.5,7,Number.MAX_SAFE_INTEGER+1])('rejects invalid maxToolCalls configuration %s',async(maxToolCalls)=>{
  await expect(startHermesPilotBridge({token,maxRequests:2,reply:vi.fn(async()=>'unused'),toolSupport:{...toolSupport,maxToolCalls,reply:copilotReply}}))
   .rejects.toThrow('INVALID_PILOT_CONFIGURATION');
 });

 it('rejects oversized tool output without clipping or forwarding it',async()=>{
  const x=await setup();
  toolSupport.execute.mockResolvedValueOnce({rows:[{title:'คู่มือ',snippet:'PRIVATE_TOOL_OUTPUT'.repeat(3000)}]});
  const res=await x.send('/tools/search_yru_knowledge',{query:'wifi'});
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain('PRIVATE_TOOL_OUTPUT');
 });

 it('transports a bounded 3000-byte-class Thai tool result without clipping',async()=>{
  const x=await setup();
  const snippet='ก'.repeat(10000);
  toolSupport.execute.mockResolvedValueOnce({rows:[{title:'คู่มือ',snippet}]});
  const res=await x.send('/tools/search_yru_knowledge',{query:'wifi'});
  expect(res.status).toBe(200);
  const body=await res.json() as {result:{rows:{title:string;snippet:string}[]}};
  expect(body.result.rows[0].snippet).toBe(snippet);
  const transcript=await x.send('/chat/completions',{...baseRequest,messages:[
   {role:'user',content:'wifi'},
   {role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'search_yru_knowledge',arguments:'{"query":"wifi"}'}}]},
   {role:'tool',tool_call_id:'call-1',name:'search_yru_knowledge',content:JSON.stringify(body.result)},
  ]});
  expect(transcript.status).toBe(200);
 });

 it('propagates a client disconnect to the tool callback signal',async()=>{
  let callbackSignal:AbortSignal|undefined;
  let markStarted!:()=>void;
  const started=new Promise<void>(resolve=>{markStarted=resolve;});
  const execute=vi.fn((_args:{query:string},signal:AbortSignal)=>{
   callbackSignal=signal;markStarted();
   return new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  });
  const bridge=await startHermesPilotBridge({token,maxRequests:2,reply:vi.fn(async()=>'unused'),toolSupport:{...toolSupport,execute,reply:copilotReply}});
  closers.push(bridge.close);
  const client=new AbortController();
  const request=fetch(bridge.url+'/tools/search_yru_knowledge',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:'wifi'}),signal:client.signal});
  await started;
  client.abort();
  await expect(request).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(callbackSignal?.aborted).toBe(true));
 });

 it('propagates the pilot deadline to the tool callback signal',async()=>{
  let callbackSignal:AbortSignal|undefined;
  const execute=vi.fn((_args:{query:string},signal:AbortSignal)=>{
   callbackSignal=signal;
   return new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  });
  const bridge=await startHermesPilotBridge({token,maxRequests:2,timeoutMs:50,reply:vi.fn(async()=>'unused'),toolSupport:{...toolSupport,execute,reply:copilotReply}});
  closers.push(bridge.close);
  const res=await fetch(bridge.url+'/tools/search_yru_knowledge',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:'wifi'})});
  expect(res.status).toBe(503);
  expect(callbackSignal?.aborted).toBe(true);
 });
});
