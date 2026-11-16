import {describe,expect,it} from 'vitest';
import {inputHoldForText,inputHoldForEvent,greetingKind,greetingReply,INPUT_QUIET_MS,INPUT_EXTENDED_QUIET_MS,INPUT_WINDOW_CAP_MS} from '../lib/conversation/input-hold';

// CONV-BURST-01 / CONV-GREET-01 (DEC-206): deterministic rules. The hold only changes how long the
// collection window waits; it never decides meaning, routing or authority.
describe('CONV-BURST-01 adaptive quiet gap',()=>{
 it('uses ~2.5 s normally, up to 8 s for fragments that look unfinished, and a 15 s cap',()=>{
  expect(INPUT_QUIET_MS).toBe(2500);expect(INPUT_EXTENDED_QUIET_MS).toBe(8000);expect(INPUT_WINDOW_CAP_MS).toBe(15000);
 });
 it('extends for a lone greeting, a very short fragment or an opener that announces a question',()=>{
  for(const text of ['สวัสดีครับ','หวัดดีค่ะ','hello','Hi!','ขอถามหน่อยครับ','สอบถามหน่อยค่ะ','รบกวนสอบถามครับ','คือ','คือว่า...','แล้วก็','อยากถามว่า','เอ่อ','ครับ','ค่ะ','ขอสอบถามเรื่อง','ถามหน่อย,','อ่า'])
   expect(inputHoldForText(text),text).toBe('EXTENDED');
 });
 it('keeps the normal gap for a complete question or statement, even when short or misspelled',()=>{
  for(const text of ['เทียบโอนยังไง','ค่าเทอมเท่าไหร่ครับ','ลงทะเบียนเรียนตอนไหน','wifi เข้าไม่ได้','ขอบคุณครับ','ลืมรหัสผ่าน','กยศ ยื่นที่ไหน','จ่ายค่าเทมยังไงครับ'])
   expect(inputHoldForText(text),text).toBe('NORMAL');
 });
 it('reads only the text of a Student text message event; anything else is NORMAL',()=>{
  expect(inputHoldForEvent({type:'message',message:{type:'text',text:'สวัสดีครับ'}})).toBe('EXTENDED');
  expect(inputHoldForEvent({type:'message',message:{type:'text',text:'เทียบโอนยังไง'}})).toBe('NORMAL');
  for(const event of [null,{},{type:'follow'},{type:'message',message:{type:'image'}},{type:'message',message:{type:'text',text:42}},{type:'postback',postback:{data:'x'}}])
   expect(inputHoldForEvent(event)).toBe('NORMAL');
 });
});

describe('CONV-GREET-01 greeting without a model call',()=>{
 it('recognises a whole turn made only of greetings or thanks, with particles, names and emoji',()=>{
  for(const text of ['สวัสดี','สวัสดีครับ','สวัสดีค่ะแอดมิน','หวัดดีครับบบ','ดีครับ','Hello','hi admin','สวัสดีครับ\nสวัสดีค่ะ','สวัสดีครับ 🙏','สวัสดีครับผม'])
   expect(greetingKind(text),text).toBe('GREETING');
  for(const text of ['ขอบคุณครับ','ขอบคุณมากค่ะ','ขอบใจนะ','thank you','Thanks!','ขอบคุณครับ 🙏'])
   expect(greetingKind(text),text).toBe('THANKS');
 });
 it('never treats a turn that carries any question or content as a greeting',()=>{
  for(const text of ['สวัสดีครับ เทียบโอนยังไง','สวัสดีครับ\nเทียบโอนยังไง','ขอบคุณครับ แล้วค่าเทอมเท่าไหร่','hello can I ask','ดี','สวัสดีปีใหม่ค่าเทอมเท่าไหร่','','   ','ขอถามหน่อยครับ','ครับ'])
   expect(greetingKind(text),text).toBeNull();
 });
 it('replies with fixed short text; a greeting offers three topic buttons, thanks offers none',()=>{
  const hello=greetingReply('GREETING'),thanks=greetingReply('THANKS');
  expect(hello.text.length).toBeLessThanOrEqual(200);
  expect(hello.topics).toHaveLength(3);
  for(const topic of hello.topics){expect(topic.length).toBeGreaterThan(0);expect(Array.from(topic).length).toBeLessThanOrEqual(20);}
  expect(new Set(hello.topics).size).toBe(3);
  expect(thanks.topics).toEqual([]);
  expect(thanks.text).not.toBe(hello.text);
 });
});

describe('CONV-BURST-01 ingress hint',()=>{
 it('the Student webhook attaches only the hold hint from the plain text; Staff events carry none',async()=>{
  const {createHmac}=await import('node:crypto');
  const {receiveLineWebhook}=await import('../lib/line/receive-webhook');
  const secret='channel-test',encryptionKey=Buffer.alloc(32,7).toString('base64');
  const events=[{type:'message',webhookEventId:'e1',source:{type:'user',userId:'U1'},message:{type:'text',id:'m1',text:'สวัสดีครับ'}},
   {type:'message',webhookEventId:'e2',source:{type:'user',userId:'U1'},message:{type:'text',id:'m2',text:'เทียบโอนยังไง'}},
   {type:'follow',webhookEventId:'e3',source:{type:'user',userId:'U1'}}];
  const body=JSON.stringify({events});
  const signed=()=>new Request('https://helpdesk.invalid/webhook',{method:'POST',body,headers:{'x-line-signature':createHmac('sha256',secret).update(body).digest('base64')}});
  let student:unknown[]=[],staff:unknown[]=[];
  expect((await receiveLineWebhook(signed(),{channel:'STUDENT',secret,encryptionKey,persist:async e=>{student=e;}})).status).toBe(200);
  expect(student.map(e=>(e as {inputHold?:string}).inputHold)).toEqual(['EXTENDED','NORMAL','NORMAL']);
  expect(JSON.stringify(student)).not.toContain('สวัสดี');
  await receiveLineWebhook(signed(),{channel:'STAFF',secret,encryptionKey,persist:async e=>{staff=e;}});
  expect(staff.every(e=>!('inputHold' in (e as object)))).toBe(true);
 });
});

describe('NATURAL-EDGE-01 contentless turns',()=>{
 it('a turn of only punctuation or emoji is EMPTY; a nudge without content is NUDGE; anything with content is null',async()=>{
  const {contentlessKind}=await import('../lib/conversation/input-hold');
  for(const text of ['?','??','!!!','😭','🙏🙏','...',' ? '])expect(contentlessKind(text),text).toBe('EMPTY');
  for(const text of ['ตอบด้วย','ตอบหน่อยครับ','มีใครอยู่ไหม','มีคนอยู่ไหมคะ','ไม่มีคนตอบเลย','ไม่มีใครตอบเลยหรอ','ตอบด้วยค่ะ??'])expect(contentlessKind(text),text).toBe('NUDGE');
  for(const text of ['555','ค่าเทอม?','ตอบด้วย ค่าเทอมเท่าไหร่','อยากรู้ตารางสอบ\n??','ยังไง','สวัสดี'])expect(contentlessKind(text),text).toBeNull();
 });
});
