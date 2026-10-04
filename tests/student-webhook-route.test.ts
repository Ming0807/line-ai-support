import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/line/student/webhook/route';

describe('student webhook verification step',()=>{
 const secret='local-test-channel-secret';
 function request(body:string,signature?:string) {
  return new Request('https://helpdesk.invalid/api/line/student/webhook',{method:'POST',body,
   headers:signature===undefined?{}:{'x-line-signature':signature}});
 }
 function signed(body:string){return request(body,createHmac('sha256',secret).update(body).digest('base64'));}
 beforeEach(()=>{vi.stubEnv('LINE_STUDENT_CHANNEL_SECRET',secret);vi.stubEnv('LINE_STUDENT_CHANNEL_ACCESS_TOKEN','test-access-token');vi.stubEnv('ENCRYPTION_KEY','');vi.stubEnv('DATABASE_URL','');vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:200})));vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});});
 afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
 it('accepts verification with events: [] using only the channel secret',async()=>{
  const response=await POST(signed('{"events":[]}'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ok:true});
  expect(console.info).toHaveBeenCalled();
 });
 it('accepts a signed message and logs verified content with protected LINE identifiers',async()=>{
  const body=JSON.stringify({events:[{type:'message',source:{type:'user',userId:'U-private'},replyToken:'private-token',message:{type:'text',text:'สวัสดี',quoteToken:'private-quote',markAsReadToken:'private-read'}}]});
  expect((await POST(signed(body))).status).toBe(200);
  const log=JSON.stringify(vi.mocked(console.info).mock.calls);
  expect(log).toContain('สวัสดี');
  expect(log).not.toContain('U-private');
  expect(log).not.toContain('private-token');
  expect(log).not.toContain('private-quote');
  expect(log).not.toContain('private-read');
 });
 it('checks the signature before parsing JSON or logging',async()=>{
  expect((await POST(request('{invalid-json','bad'))).status).toBe(401);
  expect(console.info).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects a missing signature or modified raw body',async()=>{
  expect((await POST(request('{"events":[]}'))).status).toBe(401);
  const signature=createHmac('sha256',secret).update('{"events":[]}').digest('base64');
  expect((await POST(request('{ "events": [] }',signature))).status).toBe(401);
 });
 it('reports malformed JSON only after a valid signature',async()=>{
  expect((await POST(signed('{invalid-json'))).status).toBe(400);
  expect(console.info).not.toHaveBeenCalled();
 });
 it('reports missing LINE configuration without requiring Supabase or AI',async()=>{
  vi.stubEnv('LINE_STUDENT_CHANNEL_SECRET','');
  expect((await POST(signed('{"events":[]}'))).status).toBe(503);
 });

 function textEvent(text='สวัสดี') {
  return {type:'message',replyToken:'test-reply-token',message:{type:'text',text}};
 }
 function logs(){return JSON.stringify([...vi.mocked(console.info).mock.calls,...vi.mocked(console.error).mock.calls]);}
 it('replies to verified text using the event token and the exact Thai echo',async()=>{
  expect((await POST(signed(JSON.stringify({events:[textEvent()]})))).status).toBe(200);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.line.me/v2/bot/message/reply',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-access-token'},
   body:JSON.stringify({replyToken:'test-reply-token',messages:[{type:'text',text:'ได้รับข้อความแล้วครับ: สวัสดี'}]}),
   signal:expect.any(AbortSignal),
  });
  expect(logs()).toContain('LINE student reply sent');
  expect(logs()).not.toContain('test-access-token');
  expect(logs()).not.toContain('test-reply-token');
  expect(logs()).not.toContain(secret);
 });
 it('ignores non-text and malformed event siblings while replying to valid text',async()=>{
  const events=[null,{}, {type:'follow',replyToken:'unused'}, {type:'message',message:{type:'image'},replyToken:'unused'},
   {type:'message',message:{type:'text',text:42},replyToken:'unused'},textEvent(' ข้อความเดิม ' )];
  expect((await POST(signed(JSON.stringify({events})))).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  const options=vi.mocked(fetch).mock.calls[0][1];
  expect(JSON.parse(String(options?.body)).messages[0].text).toBe('ได้รับข้อความแล้วครับ:  ข้อความเดิม ');
 });
 it('accepts empty verification events without requiring an access token or calling LINE',async()=>{
  vi.stubEnv('LINE_STUDENT_CHANNEL_ACCESS_TOKEN','');
  expect((await POST(signed('{"events":[]}'))).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('logs a missing access token safely and still acknowledges a valid webhook',async()=>{
  vi.stubEnv('LINE_STUDENT_CHANNEL_ACCESS_TOKEN','');
  expect((await POST(signed(JSON.stringify({events:[textEvent()]})))).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
  expect(logs()).toContain('LINE_STUDENT_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED');
 });
 it('logs LINE API status without echoing its error body or credentials and returns200',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(`private error: test-access-token test-reply-token ${secret}`,{status:401}));
  expect((await POST(signed(JSON.stringify({events:[textEvent()]})))).status).toBe(200);
  expect(logs()).toContain('LINE_REPLY_API_ERROR');
  expect(logs()).toContain('401');
  expect(logs()).not.toContain('test-access-token');
  expect(logs()).not.toContain('test-reply-token');
  expect(logs()).not.toContain(secret);
 });
 it('handles network exceptions without leaking an error containing credentials',async()=>{
  vi.mocked(fetch).mockRejectedValue(new Error(`private network error: test-access-token test-reply-token ${secret}`));
  expect((await POST(signed(JSON.stringify({events:[textEvent()]})))).status).toBe(200);
  expect(logs()).toContain('LINE_REPLY_NETWORK_ERROR');
  expect(logs()).not.toContain('test-access-token');
  expect(logs()).not.toContain('test-reply-token');
  expect(logs()).not.toContain(secret);
 });
 it('rejects a verified payload without an events array without crashing or calling LINE',async()=>{
  expect((await POST(signed('{"events":"invalid"}'))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('preserves a maximum-length original message while keeping every reply text within LINE limits',async()=>{
  const text='ก'.repeat(5000);
  expect((await POST(signed(JSON.stringify({events:[textEvent(text)]})))).status).toBe(200);
  const body=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as {messages:Array<{type:string;text:string}>};
  expect(body.messages.every(message=>message.type==='text' && message.text.length<=5000)).toBe(true);
  expect(body.messages.map(message=>message.text).join('')).toBe(`ได้รับข้อความแล้วครับ: ${text}`);
  expect(body.messages.length).toBeLessThanOrEqual(5);
 });
 it('keeps an emoji intact when the exact echo spans LINE text messages',async()=>{
  const prefix='ได้รับข้อความแล้วครับ: ';
  const text='ก'.repeat(5000-prefix.length-1)+'😀'+'ท้าย';
  expect((await POST(signed(JSON.stringify({events:[textEvent(text)]})))).status).toBe(200);
  const body=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as {messages:Array<{text:string}>};
  expect(body.messages.length).toBe(2);
  expect(body.messages.every(message=>message.text.length<=5000)).toBe(true);
  expect(body.messages.map(message=>message.text).join('')).toBe(prefix+text);
  expect(body.messages[0].text).not.toMatch(/[\uD800-\uDBFF]$/);
  expect(body.messages[1].text).not.toMatch(/^[\uDC00-\uDFFF]/);
 });
 it('skips an echo that cannot fit in LINE\'s five-message reply limit and acknowledges the webhook',async()=>{
  expect((await POST(signed(JSON.stringify({events:[textEvent('ก'.repeat(25000))]})))).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
  expect(logs()).toContain('LINE_REPLY_TEXT_TOO_LONG');
 });
});
