import {describe,it,expect} from 'vitest';
import {projectRoutingContext,semanticPromptSchema} from '../lib/conversation/semantic-routing-contracts';

const candidate={conversationId:'00000000-0000-4000-8000-000000000001',conversationRevision:2,
 mode:'HUMAN',topicLabel:'เรื่องเทียบโอน',ticketId:'00000000-0000-4000-8000-000000000002',ticketRevision:2,
 ticketStatus:'WAITING_USER',topic:'เรื่องเทียบโอน',summary:'เทียบโอนวิชาไม่ได้',history:[
  {id:'u1',content:'เทียบโอนวิชาไม่ได้',createdAt:'2026-10-28T10:18:00Z',senderType:'USER'},
  {id:'s1',content:'ขอชื่อและรหัสนักศึกษาด้วยครับ',createdAt:'2026-10-28T10:20:00Z',senderType:'STAFF'},
 ]};
describe('CHAT02 role-aware routing context',()=>{
 it('preserves a delivered Staff question as staff speech, never student speech',()=>{
  const contexts=Reflect.apply(projectRoutingContext,undefined,[[candidate]]);
  expect(contexts[0].recentMessages).toEqual([{role:'user',content:'เทียบโอนวิชาไม่ได้'},
   {role:'staff',content:'ขอชื่อและรหัสนักศึกษาด้วยครับ'}]);
 });
 it('does not place Staff questions in previous student messages',()=>{
  const contexts=Reflect.apply(projectRoutingContext,undefined,[[candidate]]);
  expect(contexts[0].previousUserMessages).toEqual(['เทียบโอนวิชาไม่ได้']);
 });
 it('accepts the staff-labelled projection in the bounded provider contract',()=>{
  expect(semanticPromptSchema.safeParse({question:'ชื่อผู้แจ้งและรหัสที่เจ้าหน้าที่ขอ',contexts:[{
   code:'C1',mode:'HUMAN',topic:'เรื่องเทียบโอน',summary:'เทียบโอนวิชาไม่ได้',previousUserMessages:['เทียบโอนวิชาไม่ได้'],
   recentMessages:[{role:'staff',content:'ขอชื่อและรหัสนักศึกษาด้วยครับ'}],
  }]}).success).toBe(true);
 });
});
