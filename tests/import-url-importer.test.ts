import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {gzipSync} from 'node:zlib';
import type {ClientRequest,IncomingMessage} from 'node:http';
import type {RequestOptions} from 'node:https';
import {expect,it,vi} from 'vitest';
const httpsMock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('node:https',()=>({request:httpsMock.request}));
import {acquireOfficialUrl} from '../lib/imports/url-importer';

const NOW=Date.parse('2026-10-05T03:00:00.000Z');
const PDF=new TextEncoder().encode('%PDF-1.7\nfixture');
interface FakeResponse {status:number;location:string|null;contentType:string|null;contentDisposition:string|null;contentEncoding:string|null;
 body:AsyncIterable<Uint8Array>;cancel:()=>void}
interface FakeRequestInput {url:URL;pinnedAddress:{address:string;family:4|6};signal:AbortSignal}

async function* bytes(value:Uint8Array){yield value;}
const pdfResponse=(overrides:Partial<FakeResponse>={}):FakeResponse=>({status:200,location:null,contentType:'application/pdf',contentDisposition:null,
 contentEncoding:'identity',body:bytes(PDF),cancel:vi.fn(),...overrides});

it('acquires an official PDF with canonical original and final provenance',async()=>{
 const requestPinned=vi.fn(async(input:FakeRequestInput)=>{void input;return {status:200,location:null,contentType:'application/pdf',contentDisposition:null,
  contentEncoding:'identity',body:bytes(PDF),cancel:vi.fn()};});
 const result=await acquireOfficialUrl('https://ACDSERVICE.YRU.AC.TH/rules.pdf',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport:requestPinned,now:()=>NOW,
 }});
 expect(result).toMatchObject({requestedUrl:'https://acdservice.yru.ac.th/rules.pdf',finalUrl:'https://acdservice.yru.ac.th/rules.pdf',
  redirectChain:['https://acdservice.yru.ac.th/rules.pdf'],source:{format:'PDF',filename:'rules.pdf',sourceUrl:'https://acdservice.yru.ac.th/rules.pdf',
   acquiredFrom:'URL',fetchedAt:'2026-10-05T03:00:00.000Z'}});
 expect(result.source.checksum).toMatch(/^[a-f0-9]{64}$/);
 expect(Array.from(result.source.bytes)).toEqual(Array.from(PDF));
 expect(requestPinned).toHaveBeenCalledOnce();
 expect(requestPinned.mock.calls[0]?.[0]).toMatchObject({url:new URL('https://acdservice.yru.ac.th/rules.pdf'),pinnedAddress:{address:'8.8.8.8',family:4}});
});

it('resolves and pins every official redirect target and keeps the complete chain',async()=>{
 const dnsAddresses=[[{address:'8.8.8.8',family:4 as const}],[{address:'1.1.1.1',family:4 as const}]];
 const resolvePublicAddresses=vi.fn(async(hostname:string)=>{void hostname;return dnsAddresses.shift()??[];});
 const responses=[pdfResponse({status:302,location:'/downloads/rules.pdf'}),pdfResponse()];
 const transport=vi.fn(async(input:FakeRequestInput)=>{void input;return responses.shift()!;});
 const result=await acquireOfficialUrl('https://yru.ac.th/rules',{testOnly:{resolvePublicAddresses,transport,now:()=>NOW}});
 expect(result).toMatchObject({requestedUrl:'https://yru.ac.th/rules',finalUrl:'https://yru.ac.th/downloads/rules.pdf',
  redirectChain:['https://yru.ac.th/rules','https://yru.ac.th/downloads/rules.pdf']});
 expect(resolvePublicAddresses.mock.calls.map(call=>call[0])).toEqual(['yru.ac.th','yru.ac.th']);
 expect(transport.mock.calls.map(call=>call[0]!.pinnedAddress.address)).toEqual(['8.8.8.8','1.1.1.1']);
 expect(responses).toHaveLength(0);
});

it('rejects nonofficial, credentialed, secret-query and ambiguous URL syntax before DNS',async()=>{
 const resolvePublicAddresses=vi.fn(async()=>[{address:'8.8.8.8',family:4 as const}]);
 const transport=vi.fn(async()=>pdfResponse());
 const invalidUrls=[
  'http://yru.ac.th/rules.pdf','https://yru.ac.th.evil.example/rules.pdf','https://name@yru.ac.th/rules.pdf',
  'https://yru.ac.th:8443/rules.pdf','https://yru.ac.th/rules.pdf#part','https://yru.ac.th/rules.pdf?access_token=secret',
  'https://yru.ac.th\\@evil.example/rules.pdf','https://yru.ac.th/%5cprivate.pdf',
 ];
 for(const url of invalidUrls)await expect(acquireOfficialUrl(url,{testOnly:{resolvePublicAddresses,transport}}))
  .rejects.toMatchObject({code:'IMPORT_URL_INVALID'});
 expect(resolvePublicAddresses).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
});

