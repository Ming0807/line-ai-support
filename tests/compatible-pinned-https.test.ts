import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import type {IncomingMessage,ClientRequest} from 'node:http';
import type {RequestOptions} from 'node:https';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createPinnedHttpsRequest} from '../lib/ai/compatible-pinned-https';
import type {PinnedHttpsRequestInput} from '../lib/ai/compatible-network';

const https=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('node:https',()=>({request:https.request}));
let req:EventEmitter&{end:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>};
let receive:(response:IncomingMessage)=>void;
const input=(signal=new AbortController().signal):PinnedHttpsRequestInput=>({
 url:new URL('https://api.provider-support.com/v1/models'),method:'GET',headers:{Authorization:'Bearer canary-key',Accept:'application/json'},
 body:null,pinnedAddress:{address:'1.1.1.1',family:4},signal,maxResponseBytes:256*1024,
});
function response(status=200,headers:IncomingMessage['headers']={'content-type':'application/json'}){
 const body=Object.assign(new PassThrough(),{statusCode:status,headers});body.on('error',()=>{});receive(body as unknown as IncomingMessage);return body;
}
beforeEach(()=>{
 vi.clearAllMocks();receive=()=>{};req=Object.assign(new EventEmitter(),{end:vi.fn(),destroy:vi.fn()});req.on('error',()=>{});
 https.request.mockImplementation((_options:RequestOptions,callback:(response:IncomingMessage)=>void)=>{receive=callback;return req as unknown as ClientRequest;});
});

