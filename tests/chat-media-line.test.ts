import {afterEach,expect,it,vi} from 'vitest';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError} from '../lib/chat/media-binary';
import {downloadLineChatMedia} from '../lib/chat/media-line';

const token='fixture-line-access-token';
const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x01,0x11,0xff,0xd9]);
function arrayBuffer(bytes:Uint8Array):ArrayBuffer{
 const copy=new ArrayBuffer(bytes.byteLength);new Uint8Array(copy).set(bytes);return copy;
}
function response(bytes:Uint8Array,contentType='image/jpeg',headers:Record<string,string>={}){
 return new Response(arrayBuffer(bytes),{headers:{'content-type':contentType,...headers}});
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it('downloads the exact LINE message content from the fixed encoded endpoint with no redirects',async()=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>response(jpeg));
 const messageId='LINE/message id?';
 const result=await downloadLineChatMedia(messageId,{token,fetch});
 expect(result).toEqual({bytes:jpeg,contentType:'image/jpeg'});
 expect(fetch).toHaveBeenCalledOnce();
 const [url,init]=fetch.mock.calls[0];
 expect(String(url)).toBe(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`);
 expect(new URL(String(url)).origin).toBe('https://api-data.line.me');
 expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
 expect(new Headers(init?.headers).get('accept-encoding')).toBe('identity');
 expect(init?.redirect).toBe('error');
 expect(init?.cache).toBe('no-store');
 expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it('maps known upstream failures to fixed codes without returning response bodies or credentials',async()=>{
 for(const [status,code] of [[404,'NOT_FOUND'],[410,'NOT_FOUND'],[401,'UNAVAILABLE'],[429,'UNAVAILABLE'],[500,'UNAVAILABLE'],[503,'UNAVAILABLE']] as const){
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response('PRIVATE_UPSTREAM_TOKEN_OR_BODY',{status}));
  await expect(downloadLineChatMedia('line-message-id',{token,fetch})).rejects.toMatchObject({code});
  await expect(downloadLineChatMedia('line-message-id',{token,fetch})).rejects.not.toThrow('PRIVATE_UPSTREAM_TOKEN_OR_BODY');
 }
 const missingToken=vi.fn<typeof globalThis.fetch>();
 await expect(downloadLineChatMedia('line-message-id',{fetch:missingToken})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(missingToken).not.toHaveBeenCalled();
});

it('rejects declared or streamed bodies above 10 MiB without returning truncated bytes',async()=>{
 const neverRead=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(jpeg);},cancel(){}});
 const declaredFetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(neverRead,{headers:{'content-length':String(CHAT_MEDIA_MAX_BYTES+1)}}));
 await expect(downloadLineChatMedia('line-message-id',{token,fetch:declaredFetch})).rejects.toMatchObject({code:'TOO_LARGE'});

 let cancelled=false;
 const oversizedStream=new ReadableStream<Uint8Array>({
  pull(controller){controller.enqueue(new Uint8Array(CHAT_MEDIA_MAX_BYTES));controller.enqueue(new Uint8Array(1));},
  cancel(){cancelled=true;},
 });
 const streamedFetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(oversizedStream,{headers:{'content-type':'application/octet-stream'}}));
 await expect(downloadLineChatMedia('line-message-id',{token,fetch:streamedFetch})).rejects.toMatchObject({code:'TOO_LARGE'});
 expect(cancelled).toBe(true);
});

it('aborts an unresponsive LINE fetch at the configured timeout and reports a fixed error',async()=>{
 vi.useFakeTimers();
 let signal:AbortSignal|undefined;
 const fetch=vi.fn<typeof globalThis.fetch>(async(_input,init)=>{
  signal=init?.signal??undefined;
  return new Promise<Response>(()=>undefined);
 });
 const work=downloadLineChatMedia('line-message-id',{token,fetch,timeoutMs:15_000});
 const failure=expect(work).rejects.toMatchObject({code:'UNAVAILABLE'});
 await vi.advanceTimersByTimeAsync(15_000);
 await failure;
 expect(signal?.aborted).toBe(true);
});

it('uses redirect:error and normalizes rejected redirects or network details',async()=>{
 const redirect=vi.fn<typeof globalThis.fetch>(async()=>Response.redirect('https://attacker.example/private',302));
 await expect(downloadLineChatMedia('line-message-id',{token,fetch:redirect})).rejects.toBeInstanceOf(ChatMediaError);
 const network=vi.fn<typeof globalThis.fetch>(async()=>{throw new Error('PRIVATE_NETWORK_ERROR');});
 await expect(downloadLineChatMedia('line-message-id',{token,fetch:network})).rejects.toMatchObject({code:'UNAVAILABLE'});
 await expect(downloadLineChatMedia('line-message-id',{token,fetch:network})).rejects.not.toThrow('PRIVATE_NETWORK_ERROR');
 expect(redirect.mock.calls[0]?.[1]?.redirect).toBe('error');
});