it('rejects an entire DNS answer set when any address is nonpublic',async()=>{
 const transport=vi.fn(async()=>pdfResponse());
 await expect(acquireOfficialUrl('https://yru.ac.th/rules.pdf',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.8',family:4}],transport,
 }})).rejects.toMatchObject({code:'IMPORT_URL_UNAVAILABLE'});
 expect(transport).not.toHaveBeenCalled();
});

it('rejects short credential query aliases before DNS or network',async()=>{
 const resolver=vi.fn(async()=>[{address:'8.8.8.8',family:4 as const}]),transport=vi.fn(async()=>pdfResponse());
 for(const key of ['sig','code','ticket','jwt','X-Sig','oauth_code','JWT']){
  await expect(acquireOfficialUrl(`https://yru.ac.th/rules.pdf?${key}=fixture`,{testOnly:{resolvePublicAddresses:resolver,transport}}))
   .rejects.toMatchObject({code:'IMPORT_URL_INVALID'});
 }
 expect(resolver).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
});

it('rejects an upstream compressed response error even when valid bytes follow',async()=>{
 let callback:((response:IncomingMessage)=>void)|undefined,responseStream:PassThrough|undefined;
 const request=Object.assign(new EventEmitter(),{end:vi.fn(()=>queueMicrotask(()=>{
  responseStream=Object.assign(new PassThrough(),{statusCode:200,headers:{'content-type':'application/pdf','content-encoding':'gzip'}});
  // Keep a broken implementation from crashing the test process; acquisition must still reject.
  responseStream.once('error',()=>undefined);
  callback?.(responseStream as unknown as IncomingMessage);
  responseStream.emit('error',new Error('PRIVATE_UPSTREAM_ERROR_FIXTURE'));
  responseStream.end(gzipSync(PDF));
 })),destroy:vi.fn(()=>responseStream?.destroy())});
 const requestImpl=vi.fn((_options:RequestOptions,onResponse:(response:IncomingMessage)=>void)=>{callback=onResponse;return request as unknown as ClientRequest;});
 const result=acquireOfficialUrl('https://yru.ac.th/rules.pdf',{testOnly:{resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],requestImpl:requestImpl as unknown as typeof import('node:https').request}});
 await expect(result).rejects.toMatchObject({code:'IMPORT_URL_UNAVAILABLE',message:'IMPORT_URL_UNAVAILABLE'});
 expect(request.destroy).toHaveBeenCalled();
});

it('validates redirect targets before resolving or connecting to them',async()=>{
 const first=pdfResponse({status:302,location:'https://127.0.0.1/private'});
 const resolvePublicAddresses=vi.fn(async()=>[{address:'8.8.8.8',family:4 as const}]);
 const transport=vi.fn(async()=>first);
 await expect(acquireOfficialUrl('https://yru.ac.th/rules',{testOnly:{resolvePublicAddresses,transport}}))
  .rejects.toMatchObject({code:'IMPORT_URL_INVALID'});
 expect(first.cancel).toHaveBeenCalledOnce();expect(resolvePublicAddresses).toHaveBeenCalledOnce();expect(transport).toHaveBeenCalledOnce();
});

it('stops after three redirects and cancels each redirect body',async()=>{
 const redirects=Array.from({length:4},(_,index)=>pdfResponse({status:302,location:`/next-${index}`}));
 const transport=vi.fn(async()=>redirects.shift()!);
 await expect(acquireOfficialUrl('https://yru.ac.th/start',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport,
 }})).rejects.toMatchObject({code:'IMPORT_URL_REDIRECT_LIMIT'});
 expect(transport).toHaveBeenCalledTimes(4);expect(redirects).toHaveLength(0);
});

it('rejects media mismatch and unsupported content types without consuming their bodies',async()=>{
 const mismatch=pdfResponse({contentType:'text/html'}),unsupported=pdfResponse({contentType:'image/png'});
 await expect(acquireOfficialUrl('https://yru.ac.th/rules.pdf',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>mismatch,
 }})).rejects.toMatchObject({code:'IMPORT_URL_CONTENT_MISMATCH'});
 expect(mismatch.cancel).toHaveBeenCalledOnce();
 await expect(acquireOfficialUrl('https://yru.ac.th/image.png',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>unsupported,
 }})).rejects.toMatchObject({code:'IMPORT_URL_CONTENT_TYPE_UNSUPPORTED'});
 expect(unsupported.cancel).toHaveBeenCalledOnce();
});

