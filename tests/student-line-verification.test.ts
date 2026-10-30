import {randomBytes} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {hashLineUserId} from '../lib/security/identity';
import {verifyConfiguredStudentLineIdToken} from '../lib/chat/student-line-verification';

vi.mock('server-only',()=>({}));
const key=randomBytes(32).toString('base64');
const user='U'+'a'.repeat(32),channelId='1234567890',token='fixture.header.signature';
const claims={iss:'https://access.line.me',sub:user,aud:channelId,iat:1_700_000_000,exp:1_700_000_600,name:'PRIVATE_FIXTURE'};
const now=()=>1_700_000_100_000;
const success=()=>vi.fn<typeof globalThis.fetch>(async()=>Response.json(claims));
function verifyStudentLineIdToken(input:{token:string;channelId:string;key:string},options:Parameters<typeof verifyConfiguredStudentLineIdToken>[1]){
 vi.stubEnv('ENCRYPTION_KEY',input.key);vi.stubEnv('LINE_STUDENT_LOGIN_CHANNEL_ID',input.channelId);
 vi.stubEnv('LINE_STUDENT_MEDIA_VIEWER_ENABLED','true');vi.stubEnv('LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED','true');
 return verifyConfiguredStudentLineIdToken(input.token,options);
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();});

it('verifies with LINE and returns only the existing anonymous identity hash and expiry',async()=>{
 const fetch=success();const result=await verifyStudentLineIdToken({token,channelId,key},{fetch,now});
 expect(result).toEqual({userHash:hashLineUserId(user,key),expiresAt:claims.exp});
 const [url,init]=fetch.mock.calls[0];expect(url).toBe('https://api.line.me/oauth2/v2.1/verify');
 expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');
 expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
 expect(new URLSearchParams(String(init?.body)).get('client_id')).toBe(channelId);
 expect(new URLSearchParams(String(init?.body)).get('id_token')).toBe(token);
 expect(JSON.stringify(result)).not.toContain(user);expect(JSON.stringify(result)).not.toContain('PRIVATE_FIXTURE');
});

it.each([
 {...claims,aud:'9876543210'}, {...claims,iss:'https://spoof.example'}, {...claims,sub:'U'+'b'.repeat(31)},
 {...claims,exp:1_700_000_100}, {...claims,iat:1_700_000_200}, {...claims,exp:'1700000600'},
])('rejects inconsistent or expired server-verified claims %#',async response=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json(response));
 await expect(verifyStudentLineIdToken({token,channelId,key},{fetch,now})).rejects.toMatchObject({code:'INVALID_IDENTITY'});
});

it('rejects malformed or oversized inputs and bad server configuration before network access',async()=>{
 const fetch=success();
 for(const input of [{token:'bad token',channelId,key},{token:'x'.repeat(9000),channelId,key},
  {token,channelId:'evil.example',key},{token,channelId,key:'not-a-key'}]){
  await expect(verifyStudentLineIdToken(input,{fetch,now})).rejects.toBeDefined();
 }
 expect(fetch).not.toHaveBeenCalled();
});

it('handles invalid, unavailable, redirect and oversized responses without exposing private data',async()=>{
 for(const [response,code] of [
  [new Response('PRIVATE_RESPONSE',{status:400}),'INVALID_IDENTITY'],
  [new Response('PRIVATE_RESPONSE',{status:429}),'UNAVAILABLE'],
  [new Response('PRIVATE_RESPONSE',{status:503}),'UNAVAILABLE'],
  [new Response(null,{status:302,headers:{location:'https://evil.example/'}}),'UNAVAILABLE'],
  [new Response('x'.repeat(17000),{headers:{'content-type':'application/json'}}),'UNAVAILABLE'],
 ] as const){
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>response);
  try{await verifyStudentLineIdToken({token,channelId,key},{fetch,now});throw new Error('EXPECTED_FAILURE');}
  catch(error){expect(error).toMatchObject({code});expect(String(error)).not.toContain(token);expect(String(error)).not.toContain('PRIVATE_RESPONSE');}
 }
});

it('fails closed on compressed, malformed or non-JSON provider replies',async()=>{
 const replies=[new Response('{bad',{headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify(claims),{headers:{'content-type':'application/json','content-encoding':'gzip'}}),
  new Response('not JSON',{headers:{'content-type':'text/plain'}})];
 for(const reply of replies){
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>reply);
  await expect(verifyStudentLineIdToken({token,channelId,key},{fetch,now})).rejects.toMatchObject({code:'UNAVAILABLE'});
 }
});

it('times out even if the transport ignores abort and cancels an already aborted request before fetch',async()=>{
 vi.useFakeTimers();const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Promise<Response>(()=>undefined));
 const attempt=verifyStudentLineIdToken({token,channelId,key},{fetch,now,timeoutMs:100});
 const failure=expect(attempt).rejects.toMatchObject({code:'UNAVAILABLE'});await vi.advanceTimersByTimeAsync(100);await failure;
 const controller=new AbortController();controller.abort();const never=success();
 await expect(verifyStudentLineIdToken({token,channelId,key},{fetch:never,now,signal:controller.signal})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(never).not.toHaveBeenCalled();
});

it('keeps the configured adapter disabled until the operator confirms the Student channel/provider',async()=>{
 vi.stubEnv('ENCRYPTION_KEY',key);vi.stubEnv('LINE_STUDENT_LOGIN_CHANNEL_ID',channelId);
 const fetch=success();
 for(const [enabled,confirmed] of [['false','true'],['true','false'],['true','']] as const){
  vi.stubEnv('LINE_STUDENT_MEDIA_VIEWER_ENABLED',enabled);vi.stubEnv('LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED',confirmed);
  await expect(verifyConfiguredStudentLineIdToken(token,{fetch,now})).rejects.toMatchObject({code:'UNAVAILABLE'});
 }
 expect(fetch).not.toHaveBeenCalled();
 vi.stubEnv('LINE_STUDENT_MEDIA_VIEWER_ENABLED','true');vi.stubEnv('LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED','true');
 vi.stubEnv('ENCRYPTION_KEY','invalid');
 await expect(verifyConfiguredStudentLineIdToken(token,{fetch,now})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(fetch).not.toHaveBeenCalled();vi.stubEnv('ENCRYPTION_KEY',key);
 await expect(verifyConfiguredStudentLineIdToken(token,{fetch,now})).resolves.toEqual({userHash:hashLineUserId(user,key),expiresAt:claims.exp});
 expect(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)).get('client_id')).toBe(channelId);
});

it('cancels a late response body after timeout when a transport ignores abort',async()=>{
 vi.useFakeTimers();let finish!:(response:Response)=>void,cancelled=false;
 const fetch=vi.fn<typeof globalThis.fetch>(()=>new Promise(resolve=>{finish=resolve;}));
 const result=verifyStudentLineIdToken({token,channelId,key},{fetch,now,timeoutMs:100});
 const failure=expect(result).rejects.toMatchObject({code:'UNAVAILABLE'});
 await vi.advanceTimersByTimeAsync(100);await failure;
 const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 finish(new Response(body,{headers:{'content-type':'application/json'}}));
 await Promise.resolve();await Promise.resolve();
 expect(cancelled).toBe(true);
});
