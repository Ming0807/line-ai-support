import {afterEach,describe,expect,it,vi} from 'vitest';
import {startHermesPilotBridge} from '../lib/ai/hermes-pilot-bridge';

const token='synthetic-bridge-token-with-more-than-32-characters';
const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closers.splice(0))await close();});
async function setup(reply=vi.fn(async()=> 'สวัสดีครับ')){
 const bridge=await startHermesPilotBridge({token,reply,maxRequests:2});closers.push(bridge.close);
 const send=(body:unknown,key=token)=>fetch(bridge.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)});
 return {bridge,send,reply};
}
const request={model:'yru-free-pilot',messages:[{role:'user',content:'สวัสดี'}],stream:false};
describe('Hermes synthetic-only loopback bridge',()=>{
 it('requires an opaque token before generation',async()=>{const x=await setup();expect((await x.send(request,'wrong')).status).toBe(401);expect(x.reply).not.toHaveBeenCalled();});
 it('returns OpenAI compatible complete prose and passes cancellation signal',async()=>{const x=await setup();const res=await x.send(request);expect(res.status).toBe(200);expect((await res.json()).choices[0].message.content).toBe('สวัสดีครับ');expect(x.reply.mock.calls[0]).toEqual([request.messages,expect.any(AbortSignal)]);});
 it('accepts Hermes reasoning hint without granting caller model configuration',async()=>{const x=await setup();expect((await x.send({...request,reasoning_effort:'medium'})).status).toBe(200);expect(x.reply.mock.calls[0]).toEqual([request.messages,expect.any(AbortSignal)]);});
 it.each([{model:'paid-model'},{tools:[{type:'function',function:{name:'terminal'}}]},{stream:true},{messages:[{role:'tool',content:'untrusted tool'}]},{base_url:'https://example.com'}])('rejects unsupported client capabilities %j',async(extra)=>{const x=await setup();expect((await x.send({...request,...extra})).status).toBe(400);expect(x.reply).not.toHaveBeenCalled();});
 it('bounds requests including failed inference without provider-error leakage',async()=>{const x=await setup(vi.fn(async()=>{throw new Error('credential-and-raw-provider-body');}));for(let i=0;i<2;i++){const res=await x.send(request);expect(res.status).toBe(503);expect(await res.text()).not.toContain('credential');}expect((await x.send(request)).status).toBe(429);expect(x.reply).toHaveBeenCalledTimes(2);});
 it('rejects oversized content before generation',async()=>{const x=await setup();expect((await x.send({...request,messages:[{role:'user',content:'x'.repeat(70000)}]})).status).toBe(413);expect(x.reply).not.toHaveBeenCalled();});
 it('binds only loopback and rejects weak configuration',async()=>{const x=await setup();expect(x.bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);await expect(startHermesPilotBridge({token:'weak',reply:x.reply,maxRequests:2})).rejects.toThrow('INVALID_PILOT_CONFIGURATION');});
 it('terminates a noncooperating reply at the deadline',async()=>{
  const bridge=await startHermesPilotBridge({token,maxRequests:1,timeoutMs:30,reply:async()=>new Promise<string>(()=>{})});closers.push(bridge.close);
  const res=await fetch(bridge.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(request),signal:AbortSignal.timeout(500)});
  expect(res.status).toBe(503);
 });
});