it('rejects bytes whose signature contradicts the declared content type',async()=>{
 const html=new TextEncoder().encode('<!doctype html><html><body>not a CSV</body></html>');
 const response=pdfResponse({contentType:'text/csv',body:bytes(html)});
 await expect(acquireOfficialUrl('https://yru.ac.th/data.csv',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>response,
 }})).rejects.toMatchObject({code:'IMPORT_URL_CONTENT_MISMATCH'});
});

it('enforces the original limit on streamed bytes rather than Content-Length',async()=>{
 const oversized=new Uint8Array(20*1024*1024+1),response=pdfResponse({body:bytes(oversized)});
 await expect(acquireOfficialUrl('https://yru.ac.th/large.pdf',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>response,
 }})).rejects.toMatchObject({code:'IMPORT_URL_TOO_LARGE'});
 expect(response.cancel).toHaveBeenCalledOnce();
});

it('applies one total deadline to DNS and cancels when the caller aborts',async()=>{
 vi.useFakeTimers();
 try{
  const pending=acquireOfficialUrl('https://yru.ac.th/rules.pdf',{testOnly:{resolvePublicAddresses:async()=>new Promise(()=>{}),transport:async()=>pdfResponse()}});
  const timeout=expect(pending).rejects.toMatchObject({code:'IMPORT_URL_TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10_000);await timeout;
  const controller=new AbortController();
  const aborted=acquireOfficialUrl('https://yru.ac.th/rules.pdf',{signal:controller.signal,testOnly:{
   resolvePublicAddresses:async()=>new Promise(()=>{}),transport:async()=>pdfResponse(),
  }});
  controller.abort();await expect(aborted).rejects.toMatchObject({code:'IMPORT_URL_CANCELLED'});
 }finally{vi.useRealTimers();}
});

it('keeps the official hostname for TLS while pinning socket lookup and counts decoded gzip bytes',async()=>{
 const compressed=gzipSync(PDF);let requestOptions:RequestOptions|undefined;
 let responseStream:PassThrough|undefined;const request=Object.assign(new EventEmitter(),{
  end:vi.fn(()=>queueMicrotask(()=>{responseStream=Object.assign(new PassThrough(),{statusCode:200,
   headers:{'content-type':'application/pdf','content-encoding':'gzip','content-length':'1'}});
   callback?.(responseStream as unknown as IncomingMessage);responseStream.end(compressed);})),
  destroy:vi.fn(()=>responseStream?.destroy()),
 });
 let callback:((response:IncomingMessage)=>void)|undefined;
 const requestImpl=vi.fn((options:RequestOptions,onResponse:(response:IncomingMessage)=>void)=>{
  requestOptions=options;callback=onResponse;return request as unknown as ClientRequest;
 });
 const result=await acquireOfficialUrl('https://YRU.AC.TH/rules.pdf',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],requestImpl:requestImpl as unknown as typeof import('node:https').request,now:()=>NOW,
 }});
 expect(Array.from(result.source.bytes)).toEqual(Array.from(PDF));
 expect(requestOptions).toMatchObject({hostname:'yru.ac.th',servername:'yru.ac.th',port:443,path:'/rules.pdf',method:'GET',
  agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2'});
 expect(requestOptions?.headers).not.toHaveProperty('authorization');expect(requestOptions?.headers).not.toHaveProperty('cookie');
 const lookup=requestOptions?.lookup,one=vi.fn(),all=vi.fn();
 expect(lookup).toBeTypeOf('function');lookup?.('yru.ac.th',{},one);lookup?.('yru.ac.th',{all:true},all);
 expect(one).toHaveBeenCalledWith(null,'8.8.8.8',4);
 expect(all).toHaveBeenCalledWith(null,[{address:'8.8.8.8',family:4}]);
});

it('enforces the decoded original-size cap against a compressed response',async()=>{
 const compressed=gzipSync(Buffer.alloc(20*1024*1024+1));let callback:((response:IncomingMessage)=>void)|undefined;
 let responseStream:PassThrough|undefined;
 const request=Object.assign(new EventEmitter(),{end:vi.fn(()=>queueMicrotask(()=>{
  responseStream=Object.assign(new PassThrough(),{statusCode:200,headers:{'content-type':'application/pdf','content-encoding':'gzip'}});
  callback?.(responseStream as unknown as IncomingMessage);responseStream.end(compressed);
 })),destroy:vi.fn(()=>responseStream?.destroy())});
 const requestImpl=vi.fn((_options:RequestOptions,onResponse:(response:IncomingMessage)=>void)=>{callback=onResponse;return request as unknown as ClientRequest;});
 await expect(acquireOfficialUrl('https://yru.ac.th/large.pdf',{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],requestImpl:requestImpl as unknown as typeof import('node:https').request,
 }})).rejects.toMatchObject({code:'IMPORT_URL_TOO_LARGE'});
 expect(request.destroy).toHaveBeenCalled();
});
