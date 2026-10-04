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
 beforeEach(()=>{vi.stubEnv('LINE_STUDENT_CHANNEL_SECRET',secret);vi.stubEnv('ENCRYPTION_KEY','');vi.stubEnv('DATABASE_URL','');vi.spyOn(console,'info').mockImplementation(()=>{});});
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
 it('accepts verification with events: [] using only the channel secret',async()=>{
  const response=await POST(signed('{"events":[]}'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ok:true});
  expect(console.info).toHaveBeenCalled();
 });
 it('accepts a signed message and logs verified content with protected LINE identifiers',async()=>{
  const body=JSON.stringify({events:[{type:'message',source:{type:'user',userId:'U-private'},replyToken:'private-token',message:{type:'text',text:'สวัสดี'}}]});
  expect((await POST(signed(body))).status).toBe(200);
  const log=JSON.stringify(vi.mocked(console.info).mock.calls);
  expect(log).toContain('สวัสดี');
  expect(log).not.toContain('U-private');
  expect(log).not.toContain('private-token');
 });
 it('checks the signature before parsing JSON or logging',async()=>{
  expect((await POST(request('{invalid-json','bad'))).status).toBe(401);
  expect(console.info).not.toHaveBeenCalled();
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
});
