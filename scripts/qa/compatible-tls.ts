import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,request as httpsRequest,type RequestOptions} from 'node:https';
import {createServer as createTcpServer} from 'node:net';
import type {Duplex} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import {createPinnedHttpsRequest} from '../../lib/ai/compatible-pinned-https';
import type {PinnedHttpsRequestInput} from '../../lib/ai/compatible-network';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(resolve(process.cwd()),root,'WORKSPACE_ROOT_REQUIRED');
const parent=resolve(root,'.superpowers/staging');await mkdir(parent,{recursive:true});
const directory=await mkdtemp(join(parent,'compatible-tls-'));
assert.equal(dirname(directory),parent,'OWNED_TEMP_DIRECTORY_REQUIRED');
const openssl=process.platform==='win32'?join(process.env.ProgramFiles??'C:\\Program Files','Git/usr/bin/openssl.exe'):'openssl';
if(process.platform==='win32')assert(existsSync(openssl),'GIT_OPENSSL_REQUIRED_FOR_TLS_QA');
const fixtures:string[]=[];let server:ReturnType<typeof createServer>|undefined,tcp:ReturnType<typeof createTcpServer>|undefined;
const sockets=new Set<Duplex>();
let stage='certificate_setup',mode='JSON',hits=0,lastHost='',lastSni='';
try{
 const certPath=join(directory,'certificate.pem'),keyPath=join(directory,'private-key.pem'),configPath=join(directory,'openssl.cnf');
 await writeFile(configPath,'[req]\ndistinguished_name=dn\n[dn]\n');
 execFileSync(openssl,['req','-config',configPath,'-x509','-newkey','rsa:2048','-sha256','-nodes','-days','1',
  '-subj','/CN=api.provider-support.com','-addext','subjectAltName=DNS:api.provider-support.com',
  '-keyout',keyPath,'-out',certPath],{cwd:directory,stdio:'pipe',windowsHide:true});
 const cert=await readFile(certPath),key=await readFile(keyPath);
 server=createServer({cert,key},(req,res)=>{
  hits++;lastHost=req.headers.host??'';
  if(mode==='REDIRECT'){res.writeHead(307,{location:'http://127.0.0.1/private'});res.end('canary-error-body');return;}
  if(mode==='HEADERS'){res.writeHead(200,{'content-type':'application/json','x-large-header':'x'.repeat(20000)});res.end('{}');return;}
  res.writeHead(200,{'content-type':'application/json'});
  if(mode==='STALL'){res.write('{');return;}
  res.end(mode==='INVALID'?'canary-invalid-body':'{"data":[]}');
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('secureConnection',socket=>{lastSni=(socket as typeof socket&{servername?:string}).servername??'';});
 await new Promise<void>((res,rej)=>{server!.once('error',rej);server!.listen(0,'127.0.0.1',()=>res());});
 const address=server.address();assert(address&&typeof address==='object');const port=address.port;
 // Injection belongs only to this lower-level test: production URL/DNS guards reject loopback and custom ports.
 const native=(trusted=true):typeof httpsRequest=>((options:RequestOptions,callback:(res:IncomingMessage)=>void)=>
  httpsRequest({...options,port,...(trusted?{ca:cert}:{})},callback)) as typeof httpsRequest;
 const input=(hostname='api.provider-support.com',signal=AbortSignal.timeout(2000)):PinnedHttpsRequestInput=>({
  url:new URL(`https://${hostname}/v1/models`),method:'GET',headers:{Authorization:'Bearer fixture-key',Accept:'application/json'},
  body:null,pinnedAddress:{address:'127.0.0.1',family:4},signal,maxResponseBytes:256*1024,
 });
 const send=createPinnedHttpsRequest({requestImpl:native()});
 stage='trusted_hostname';assert.deepEqual((await send(input())).json,{data:[]});
 assert.equal(lastHost,`api.provider-support.com:${port}`);assert.equal(lastSni,'api.provider-support.com');fixtures.push('trusted_hostname_Host_SNI_with_pinned_TCP');
 stage='wrong_SAN';const beforeWrong=hits;
 await assert.rejects(send(input('wrong.provider-support.com')),error=>(error as {code?:string;httpStatus?:number}).code==='PROVIDER_UNAVAILABLE'&&(error as {httpStatus?:number}).httpStatus===undefined);
 assert.equal(hits,beforeWrong,'NO_HTTP_AFTER_NAME_FAILURE');fixtures.push('wrong_hostname_rejected_before_HTTP');
 stage='untrusted_chain';await assert.rejects(createPinnedHttpsRequest({requestImpl:native(false)})(input()),
  error=>(error as {code?:string;httpStatus?:number}).code==='PROVIDER_UNAVAILABLE'&&(error as {httpStatus?:number}).httpStatus===undefined);
 assert.equal(hits,beforeWrong,'NO_HTTP_AFTER_TRUST_FAILURE');fixtures.push('untrusted_certificate_rejected_before_HTTP');
 stage='redirect';mode='REDIRECT';const beforeRedirect=hits;assert.equal((await send(input())).status,307);assert.equal(hits,beforeRedirect+1);fixtures.push('redirect_not_followed_actual_307');
 stage='invalid_body';mode='INVALID';await assert.rejects(send(input()),error=>(error as {code?:string;httpStatus?:number}).code==='INVALID_OUTPUT'&&(error as {httpStatus?:number}).httpStatus===200);fixtures.push('invalid_JSON_keeps_HTTP200');
 stage='header_limit';mode='HEADERS';await assert.rejects(send(input()),error=>(error as {code?:string}).code==='PROVIDER_UNAVAILABLE');fixtures.push('native_header_limit');
 stage='body_deadline';mode='STALL';await assert.rejects(send(input('api.provider-support.com',AbortSignal.timeout(250))),
  error=>(error as {code?:string;httpStatus?:number}).code==='TIMEOUT'&&(error as {httpStatus?:number}).httpStatus===200);fixtures.push('body_timeout_keeps_HTTP200');
 stage='TLS_deadline';tcp=createTcpServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise<void>((res,rej)=>{tcp!.once('error',rej);tcp!.listen(0,'127.0.0.1',()=>res());});
 const tcpAddress=tcp.address();assert(tcpAddress&&typeof tcpAddress==='object');
 const stalledNative=((options:RequestOptions,callback:(res:IncomingMessage)=>void)=>httpsRequest({...options,port:tcpAddress.port,ca:cert},callback)) as typeof httpsRequest;
 await assert.rejects(createPinnedHttpsRequest({requestImpl:stalledNative})(input('api.provider-support.com',AbortSignal.timeout(250))),
  error=>(error as {code?:string;httpStatus?:number}).code==='TIMEOUT'&&(error as {httpStatus?:number}).httpStatus===undefined);fixtures.push('TLS_timeout_without_HTTP');
 console.log(JSON.stringify({stage:'compatible_native_TLS',fixtures,status:'PASS',liveProviderCalls:0,committedPrivateKeys:false}));
}catch(error){
 const failure=error as {code?:unknown;status?:unknown};
 console.error(JSON.stringify({stage,status:'FAIL',receivedRequests:hits,expectedHost:lastHost==='api.provider-support.com',expectedSni:lastSni==='api.provider-support.com',
  ...(stage==='certificate_setup'?{setupCode:failure.code??null,setupExit:failure.status??null}:{})}));process.exitCode=1;
}finally{
 for(const socket of sockets)socket.destroy();
 await Promise.all([server,tcp].filter(value=>value!==undefined).map(value=>new Promise<void>(done=>value!.close(()=>done()))));
 assert.equal(dirname(resolve(directory)),parent,'OWNED_TEMP_DIRECTORY_REQUIRED');
 assert(resolve(directory).startsWith(join(parent,'compatible-tls-')),'EXPECTED_TEMP_PREFIX_REQUIRED');
 await rm(directory,{recursive:true,force:true});
}
