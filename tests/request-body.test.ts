import {expect,it} from 'vitest';
import {readBoundedBody} from '../lib/security/request-body';
it('cancels a streaming body at the byte limit without buffering later chunks',async()=>{
 let reads=0,cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(controller){reads++;controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}},{highWaterMark:0});
 const request=new Request('http://localhost',{method:'POST',body:stream,duplex:'half'} as RequestInit);
 expect(await readBoundedBody(request,12)).toBeNull();expect(cancelled).toBe(true);expect(reads).toBe(2);
});
it('preserves exact byte sequences within the limit',async()=>{
 const request=new Request('http://localhost',{method:'POST',body:'สวัสดี'});
 const bytes=await readBoundedBody(request,32);expect(new TextDecoder().decode(bytes!)).toBe('สวัสดี');
});