describe('native pinned HTTPS',()=>{
 it('reports safe connection phases and distinguishes a stalled TLS handshake from response waiting',async()=>{
  const events:unknown[]=[],controller=new AbortController();
  const pending=createPinnedHttpsRequest({observe:event=>events.push(event)})(input(controller.signal));
  const assertion=expect(pending).rejects.toMatchObject({code:'CANCELLED'});
  const socket=Object.assign(new EventEmitter(),{authorized:false});
  req.emit('socket',socket);socket.emit('connect');controller.abort();await assertion;
  expect(events).toEqual([
   {phase:'TCP_CONNECTED',elapsedMs:expect.any(Number)},
   {phase:'FAILED',elapsedMs:expect.any(Number),errorCode:'CANCELLED'},
  ]);
  expect(JSON.stringify(events)).not.toMatch(/canary|Authorization|provider-support|1\.1\.1\.1/);
 });
 it('observes authorized TLS, one request finish and one first body chunk without changing response parsing',async()=>{
  const events:{phase:string}[]=[];
  const pending=createPinnedHttpsRequest({observe:event=>events.push(event)})(input());
  const socket=Object.assign(new EventEmitter(),{authorized:true});req.emit('socket',socket);
  socket.emit('connect');socket.emit('secureConnect');req.emit('finish');
  const stream=response();stream.write('{"data":');stream.end('[]}');
  await expect(pending).resolves.toMatchObject({status:200,json:{data:[]}});
  expect(events.map(e=>e.phase)).toEqual(['TCP_CONNECTED','TLS_AUTHORIZED','REQUEST_FINISH','RESPONSE_HEADERS','FIRST_BODY_CHUNK','RESPONSE_END']);
 });
 it('never lets a failing phase observer alter successful HTTP or expose raw errors',async()=>{
  const observe=vi.fn(()=>{throw Error('private observer failure');});
  const pending=createPinnedHttpsRequest({observe})(input());response().end('{"data":[]}');
  await expect(pending).resolves.toMatchObject({status:200});expect(observe).toHaveBeenCalled();
 });
 it('does not report unauthorized TLS or late socket events after cancellation',async()=>{
  const events:{phase:string}[]=[],controller=new AbortController();
  const pending=createPinnedHttpsRequest({observe:event=>events.push(event)})(input(controller.signal));
  const assertion=expect(pending).rejects.toMatchObject({code:'CANCELLED'});
  const socket=Object.assign(new EventEmitter(),{authorized:false});req.emit('socket',socket);
  socket.emit('secureConnect');expect(events).toEqual([]);
  controller.abort();await assertion;
  socket.authorized=true;socket.emit('connect');req.emit('finish');
  expect(events.map(event=>event.phase)).toEqual(['FAILED']);
 });
 it('uses the configured hostname for Host/SNI and checks TLS with no reusable agent',async()=>{
  const pending=createPinnedHttpsRequest()(input());response().end('{"data":[]}');
  await expect(pending).resolves.toEqual({status:200,contentType:'application/json',retryAfter:null,json:{data:[]}});
  const options=https.request.mock.calls[0]?.[0] as RequestOptions;
  expect(options).toMatchObject({hostname:'api.provider-support.com',servername:'api.provider-support.com',port:443,
   path:'/v1/models',method:'GET',rejectUnauthorized:true,agent:false,insecureHTTPParser:false,maxHeaderSize:16384,minVersion:'TLSv1.2'});
  expect(options.checkServerIdentity).toBeUndefined();expect(options.headers).not.toHaveProperty('Host','1.1.1.1');
  const lookup=options.lookup;expect(lookup).toBeTypeOf('function');
  const callback=vi.fn();lookup?.('api.provider-support.com',{},callback);expect(callback).toHaveBeenCalledWith(null,'1.1.1.1',4);
  const all=vi.fn();lookup?.('api.provider-support.com',{all:true},all);expect(all).toHaveBeenCalledWith(null,[{address:'1.1.1.1',family:4}]);
 });
 it.each([301,307,400,401,403,404,429,503])('retains HTTP %i and discards the body without following redirects',async status=>{
  const pending=createPinnedHttpsRequest()(input());const stream=response(status,{'content-type':'text/html','retry-after':'12',location:'http://127.0.0.1/private'});
  await expect(pending).resolves.toEqual({status,contentType:'text/html',retryAfter:'12',json:null});
  expect(stream.destroyed).toBe(true);expect(https.request).toHaveBeenCalledOnce();
 });
 it.each([
  ['wrong content type',{'content-type':'text/html'},'<html>canary-key</html>'],
  ['invalid JSON',{'content-type':'application/json'},'{"secret":canary-key}'],
  ['invalid UTF-8',{'content-type':'application/json'},Buffer.from([0xc3,0x28])],
  ['compressed body',{'content-type':'application/json','content-encoding':'gzip'},'{}'],
  ['oversized declared length',{'content-type':'application/json','content-length':'99999999'},'{}'],
 ])('fails %s after 200 with true HTTP and no body echo',async(_label,headers,body)=>{
  const pending=createPinnedHttpsRequest()(input());const assertion=expect(pending).rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT',httpStatus:200});
  response(200,headers).end(body);await assertion;
 });
 it('bounds a streamed body without Content-Length and destroys the request',async()=>{
  const pending=createPinnedHttpsRequest()({...input(),maxResponseBytes:4});const assertion=expect(pending).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
  const stream=response();stream.write('12345');await assertion;expect(stream.destroyed).toBe(true);expect(req.destroy).toHaveBeenCalled();
 });
 it('preserves a received 200 when cancellation interrupts the body',async()=>{
  const controller=new AbortController(),pending=createPinnedHttpsRequest()(input(controller.signal));
  const assertion=expect(pending).rejects.toMatchObject({code:'CANCELLED',httpStatus:200});
  const stream=response();stream.write('{');controller.abort();await assertion;expect(req.destroy).toHaveBeenCalled();expect(stream.destroyed).toBe(true);
 });
 it('records no HTTP for cancellation before response and prevents work after pre-abort',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(createPinnedHttpsRequest()(input(controller.signal))).rejects.toMatchObject({code:'CANCELLED',httpStatus:undefined});
  expect(https.request).not.toHaveBeenCalled();
  const during=new AbortController(),pending=createPinnedHttpsRequest()(input(during.signal));
  const assertion=expect(pending).rejects.toMatchObject({code:'CANCELLED',httpStatus:undefined});during.abort();await assertion;expect(req.destroy).toHaveBeenCalled();
 });
 it('normalizes socket errors without serializing native credentials or raw details',async()=>{
  const pending=createPinnedHttpsRequest()(input());const assertion=expect(pending).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',httpStatus:undefined,message:'PROVIDER_UNAVAILABLE'});
  req.emit('error',new Error('canary-key private native detail'));await assertion;
 });
 it('preserves HTTP for a response stream reset',async()=>{
  const pending=createPinnedHttpsRequest()(input());const assertion=expect(pending).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',httpStatus:200});
  const stream=response();stream.destroy(new Error('private reset body'));await assertion;
 });
 it('honors timeout reason and sends exactly the bounded body supplied',async()=>{
  const controller=new AbortController(),bytes=new TextEncoder().encode('{"model":"fixture"}');
  const pending=createPinnedHttpsRequest()({...input(controller.signal),method:'POST',body:bytes});
  const assertion=expect(pending).rejects.toMatchObject({code:'TIMEOUT',httpStatus:undefined});
  controller.abort(new DOMException('TIMEOUT','TimeoutError'));await assertion;expect(req.end).toHaveBeenCalledWith(bytes);
 });
});
