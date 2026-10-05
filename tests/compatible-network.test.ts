import {describe,expect,it,vi} from 'vitest';
import {createCompatibleTransport,type CompatibleHttpRequest,type PinnedHttpsRequest} from '../lib/ai/compatible-network';
import {AIProviderError} from '../lib/ai/types';

const base='https://api.provider-support.com/OpenAI/v1/';
const key='canary-compatible-key';
const publicPin={address:'1.1.1.1',family:4 as const};
const response={status:200,contentType:'application/json',retryAfter:null,json:{data:[]}};
const request=(route:CompatibleHttpRequest['route']='models'):CompatibleHttpRequest=>route==='models'?
 {route,apiKey:key,signal:new AbortController().signal}:{route,apiKey:key,json:{model:'fixture-model'},signal:new AbortController().signal};
const setup=()=>{
 const resolve=vi.fn<(hostname:string,signal:AbortSignal)=>Promise<typeof publicPin[]>>(async()=>[publicPin]);
 const send=vi.fn<PinnedHttpsRequest>(async()=>response);
 return {resolve,send,transport:createCompatibleTransport({resolvePublicAddresses:resolve,requestImpl:send})};
};

describe('compatible transport boundary',()=>{
 it.each(['models','chat/completions','embeddings'] as const)('builds only the exact %s route and pins the checked answer',async route=>{
  const {resolve,send,transport}=setup();
  expect(await transport.request(base,request(route))).toEqual(response);
  expect(resolve).toHaveBeenCalledOnce();expect(resolve.mock.calls[0]?.[0]).toBe('api.provider-support.com');
  const input=send.mock.calls[0]?.[0];expect(input?.url.href).toBe(`https://api.provider-support.com/OpenAI/v1/${route}`);
  expect(input?.method).toBe(route==='models'?'GET':'POST');expect(input?.pinnedAddress).toEqual(publicPin);
  expect(input?.headers.Authorization).toBe(`Bearer ${key}`);expect(input?.headers.Accept).toBe('application/json');
  if(route==='models')expect(input?.body).toBeNull();
  else expect(JSON.parse(new TextDecoder().decode(input?.body??undefined))).toEqual({model:'fixture-model'});
 });
 it.each([
  {route:'../private',apiKey:key},
  {route:'models',apiKey:key,json:{}},
  {route:'models',apiKey:key,path:'/proxy'},
  {route:'chat/completions',apiKey:key},
  {route:'chat/completions',apiKey:key,json:null},
  {route:'models',apiKey:'key\r\nInjected: header'},
 ])('rejects invalid route/body/header input before DNS',async input=>{
  const {resolve,send,transport}=setup();
  await expect(transport.request(base,{...input,signal:new AbortController().signal} as CompatibleHttpRequest)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(resolve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
 it('rejects unsupported endpoints and oversized JSON before DNS',async()=>{
  const {resolve,send,transport}=setup();
  await expect(transport.request('http://localhost',request())).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await expect(transport.request(base,{...request('embeddings'),json:{input:'x'.repeat(512*1024)}} as CompatibleHttpRequest)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(resolve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
 it('does not execute JSON accessors or toJSON during validation',async()=>{
  const {resolve,send,transport}=setup();const getter=vi.fn(()=>key),toJSON=vi.fn(()=>({model:'fixture'}));
  for(const json of [Object.defineProperty({},'input',{get:getter,enumerable:true}),{toJSON}]){
   await expect(transport.request(base,{route:'embeddings',apiKey:key,json,signal:new AbortController().signal})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  }
  expect(getter).not.toHaveBeenCalled();expect(toJSON).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
 it('rejects accessor-backed request envelopes without invoking the accessor',async()=>{
  const {resolve,send,transport}=setup();let routeReads=0;
  const input:CompatibleHttpRequest={get route():'models'{routeReads+=1;return 'models';},apiKey:key,signal:new AbortController().signal};
  await expect(transport.request(base,input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(routeReads).toBe(0);expect(resolve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
 it('rejects proxy-backed request envelopes before invoking proxy traps',async()=>{
  const {resolve,send,transport}=setup();let routeReads=0;
  const target=request('models');
  const input=new Proxy(target,{get(object,property,receiver){
   if(property==='route'){routeReads+=1;return routeReads===5?'embeddings':Reflect.get(object,property,receiver);}
   return Reflect.get(object,property,receiver);
  }});
  await expect(transport.request(base,input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(routeReads).toBe(0);expect(resolve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
 it.each(['custom prototype','unexpected symbol key'] as const)('rejects a request envelope with a %s',async kind=>{
  const {resolve,send,transport}=setup();const input=request('models');
  if(kind==='custom prototype')Object.setPrototypeOf(input,{marker:'unsafe'});
  else Object.defineProperty(input,Symbol('unexpected'),{value:true,enumerable:true});
  await expect(transport.request(base,input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(resolve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
 it('re-resolves every request and blocks rebinding or mixed answer sets',async()=>{
  const {resolve,send,transport}=setup();resolve.mockResolvedValueOnce([publicPin]).mockResolvedValueOnce([{address:'127.0.0.1',family:4}]);
  await transport.request(base,request());await expect(transport.request(base,request())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  resolve.mockResolvedValueOnce([publicPin,{address:'10.0.0.1',family:4}]);
  await expect(transport.request(base,request())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  expect(resolve).toHaveBeenCalledTimes(3);expect(send).toHaveBeenCalledOnce();
 });
 it('fails closed on empty DNS and does not echo resolver details',async()=>{
  const {resolve,send,transport}=setup();resolve.mockResolvedValueOnce([]);
  await expect(transport.request(base,request())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  resolve.mockRejectedValueOnce(new Error(`secret ${key} upstream body`));
  await expect(transport.request(base,request())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
  expect(send).not.toHaveBeenCalled();
 });
 it('honors abort before DNS and does not start a request after late DNS completes',async()=>{
  const {resolve,send,transport}=setup();const controller=new AbortController();controller.abort();
  await expect(transport.request(base,{...request(),signal:controller.signal})).rejects.toMatchObject({code:'CANCELLED'});expect(resolve).not.toHaveBeenCalled();
  const during=new AbortController();let finish:(pins:typeof publicPin[])=>void=()=>{};
  resolve.mockImplementationOnce(()=>new Promise(res=>{finish=res;}));
  const pending=transport.request(base,{...request(),signal:during.signal});during.abort();
  await expect(pending).rejects.toMatchObject({code:'CANCELLED'});finish([publicPin]);await Promise.resolve();expect(send).not.toHaveBeenCalled();
 });
 it('bounds a stalled DNS operation by the metadata total deadline',async()=>{
  vi.useFakeTimers();try{
   const {resolve,send,transport}=setup();resolve.mockImplementationOnce(()=>new Promise(()=>{}));
   const pending=expect(transport.request(base,request())).rejects.toMatchObject({code:'TIMEOUT'});
   void pending.catch(()=>undefined);
   await vi.advanceTimersByTimeAsync(5000);await pending;expect(send).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('preserves normalized received status without exposing native error details',async()=>{
  const {send,transport}=setup();send.mockRejectedValueOnce(new AIProviderError('INVALID_OUTPUT',200));
  await expect(transport.request(base,request())).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
  send.mockRejectedValueOnce(new Error(`${key}: raw body`));
  await expect(transport.request(base,request())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE',httpStatus:undefined});
 });
});
