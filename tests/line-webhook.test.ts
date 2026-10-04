import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyLineSignature } from '../lib/line/signature';
import { receiveLineWebhook, type IngressEvent } from '../lib/line/receive-webhook';
import { decryptValue } from '../lib/security/identity';

describe('LINE webhook signature', () => {
 const secret='test-channel-secret';
 const body=Buffer.from('{"events":[],"ไทย":"ทดสอบ"}');
 const signature=createHmac('sha256',secret).update(body).digest('base64');
 it('verifies the original UTF-8 bytes',()=>expect(verifyLineSignature(body,signature,secret)).toBe(true));
 it('rejects reserialization, missing signatures and malformed base64',()=>{
  expect(verifyLineSignature(Buffer.from('{ "events":[],"ไทย":"ทดสอบ"}'),signature,secret)).toBe(false);
  expect(verifyLineSignature(body,null,secret)).toBe(false);
  expect(verifyLineSignature(body,'invalid',secret)).toBe(false);
  expect(verifyLineSignature(body,signature,'wrong')).toBe(false);
 });
});

describe('durable signed ingress',()=>{
 const secret='channel-test', encryptionKey=Buffer.alloc(32,7).toString('base64');
 function request(body:string, signature?:string) {
  return new Request('https://helpdesk.invalid/api/line/student/webhook',{method:'POST',body,
   headers:{'x-line-signature':signature??createHmac('sha256',secret).update(body).digest('base64')}});
 }
 const event={type:'message',webhookEventId:'event1',source:{type:'user',userId:'U-private-id'},timestamp:1791050000000,message:{type:'text',id:'msg1',text:'WiFi เข้าไม่ได้'}};
 it('encrypts the event before persistence, and awaits durable storage before acknowledging',async()=>{
  let persisted:IngressEvent[]=[];
  const body=JSON.stringify({events:[event]});
  const result=await receiveLineWebhook(request(body),{channel:'STUDENT',secret,encryptionKey,persist:async events=>{persisted=events;}});
  expect(result.status).toBe(200);
  expect(persisted).toHaveLength(1);
  expect(persisted[0].eventId).toBe('event1');
  expect(JSON.stringify(persisted)).not.toContain('U-private-id');
  expect(JSON.parse(decryptValue(persisted[0].payloadEncrypted,encryptionKey))).toEqual(event);
 });
 it('accepts LINE verification without calling storage',async()=>{
  const result=await receiveLineWebhook(request('{"events":[]}'),{channel:'STUDENT',secret,encryptionKey,persist:async()=>{throw new Error('should not persist');}});
  expect(result.status).toBe(200);
 });
 it('marks only validated message events as messages without exposing their content',async()=>{
  let stored:IngressEvent[]=[];
  const source={type:'user',userId:'U0123456789ABCDEF'};
  const events=[
   {type:'message',webhookEventId:'valid-text',source,message:{type:'text',id:'text-id',text:'สวัสดี'}},
   {type:'follow',webhookEventId:'follow-event',source},
   {type:'message',webhookEventId:'bad-text',source,message:{type:'text',id:'bad-id'}},
   {type:'postback',webhookEventId:'unsupported',source},
  ];
  const response=await receiveLineWebhook(request(JSON.stringify({events})),{channel:'STUDENT',secret,encryptionKey,persist:async entries=>{stored=entries;}});
  expect(response.status).toBe(200);
  expect(stored).toMatchObject([{eventKind:'MESSAGE'},{eventKind:'FOLLOW'},{eventKind:'OTHER'},{eventKind:'OTHER'}]);
  expect(JSON.stringify(stored)).not.toContain('สวัสดี');
 });
 it('rejects signatures and oversized streams before storage',async()=>{
  let writes=0;
  const deps={channel:'STUDENT' as const,secret,encryptionKey,persist:async()=>{writes++;}};
  expect((await receiveLineWebhook(request('{"events":[]}','bad'),deps)).status).toBe(401);
  expect((await receiveLineWebhook(request('x'.repeat(200)),{...deps,maxBytes:100})).status).toBe(413);
  expect(writes).toBe(0);
 });
 it('returns retryable 503 when storage is down or channel is unconfigured',async()=>{
  const body=JSON.stringify({events:[event]});
  expect((await receiveLineWebhook(request(body),{channel:'STUDENT',secret,encryptionKey,persist:async()=>{throw new Error('db-down private details');}})).status).toBe(503);
  expect((await receiveLineWebhook(request(body),{channel:'STUDENT',encryptionKey,persist:async()=>{}})).status).toBe(503);
 });
 it('isolates malformed events rather than losing valid siblings',async()=>{
  let stored:IngressEvent[]=[];
  const body=JSON.stringify({events:[null,event,{type:'future-event',webhookEventId:'new-event'}]});
  expect((await receiveLineWebhook(request(body),{channel:'STUDENT',secret,encryptionKey,persist:async events=>{stored=events;}})).status).toBe(200);
  expect(stored.map(e=>e.eventId)).toContain('event1');
  expect(stored.map(e=>e.eventId)).toContain('new-event');
  expect(stored).toHaveLength(3);
 });
 it('rejects malformed JSON and too many events after signature verification',async()=>{
  const deps={channel:'STUDENT' as const,secret,encryptionKey,persist:async()=>{}};
  expect((await receiveLineWebhook(request('{'),deps)).status).toBe(400);
  expect((await receiveLineWebhook(request(JSON.stringify({events:Array(101).fill(event)})),deps)).status).toBe(400);
 });
});
