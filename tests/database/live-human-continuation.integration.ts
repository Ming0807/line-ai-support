import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {processStudentContent} from '../../lib/conversation/student-processing';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import {decryptValue,encryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';
import type {DirectUserEvent} from '../../lib/line/events';
import type {InboxJob} from '../../lib/queue/process-inbox';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database));
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4});
const key=Buffer.alloc(32,79).toString('base64');
const sessions:string[]=[],hashes:string[]=[],createdStaff:string[]=[];
after(async()=>{try{
 await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where channel='STUDENT' and user_hash=any($1::text[])",[hashes]);
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where (line_session_id=any($1::uuid[]) or ticket_id in(select id from public.tickets where line_session_id=any($1::uuid[]))) and status in ('PENDING','PROCESSING')",[sessions]);
 await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])',[createdStaff]);
 }finally{await pool.end();}});
async function fixture(sensitive=false){
 const userId='U'+randomUUID().replaceAll('-',''),hash=hashLineUserId(userId,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['LIVE_UX_'+randomUUID()])).rows[0].id;
 sessions.push(session);hashes.push(hash);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hash,encryptValue(userId,key)]);
 const department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id;
 const staffIds:string[]=[];
 for(const role of [sensitive?'SUPER_ADMIN':'STAFF','SUPERVISOR','STAFF']){
  const id=randomUUID();staffIds.push(id);createdStaff.push(id);await pool.query('insert into auth.users(id) values($1)',[id]);
  await pool.query('insert into public.staff_profiles(id,display_name,department_id,role) values($1,$2,$3,$4)',[id,'Owned UX fixture',department,role]);
  if(staffIds.length<3){const line='U'+randomUUID().replaceAll('-','');await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',[id,hashStaffLineUserId(line,key),encryptValue(line,key)]);}
 }
 const conversation=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode) values($1,'TICKET','HUMAN') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status,assigned_staff_id,sensitive_level) values($1,$2,$3,'PRIVATE_ISSUE','HUMAN','WAITING_USER',$4,$5) returning id,ticket_no",[session,conversation,department,staffIds[0],sensitive?'RESTRICTED':'GENERAL'])).rows[0];
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket.id]);
 return {session,userId,hash,conversation,ticket,staff:staffIds[0],otherStaff:staffIds[1],unboundStaff:staffIds[2]};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function event(f:Fixture,text:string,postback=false){
 const value:DirectUserEvent=postback?{type:'postback',source:{type:'user',userId:f.userId},postback:{data:text}}:{type:'message',source:{type:'user',userId:f.userId},message:{type:'text',id:'ux-'+randomUUID(),text}};
 const job=(await pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,$4,'PROCESSING',$5,clock_timestamp()+interval '30 seconds',1) returning *",[randomUUID(),f.hash,encryptValue(JSON.stringify(value),key),postback?'OTHER':'MESSAGE',randomUUID()])).rows[0];
 return {value,job,input:{sessionId:f.session,eventId:job.id,receivedAt:job.received_at,event:value}};
}
async function send(f:Fixture,text:string,postback=false,aiEnabled=true){const e=await event(f,text,postback);await transaction(c=>processStudentContent(c,e.input,key,{aiEnabled}),pool);return e;}
async function latestStudent(f:Fixture){const row=(await pool.query("select payload_encrypted from private.message_outbox where line_session_id=$1 order by outbox_seq desc limit 1",[f.session])).rows[0];return JSON.parse(decryptValue(row.payload_encrypted,key)).messages[0];}
async function selectHuman(f:Fixture){
 await send(f,'PRIVATE_USER_MESSAGE');const prompt=await latestStudent(f);
 const choice=prompt.quickReply.items.find((x:{action:{displayText:string}})=>x.action.displayText.startsWith('ต่อ '));assert(choice);
 await send(f,choice.action.data,true);
 return (await pool.query('select id from public.messages where ticket_id=$1 order by created_at desc,id desc limit 1',[f.ticket.id])).rows[0].id as string;
}
test('explicit HUMAN selection acknowledges delivery and notifies only the eligible bound assignee without user content',async()=>{
 const f=await fixture();await selectHuman(f);const receipt=await latestStudent(f);
 assert.match(receipt.text,/ส่งข้อความ/);assert(receipt.text.includes(f.ticket.ticket_no));assert(!receipt.text.includes('PRIVATE_USER_MESSAGE'));
 assert(receipt.quickReply.items.some((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่'));
 const alerts=(await pool.query("select recipient_staff_id,payload_encrypted from private.message_outbox where ticket_id=$1 and channel='STAFF'",[f.ticket.id])).rows;
 assert.deepEqual(alerts.map(r=>r.recipient_staff_id),[f.staff]);const text=decryptValue(alerts[0].payload_encrypted,key);assert(text.includes(f.ticket.ticket_no));assert(!text.includes('PRIVATE_'));
 assert.equal((await pool.query('select status from public.tickets where id=$1',[f.ticket.id])).rows[0].status,'STAFF_HANDLING');
});
test('explicit current HUMAN focus survives unavailable classification without asking again or creating an AI job',async()=>{
 const f=await fixture();await selectHuman(f);const e=await send(f,'แก้อย่างไร');
 assert.equal((await pool.query('select ticket_id from public.messages where source_event_id=$1',[e.job.id])).rows[0].ticket_id,f.ticket.id);
 assert.match((await latestStudent(f)).text,/ส่งข้อความ/);
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where ticket_id=$1 and channel='STAFF'",[f.ticket.id])).rows[0].n,2);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
});
test('focus expiry asks for context and cannot extend the original deliberate selection window',async()=>{
 const f=await fixture();const anchor=await selectHuman(f);
 await pool.query("update public.messages set metadata=jsonb_set(metadata,'{routing_focus,selectedAt}',to_jsonb((clock_timestamp()-interval '11 minutes')::text)) where id=$1",[anchor]);
 const e=await send(f,'next');assert.equal((await pool.query('select ticket_id from public.messages where source_event_id=$1',[e.job.id])).rows[0].ticket_id,null);
 assert.match((await latestStudent(f)).text,/เรื่อง/);
});
test('explicit NEW clears focus and can create a separate AI topic while retaining the HUMAN ticket',async()=>{
 const f=await fixture();await selectHuman(f);const receipt=await latestStudent(f);const fresh=receipt.quickReply.items.find((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่');assert(fresh);await send(f,fresh.action.data,true);
 await send(f,'ห้องสมุดเปิดกี่โมง');
 const ai=(await pool.query('select conversation_id from private.ai_jobs where line_session_id=$1',[f.session])).rows;assert.equal(ai.length,1);assert.notEqual(ai[0].conversation_id,f.conversation);
 assert.equal((await pool.query('select mode from public.tickets where id=$1',[f.ticket.id])).rows[0].mode,'HUMAN');
});
test('an AI NEW button is remembered for the next question without asking to choose NEW again',async()=>{
 const f=await fixture();await send(f,'new question');const prompt=await latestStudent(f),chooseNew=prompt.quickReply.items.find((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่');await send(f,chooseNew.action.data,true);
 // The new AI context now has its normal NEW action (no pending USER message).
 const first=(await pool.query('select conversation_id,request_encrypted from private.ai_jobs where line_session_id=$1',[f.session])).rows[0];
 const request=JSON.parse(decryptValue(first.request_encrypted,key));
 const action=request.quickReply.items.find((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่');assert(action);
 await send(f,action.action.data,true);assert.equal((await latestStudent(f)).text,'ส่งคำถามเรื่องใหม่มาได้เลยครับ');
 const next=await event(f,'ห้องสมุดเปิดกี่โมง');let classified=false;
 assert.equal(await classifyStudentInboxContext(pool,next.job as InboxJob,key,async()=>{classified=true;return {decision:'NEW',candidateCode:null,confidence:.99};}),null);
 assert.equal(classified,false);
 await transaction(c=>processStudentContent(c,next.input,key,{aiEnabled:true}),pool);
 const jobs=(await pool.query('select conversation_id from private.ai_jobs where line_session_id=$1',[f.session])).rows;
 assert.equal(jobs.length,2);assert(jobs.some(r=>r.conversation_id!==first.conversation_id));
});
test('closed tickets cannot be selected by retained HUMAN focus',async()=>{
 const f=await fixture();await selectHuman(f);await pool.query("update public.tickets set status='CLOSED' where id=$1",[f.ticket.id]);await pool.query("update public.conversations set status='CLOSED' where id=$1",[f.conversation]);
 const e=await send(f,'next');assert.equal((await pool.query('select ticket_id from public.messages where source_event_id=$1',[e.job.id])).rows[0].ticket_id,null);
 assert.equal((await pool.query('select status from public.tickets where id=$1',[f.ticket.id])).rows[0].status,'CLOSED');
});
test('valid semantic NEW overrides explicit focus rather than capturing a new question in HUMAN',async()=>{
 const f=await fixture();await selectHuman(f);const e=await event(f,'ห้องสมุดเปิดกี่โมง');
 const advice=await classifyStudentInboxContext(pool,e.job as InboxJob,key,async()=>({decision:'NEW',candidateCode:null,confidence:.99}));assert(advice);
 await transaction(c=>processStudentContent(c,e.input,key,{aiEnabled:true,routingAdvice:advice}),pool);
 assert.notEqual((await pool.query('select conversation_id from public.messages where source_event_id=$1',[e.job.id])).rows[0].conversation_id,f.conversation);
});
test('restricted USER continuation alerts expose no ticket number, problem or message body',async()=>{
 const f=await fixture(true);await selectHuman(f);const alerts=(await pool.query("select payload_encrypted from private.message_outbox where ticket_id=$1 and channel='STAFF'",[f.ticket.id])).rows;assert.equal(alerts.length,1);
 const payload=decryptValue(alerts[0].payload_encrypted,key);for(const value of [f.ticket.ticket_no,'PRIVATE_ISSUE','PRIVATE_USER_MESSAGE'])assert(!payload.includes(value));
});
test('a foreign selection anchor cannot authorize another session continuation',async()=>{
 const first=await fixture(),second=await fixture();const foreign=await selectHuman(first),own=await selectHuman(second);
 await pool.query("update public.messages set metadata=jsonb_set(metadata,'{routing_focus,anchorMessageId}',to_jsonb($2::text)) where id=$1",[own,foreign]);
 const e=await send(second,'next');assert.equal((await pool.query('select ticket_id from public.messages where source_event_id=$1',[e.job.id])).rows[0].ticket_id,null);
});
test('an unbound assignee does not silently redirect private notifications to another bound staff member',async()=>{
 const f=await fixture();await pool.query('update private.staff_line_identities set active=false where staff_id=$1',[f.staff]);await selectHuman(f);
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where ticket_id=$1 and channel='STAFF'",[f.ticket.id])).rows[0].n,0);
});
test('explicit NEW is consumed once and expires without bypassing later context selection',async()=>{
 const f=await fixture();await selectHuman(f);const button=(await latestStudent(f)).quickReply.items.find((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่');
 await send(f,button.action.data,true);await send(f,'a separate question');await send(f,'ambiguous question');
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,1);
 assert.match((await latestStudent(f)).text,/ข้อความนี้เป็นเรื่องใด/);
 const expired=await fixture();const anchor=await selectHuman(expired);const fresh=(await latestStudent(expired)).quickReply.items.find((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่');await send(expired,fresh.action.data,true);
 await pool.query("update public.messages set metadata=jsonb_set(metadata,'{routing_new_topic,selectedAt}',to_jsonb((clock_timestamp()-interval '11 minutes')::text)) where id=$1",[anchor]);
 await send(expired,'question');assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[expired.session])).rows[0].n,0);
});
test('explicit NEW routing is retained even when generation is disabled',async()=>{
 const f=await fixture();await selectHuman(f);const button=(await latestStudent(f)).quickReply.items.find((x:{action:{label:string}})=>x.action.label==='เริ่มเรื่องใหม่');
 await send(f,button.action.data,true,false);const e=await send(f,'a new question',false,false);
 const message=(await pool.query('select conversation_id,ticket_id from public.messages where source_event_id=$1',[e.job.id])).rows[0];
 assert.notEqual(message.conversation_id,f.conversation);assert.equal(message.ticket_id,null);
 assert.doesNotMatch((await latestStudent(f)).text,/ข้อความนี้เป็นเรื่องใด/);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
});
test('an unassigned ticket alerts eligible bound staff once and a consumed selection cannot send duplicates',async()=>{
 const f=await fixture();await pool.query('update public.tickets set assigned_staff_id=null where id=$1',[f.ticket.id]);
 // Earlier cases retain their fixtures for evidence; retire only this suite's prior staff before testing an unassigned broadcast.
 await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])',[createdStaff.slice(0,-3)]);
 await send(f,'question');const prompt=await latestStudent(f),choice=prompt.quickReply.items.find((x:{action:{displayText:string}})=>x.action.displayText.startsWith('ต่อ '));assert(choice);
 await send(f,choice.action.data,true);await send(f,choice.action.data,true);
 const recipients=(await pool.query("select recipient_staff_id from private.message_outbox where ticket_id=$1 and channel='STAFF' order by recipient_staff_id",[f.ticket.id])).rows.map(r=>r.recipient_staff_id);
 assert(recipients.includes(f.staff));assert(recipients.includes(f.otherStaff));assert(!recipients.includes(f.unboundStaff));
 assert.equal(new Set(recipients).size,recipients.length,'EACH_RECIPIENT_HAS_ONLY_ONE_ALERT_AFTER_REPLAY');
 assert.match((await latestStudent(f)).text,/ถูกใช้แล้ว/);
});
