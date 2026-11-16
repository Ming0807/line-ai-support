import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob,type AIJob} from '../../lib/ai/jobs';
import {readAIKnowledgeSnapshot} from '../../lib/ai/knowledge-snapshot';
import {runAICycle,type AISnapshot} from '../../lib/ai/run-worker';
import {encryptValue,decryptValue,hashLineUserId} from '../../lib/security/identity';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {persistWebhookEvents} from '../../lib/queue/inbox';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import {createSupportProducer} from '../../lib/ai/support-producer';
import type {GenerateInput} from '../../lib/ai/gateway';
import type {KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import {greetingReply,GREETING_TOPICS} from '../../lib/conversation/input-hold';

// CONV-REAL (DEC-206): CONV-BURST-01 adaptive window, CONV-SUPERSEDE-01 carry unanswered input, CONV-GREET-01.
const database=process.env.YRU_OWNED_DATABASE;
assert.match(database??'',/^yru_owned_[a-f0-9]{12}$/u,'tests require the isolated owned database');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:6});
const sessions:string[]=[];
afterEach(async()=>{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
});
after(()=>pool.end());

async function fixture(){
 const key=randomBytes(32).toString('base64'),lineUser='U'+randomUUID().replaceAll('-',''),userHash=hashLineUserId(lineUser,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['CONVREAL_'+randomUUID()])).rows[0].id as string;
 sessions.push(session);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,userHash,encryptValue(lineUser,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id as string;
 const epoch=Date.now()-120_000;
 async function event(offset:number,hold:'NORMAL'|'EXTENDED'='NORMAL'){
  const id=(await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,received_at,completed_at,input_hold)
   values('STUDENT',$1,$2,$3,'MESSAGE','DONE',$4,clock_timestamp(),$5) returning id`,
  [randomUUID(),userHash,encryptValue('{}',key),new Date(epoch+offset),hold])).rows[0].id as string;
  // The AFTER trigger assigns the window, so RETURNING cannot see it.
  return (await pool.query('select id,received_at,input_window_id from private.webhook_inbox where id=$1',[id])).rows[0] as {id:string;received_at:Date;input_window_id:string};
 }
 async function message(text:string,offset:number){
  const source=await event(offset);
  const id=(await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,source_event_id,metadata,created_at)
   values($1,'USER','TEXT',$2,$3,$4,$5) returning id`,[conversation,text,source.id,{routing_status:'ROUTED',routing_route:'AI_EXISTING'},new Date(epoch+offset)])).rows[0].id as string;
  return {id,source};
 }
 async function aiReply(text:string,offset:number,status:'SENT'|'SUPPRESSED'|'DEAD'|'PROCESSING'){
  const jobId=randomUUID();
  await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,metadata,created_at) values($1,'AI','TEXT',$2,$3,$4)`,
   [conversation,text,{ai_job_id:jobId},new Date(epoch+offset)]);
  const outbox=await transaction(c=>enqueueOutbound(c,{idempotencyKey:'ai-job:'+jobId,channel:'STUDENT',kind:'AI',lineSessionId:session,
   conversationId:conversation,conversationRevision:0,messages:[{type:'text',text}]},key),pool);
  await pool.query(`update private.message_outbox set status=$2,completed_at=case when $2 in('SENT','SUPPRESSED','DEAD') then $3::timestamptz end,
   lease_token=case when $2='PROCESSING' then gen_random_uuid() end,lease_until=case when $2='PROCESSING' then clock_timestamp()+interval '60 seconds' end where id=$1`,
   [outbox,status,new Date(epoch+offset+500)]);
 }
 async function job(messageId:string){
  const id=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId,receivedAt:new Date()},key),pool);assert(id);
  return (await pool.query('select * from private.ai_jobs where id=$1',[id])).rows[0] as AIJob;
 }
 async function question(messageId:string){
  const prepared=await job(messageId);
  const snapshot=await transaction(c=>readAIKnowledgeSnapshot(c,prepared,key),pool);assert(snapshot);return snapshot;
 }
 return {key,session,conversation,epoch,userHash,event,message,aiReply,job,question};
}

const ms=(value:Date)=>value.getTime();
async function windowOf(id:string){
 return (await pool.query('select * from private.student_input_windows where id=$1',[id])).rows[0] as {first_received_at:Date;ready_at:Date;last_event_seq:string};
}

test('CONV-BURST-01: 2.5 s quiet gap, 8 s after an unfinished-looking fragment, 15 s cap per window',async()=>{
 const f=await fixture();
 const e1=await f.event(0);let w=await windowOf(e1.input_window_id);
 assert.equal(ms(w.ready_at)-ms(w.first_received_at),2500,'a normal fragment waits 2.5 s of quiet');
 const e2=await f.event(2000,'EXTENDED');assert.equal(e2.input_window_id,e1.input_window_id,'joins inside the quiet gap');
 w=await windowOf(e1.input_window_id);assert.equal(ms(w.ready_at)-ms(w.first_received_at),10000,'an unfinished-looking latest fragment waits 8 s');
 const e3=await f.event(9000);assert.equal(e3.input_window_id,e1.input_window_id,'a fragment 7 s after the opener still joins');
 w=await windowOf(e1.input_window_id);assert.equal(ms(w.ready_at)-ms(w.first_received_at),11500,'the gap returns to 2.5 s after a normal fragment');
 const e4=await f.event(11000,'EXTENDED');assert.equal(e4.input_window_id,e1.input_window_id);
 w=await windowOf(e1.input_window_id);assert.equal(ms(w.ready_at)-ms(w.first_received_at),15000,'the window never waits past 15 s');
 const e5=await f.event(14900);assert.equal(e5.input_window_id,e1.input_window_id);
 const e6=await f.event(15100);assert.notEqual(e6.input_window_id,e1.input_window_id,'input after the cap starts a new window');
 await assert.rejects(pool.query(`update private.student_input_windows set ready_at=first_received_at+interval '16 seconds' where id=$1`,[e1.input_window_id]),
  /student_input_windows_ready_cap|check constraint/u,'the database still bounds every window');
});

test('CONV-BURST-01: ingress persists the hold hint, defaulting to NORMAL; older events keep NORMAL',async()=>{
 const key=randomBytes(32).toString('base64'),userHash=hashLineUserId('U'+randomUUID().replaceAll('-',''),key);
 const ids=[randomUUID(),randomUUID()];
 await persistWebhookEvents([{channel:'STUDENT',eventId:ids[0],userHash,payloadEncrypted:encryptValue('{}',key),eventKind:'MESSAGE',inputHold:'EXTENDED'},
  {channel:'STUDENT',eventId:ids[1],userHash,payloadEncrypted:encryptValue('{}',key),eventKind:'MESSAGE'}],pool);
 const rows=(await pool.query(`select event_id,input_hold from private.webhook_inbox where channel='STUDENT' and event_id=any($1) order by event_seq`,[ids])).rows;
 assert.deepEqual(rows.map(r=>r.input_hold),['EXTENDED','NORMAL']);
 const column=(await pool.query(`select column_default,is_nullable from information_schema.columns where table_schema='private' and table_name='webhook_inbox' and column_name='input_hold'`)).rows[0];
 assert.match(column.column_default,/NORMAL/u);assert.equal(column.is_nullable,'NO');
 await assert.rejects(pool.query(`update private.webhook_inbox set input_hold='LONG' where channel='STUDENT' and event_id=$1`,[ids[0]]),/check constraint/u);
 await pool.query(`delete from private.webhook_inbox where channel='STUDENT' and event_id=any($1)`,[ids]);
 await pool.query('delete from private.student_input_windows where user_hash=$1',[userHash]);
});

test('CONV-SUPERSEDE-01: the new turn answers every unanswered message since the last delivered reply',async()=>{
 const f=await fixture();
 await f.message('สวัสดีครับ',0);
 const latest=await f.message('เทียบโอนยังไง',20_000);
 const snapshot=await f.question(latest.id);
 assert.equal(snapshot.question,'สวัสดีครับ\nเทียบโอนยังไง','an earlier unanswered fragment is part of the new question');
 assert.deepEqual(snapshot.history,[],'carried input is not repeated as history');
});

test('CONV-SUPERSEDE-01: a delivered reply ends carrying; a suppressed or dead reply does not',async()=>{
 const f=await fixture();
 await f.message('ลืมรหัสผ่าน',0);await f.aiReply('ตอบเรื่องรหัสผ่าน',3000,'SENT');
 await f.message('ค่าเทอมเท่าไหร่',10_000);await f.aiReply('คำตอบที่ถูกดึงกลับ',13_000,'SUPPRESSED');
 await f.message('ภาคปกติครับ',16_000);await f.aiReply('คำตอบที่ส่งไม่สำเร็จ',18_000,'DEAD');
 const latest=await f.message('ปี 1',25_000);
 const snapshot=await f.question(latest.id);
 assert.equal(snapshot.question,'ค่าเทอมเท่าไหร่\nภาคปกติครับ\nปี 1');
 assert.deepEqual(snapshot.history,[{role:'user',content:'ลืมรหัสผ่าน'},{role:'assistant',content:'ตอบเรื่องรหัสผ่าน'}]);
});

test('CONV-SUPERSEDE-01: an in-flight reply counts as answered; carrying is bounded to 10 minutes',async()=>{
 const f=await fixture();
 await f.message('คำถามเก่ามาก',-700_000);
 await f.message('คำถามที่กำลังส่งคำตอบ',0);await f.aiReply('คำตอบกำลังส่ง',2000,'PROCESSING');
 const latest=await f.message('ต่อจากนี้',10_000);
 assert.equal((await f.question(latest.id)).question,'ต่อจากนี้');
 const g=await fixture();
 await g.message('เกินสิบนาที',-610_000);
 const recent=await g.message('ถามใหม่',0);
 assert.equal((await g.question(recent.id)).question,'ถามใหม่','input older than ten minutes is history, not the question');
});

test('CONV-SUPERSEDE-01 race: input arriving during generation suppresses the old answer and the next job answers both',async()=>{
 const f=await fixture();
 const first=await f.message('สวัสดีครับ ขอถามเรื่องกยศ',0);await f.job(first.id);
 let second:{id:string}|undefined;const seen:string[]=[];
 const produce=async(snapshot:AISnapshot)=>{
  seen.push(snapshot.question);
  // Arrives during generation; its own quiet window is already due when the next job is claimed.
  if(!second)second=await f.message('ยื่นเอกสารที่ไหนครับ',Date.now()-f.epoch-5000);
  return {kind:'CLARIFY' as const,text:'คำตอบสำหรับ: '+snapshot.question.replace(/\n/gu,' / ')};
 };
 const firstRun=await runAICycle(pool,f.key,{produce});
 assert.deepEqual(firstRun,{claimed:1,completed:0,suppressed:1,failed:0},'the stale answer is fenced before any outbox row');
 assert.equal((await pool.query(`select count(*)::int n from private.message_outbox where conversation_id=$1`,[f.conversation])).rows[0].n,0);
 assert(second);await f.job(second.id);
 const secondRun=await runAICycle(pool,f.key,{produce});
 assert.deepEqual(secondRun,{claimed:1,completed:1,suppressed:0,failed:0});
 assert.deepEqual(seen,['สวัสดีครับ ขอถามเรื่องกยศ','สวัสดีครับ ขอถามเรื่องกยศ\nยื่นเอกสารที่ไหนครับ']);
 const rows=(await pool.query(`select payload_encrypted from private.message_outbox where conversation_id=$1`,[f.conversation])).rows;
 assert.equal(rows.length,1,'exactly one answer is queued');
 assert.match(JSON.parse(decryptValue(rows[0].payload_encrypted,f.key)).messages[0].text,/กยศ \/ ยื่นเอกสาร/u);
});

test('CONV-SUPERSEDE-01 race: concurrent job preparation leaves one pending job for the latest input',async()=>{
 const f=await fixture();
 const messages=[await f.message('หนึ่ง',0),await f.message('สอง',500),await f.message('สาม',1000)];
 await Promise.all(messages.map(m=>transaction(c=>prepareAIJob(c,{sessionId:f.session,conversationId:f.conversation,messageId:m.id,receivedAt:new Date()},f.key),pool)));
 const jobs=(await pool.query(`select message_id,status from private.ai_jobs where conversation_id=$1`,[f.conversation])).rows;
 assert.equal(jobs.filter(j=>j.status==='PENDING').length,1);
 assert.equal(jobs.find(j=>j.status==='PENDING')?.message_id,messages[2].id);
});

test('CONV-GREET-01: a greeting-only turn is answered without a model call, with three topic buttons',async()=>{
 const f=await fixture();
 const hello=await f.message('สวัสดีครับ',0);await f.job(hello.id);
 let calls=0;
 const result=await runAICycle(pool,f.key,{produce:async()=>{calls++;throw new Error('MODEL_MUST_NOT_BE_CALLED');}});
 assert.deepEqual(result,{claimed:1,completed:1,suppressed:0,failed:0});assert.equal(calls,0);
 const outbox=(await pool.query(`select payload_encrypted from private.message_outbox where conversation_id=$1`,[f.conversation])).rows;
 assert.equal(outbox.length,1);
 const payload=JSON.parse(decryptValue(outbox[0].payload_encrypted,f.key));
 assert.equal(payload.messages.length,1);assert.equal(payload.messages[0].text,greetingReply('GREETING').text);
 assert.deepEqual(payload.messages[0].quickReply.items.map((i:{action:unknown})=>i.action),GREETING_TOPICS.map(label=>({type:'message',label,text:label})));
 const stored=(await pool.query(`select content from public.messages where conversation_id=$1 and sender_type='AI'`,[f.conversation])).rows;
 assert.deepEqual(stored.map(r=>r.content),[greetingReply('GREETING').text]);
});

test('CONV-GREET-01: thanks gets a fixed reply; a greeting plus a question still goes to the model',async()=>{
 const f=await fixture();
 const thanks=await f.message('ขอบคุณครับ 🙏',0);await f.job(thanks.id);
 assert.deepEqual(await runAICycle(pool,f.key,{produce:async()=>{throw new Error('MODEL_MUST_NOT_BE_CALLED');}}),{claimed:1,completed:1,suppressed:0,failed:0});
 const thanksPayload=JSON.parse(decryptValue((await pool.query(`select payload_encrypted from private.message_outbox where conversation_id=$1`,[f.conversation])).rows[0].payload_encrypted,f.key));
 assert.equal(thanksPayload.messages[0].text,greetingReply('THANKS').text);assert.equal(thanksPayload.messages[0].quickReply,undefined);
 const g=await fixture();
 const mixed=await g.message('สวัสดีครับ เทียบโอนยังไง',0);await g.job(mixed.id);
 let calls=0;
 await runAICycle(pool,g.key,{produce:async()=>{calls++;return {kind:'CLARIFY',text:'ถามต่อ'};}});
 assert.equal(calls,1,'a turn with content always reaches the normal flow');
});

test('CONV-BURST-01: loading starts once when a new window opens with an AI job, outside SQL, and never for later fragments',async()=>{
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(userId,key);
 const calls:{url:string;body:unknown}[]=[];
 const fetchImpl:typeof fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});return new Response(null,{status:202});};
 const send=async(text:string)=>{
  const event={type:'message',replyToken:'r'.repeat(32),source:{type:'user',userId},message:{type:'text',id:randomUUID(),text}};
  await persistWebhookEvents([{channel:'STUDENT',eventId:randomUUID(),userHash,payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE',inputHold:'EXTENDED'}],pool);
  return runInboxCycle(pool,key,{aiEnabled:true,loading:{accessToken:'test-token',fetchImpl}});
 };
 try{
  assert.deepEqual(await send('สวัสดีครับ'),{claimed:1,completed:1,failed:0});
  assert.equal(calls.length,1,'the first fragment of a window starts the loading animation');
  assert.equal(calls[0].url,'https://api.line.me/v2/bot/chat/loading/start');
  assert.deepEqual(calls[0].body,{chatId:userId,loadingSeconds:20});
  await send('ขอถามเรื่องเทียบโอน');
  assert.equal(calls.length,1,'a later fragment in the same open window does not restart it');
  assert.deepEqual(await runInboxCycle(pool,key,{aiEnabled:true}),{claimed:0,completed:0,failed:0},'without a token nothing is sent');
 }finally{
  const session=(await pool.query('select line_session_id from private.line_identities where user_hash=$1',[userHash])).rows[0]?.line_session_id as string|undefined;
  if(session){
   await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=$1 and status in('PENDING','PROCESSING')",[session]);
   sessions.push(session);
  }
 }
});

test('CONV-GREET-02: a greeting never asks which topic and never calls the routing model, even with many open topics',async()=>{
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(userId,key);
 const send=async(text:string,classify:Parameters<typeof runInboxCycle>[2] extends infer O?O extends {classify?:infer C}?C:never:never)=>{
  const event={type:'message',replyToken:'r'.repeat(32),source:{type:'user',userId},message:{type:'text',id:randomUUID(),text}};
  await persistWebhookEvents([{channel:'STUDENT',eventId:randomUUID(),userHash,payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE'}],pool);
  return runInboxCycle(pool,key,{aiEnabled:true,classify});
 };
 const newTopic=async()=>({decision:'NEW' as const,candidateCode:null,confidence:.99});
 const noModel=async()=>{throw new Error('ROUTING_MODEL_MUST_NOT_BE_CALLED');};
 const session=async()=>(await pool.query('select line_session_id from private.line_identities where user_hash=$1',[userHash])).rows[0]?.line_session_id as string;
 try{
  assert.deepEqual(await send('สวัสดีครับ',noModel),{claimed:1,completed:1,failed:0},'first greeting without any topic');
  const sid=await session();sessions.push(sid);
  await send('ค่าเทอมเท่าไหร่',newTopic);await send('wifi เข้าไม่ได้',newTopic);
  const conversations=(await pool.query(`select c.id,(select max(m.created_at) from public.messages m where m.conversation_id=c.id) last_at
   from public.conversations c where c.line_session_id=$1 and c.conversation_type<>'SUPPORT' order by last_at desc`,[sid])).rows;
  assert(conversations.length>=2,'several open topics exist');
  assert.deepEqual(await send('หวัดดีค่ะ',noModel),{claimed:1,completed:1,failed:0});
  const routed=(await pool.query(`select m.conversation_id,m.metadata from public.messages m join public.conversations c on c.id=m.conversation_id
   where c.line_session_id=$1 and m.content='หวัดดีค่ะ'`,[sid])).rows[0];
  assert.equal(routed.metadata.routing_status,'ROUTED','the greeting is routed, not left pending');
  assert.equal(routed.conversation_id,conversations[0].id,'it continues the most recently active topic');
  const asks=(await pool.query(`select payload_encrypted from private.message_outbox where line_session_id=$1 and kind='SYSTEM'`,[sid])).rows
   .map(r=>JSON.parse(decryptValue(r.payload_encrypted,key)).messages[0].text as string);
  assert(!asks.some(text=>text.includes('เป็นเรื่องใด')),'no topic question is sent for a greeting');
  const job=(await pool.query(`select j.id from private.ai_jobs j join public.messages m on m.id=j.message_id where m.content='หวัดดีค่ะ' and j.line_session_id=$1`,[sid])).rows[0];
  assert(job,'the greeting gets an AI job that the fixed-reply path answers');
 }finally{
  const sid=await session();
  if(sid)await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=$1 and status in('PENDING','PROCESSING')",[sid]);
 }
});

// NATURAL-ROUTE-01 (DEC-209): typing alone is always enough. Uncertain routing continues the most recently active AI
// conversation; no topic list, no idle-case buttons, no "เริ่มเรื่องใหม่" button.
async function studentChat(){
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(userId,key);
 type Classify=NonNullable<Parameters<typeof runInboxCycle>[2]>['classify'];
 const send=async(text:string,classify?:Classify)=>{
  const event={type:'message',replyToken:'r'.repeat(32),source:{type:'user',userId},message:{type:'text',id:randomUUID(),text}};
  await persistWebhookEvents([{channel:'STUDENT',eventId:randomUUID(),userHash,payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE'}],pool);
  const result=await runInboxCycle(pool,key,{aiEnabled:true,...(classify?{classify}:{})});
  assert.deepEqual(result,{claimed:1,completed:1,failed:0},text);
 };
 await send('สวัสดีครับ');
 const sid=(await pool.query('select line_session_id from private.line_identities where user_hash=$1',[userHash])).rows[0].line_session_id as string;sessions.push(sid);
 const message=async(text:string)=>(await pool.query(`select m.id,m.conversation_id,m.ticket_id,m.metadata from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.content=$2 order by m.created_at desc limit 1`,[sid,text])).rows[0];
 const systemTexts=async()=>(await pool.query(`select payload_encrypted from private.message_outbox where line_session_id=$1 and kind='SYSTEM' order by created_at`,[sid])).rows
  .map(r=>JSON.parse(decryptValue(r.payload_encrypted,key)).messages[0] as {text:string;quickReply?:{items:{action:{label:string}}[]}});
 const jobFor=async(messageId:string)=>(await pool.query(`select id,request_encrypted from private.ai_jobs where message_id=$1`,[messageId])).rows[0];
 const latestAI=async()=>(await pool.query(`select c.id from public.conversations c where c.line_session_id=$1 and c.mode='AI' and c.conversation_type<>'SUPPORT'
  order by (select max(m.created_at) from public.messages m where m.conversation_id=c.id) desc nulls last limit 1`,[sid])).rows[0]?.id as string;
 return {key,sid,userHash,send,message,systemTexts,jobFor,latestAI};
}
const newTopic=async()=>({decision:'NEW' as const,candidateCode:null,confidence:.99});

test('NATURAL-ROUTE-01: an unsure or unavailable routing model never sends a topic list; the latest AI topic continues',async()=>{
 const c=await studentChat();
 await c.send('ค่าเทอมเท่าไหร่',newTopic);await c.send('wifi เข้าไม่ได้',newTopic);
 const latest=await c.latestAI();
 await c.send('แล้วต้องทำยังไงต่อ',async()=>({decision:'ASK',candidateCode:null,confidence:.4}));
 const unsure=await c.message('แล้วต้องทำยังไงต่อ');
 assert.equal(unsure.metadata.routing_status,'ROUTED');assert.equal(unsure.conversation_id,latest,'an unsure message continues the most recently active AI topic');
 assert(await c.jobFor(unsure.id),'the AI answers it');
 await c.send('ขอเบอร์ติดต่อหน่อย',async()=>{throw new Error('MODEL_DOWN');});
 const down=await c.message('ขอเบอร์ติดต่อหน่อย');
 assert.equal(down.metadata.routing_status,'ROUTED','a routing outage does not leave the Student waiting for a choice');
 assert(await c.jobFor(down.id));
 const texts=await c.systemTexts();
 assert(!texts.some(t=>/เป็นเรื่องใด|ไม่พร้อมเชื่อมต่อเรื่อง/u.test(t.text)),'no topic list is sent');
 const request=JSON.parse(decryptValue((await c.jobFor(unsure.id)).request_encrypted,c.key));
 const labels=(request.quickReply?.items??[]).map((i:{action:{label:string}})=>i.action.label);
 assert(!labels.includes('เริ่มเรื่องใหม่'),'no new-topic button on AI answers');
});

test('NATURAL-ROUTE-01: a question near a staff case idle over 24 hours is answered by the AI with a note about the case',async()=>{
 const c=await studentChat();
 const department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id as string;
 const conv=(await pool.query(`insert into public.conversations(line_session_id,conversation_type,mode,status,topic) values($1,'TICKET','HUMAN','ACTIVE','เทียบโอนวิชาอังกฤษ') returning id`,[c.sid])).rows[0].id as string;
 const ticket=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,$3,'เทียบโอนวิชาอังกฤษไม่ได้','HUMAN','STAFF_HANDLING') returning id,ticket_no`,[c.sid,conv,department])).rows[0];
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conv,ticket.id]);
 await pool.query(`insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,created_at) values($1,$2,'USER','TEXT','เทียบโอนวิชาอังกฤษไม่ได้',now()-interval '19 days')`,[conv,ticket.id]);
 const pickHuman=async(input:{contexts:{code:string;mode:string}[]})=>({decision:'CONTINUE' as const,candidateCode:input.contexts.find(x=>x.mode==='HUMAN')!.code,confidence:.97});
 await c.send('เทียบโอนยังไง',pickHuman);
 const routed=await c.message('เทียบโอนยังไง');
 assert.equal(routed.metadata.routing_status,'ROUTED');assert.equal(routed.ticket_id,null,'not filed into the idle staff case');
 assert.notEqual(routed.conversation_id,conv);
 assert(!(await c.systemTexts()).some(t=>t.quickReply),'no buttons are required');
 assert.equal((await pool.query(`select count(*)::int n from private.message_outbox where ticket_id=$1 and channel='STAFF'`,[ticket.id])).rows[0].n,0,'Staff is not notified');
 await pool.query(`update private.student_input_windows set first_received_at=now()-interval '20 seconds',last_received_at=now()-interval '15 seconds',ready_at=now()-interval '10 seconds' where user_hash=$1 and sealed_at is null`,[c.userHash]);
 for(let i=0;i<5;i++)if(!(await runAICycle(pool,c.key,{produce:async()=>({kind:'CLARIFY',text:'คำตอบเรื่องเทียบโอน'})})).claimed)break;
 const answer=(await pool.query(`select payload_encrypted from private.message_outbox o join private.ai_jobs j on o.idempotency_key='ai-job:'||j.id::text where j.message_id=$1`,[routed.id])).rows[0];
 const text=JSON.parse(decryptValue(answer.payload_encrypted,c.key)).messages.map((m:{text:string})=>m.text).join('\n');
 assert.match(text,/คำตอบเรื่องเทียบโอน/u);
 assert(text.includes(ticket.ticket_no)&&text.includes('เจ้าหน้าที่'),'the answer mentions the open staff case');
 // A recently active staff case still receives a message the router assigns to it.
 await pool.query(`update public.messages set created_at=now()-interval '1 hour' where conversation_id=$1`,[conv]);
 await c.send('ส่งเอกสารเพิ่มแล้วครับ',pickHuman);
 assert.equal((await c.message('ส่งเอกสารเพิ่มแล้วครับ')).ticket_id,ticket.id);
});

test('NATURAL-ROUTE-01: messages left waiting by an earlier topic question are carried into the next routed message',async()=>{
 const c=await studentChat();
 await c.send('ค่าเทอมเท่าไหร่',newTopic);
 const support=(await pool.query(`insert into public.conversations(line_session_id,conversation_type) values($1,'SUPPORT') returning id`,[c.sid])).rows[0].id as string;
 await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,metadata,created_at) values($1,'USER','TEXT','คำถามที่ค้างจากปุ่มเก่า','{"routing_status":"PENDING","routing_route":"ASK_CONTEXT"}'::jsonb,now()-interval '2 minutes')`,[support]);
 await c.send('ภาคพิเศษล่ะ',newTopic);
 const waiting=await c.message('คำถามที่ค้างจากปุ่มเก่า'),next=await c.message('ภาคพิเศษล่ะ');
 assert.equal(waiting.metadata.routing_status,'ROUTED');assert.equal(waiting.conversation_id,next.conversation_id);
});

test('CONV-GREET-01 via the real inbox: the greeting keeps its three topic buttons next to the contact shortcut',async()=>{
 const c=await studentChat();
 await pool.query(`update private.student_input_windows set first_received_at=now()-interval '20 seconds',last_received_at=now()-interval '15 seconds',ready_at=now()-interval '10 seconds' where user_hash=$1 and sealed_at is null`,[c.userHash]);
 for(let i=0;i<5;i++)if(!(await runAICycle(pool,c.key,{produce:async()=>{throw new Error('MODEL_MUST_NOT_BE_CALLED');}})).claimed)break;
 const row=(await pool.query(`select o.payload_encrypted from private.message_outbox o where o.line_session_id=$1 and o.kind='AI'`,[c.sid])).rows[0];
 const last=JSON.parse(decryptValue(row.payload_encrypted,c.key)).messages.at(-1);
 assert.equal(last.text,greetingReply('GREETING').text);
 const labels=last.quickReply.items.map((i:{action:{label:string}})=>i.action.label);
 assert.deepEqual(labels.slice(0,3),[...GREETING_TOPICS]);
 assert(labels.length<=13);
});

// NATURAL-ESCALATE-01 (DEC-209): when the AI cannot help, it opens the case itself and tells the Student; when the
// department is unclear it asks in words (no buttons), and the Student's typed answer completes the hand-over.
function supportModel(proposals:Record<string,unknown>[]){
 let turn=0;
 const generate:KnowledgeProducerOptions['generate']=async<T>(input:GenerateInput<T>)=>{
  if(input.taskType!=='SUPPORT_INTENT')throw new Error(`UNEXPECTED_TASK:${input.taskType}`);
  const proposal=proposals[Math.min(turn++,proposals.length-1)];
  return {output:input.responseSchema.parse(proposal),toolCalls:[],providerId:'00000000-0000-4000-8000-000000000001',modelId:'00000000-0000-4000-8000-000000000002',fallbackUsed:false};
 };
 return createSupportProducer({generate,embed:async()=>{throw new Error('NO_EMBED');},search:async()=>{throw new Error('NO_SEARCH');}});
}
const proposal=(intent:'ESCALATE'|'PERSONAL_CASE',department:string|null,quote:string)=>({intent,category:department?({FINANCE:'FINANCE',REGISTRAR:'REGISTRATION',IT:'IT_SUPPORT'} as Record<string,string>)[department]:'GENERAL',
 subcategory:null,needsTicket:true,department,urgency:'medium',needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,confidence:.95,
 missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U0',quote}]});
async function answerTurn(c:Awaited<ReturnType<typeof studentChat>>,produce:ReturnType<typeof supportModel>){
 await pool.query(`update private.student_input_windows set first_received_at=now()-interval '20 seconds',last_received_at=now()-interval '15 seconds',ready_at=now()-interval '10 seconds' where user_hash=$1 and sealed_at is null`,[c.userHash]);
 for(let i=0;i<6;i++)if(!(await runAICycle(pool,c.key,{supportEnabled:true,produce})).claimed)break;
}
async function studentMessages(c:Awaited<ReturnType<typeof studentChat>>){
 return (await pool.query(`select kind,status,payload_encrypted from private.message_outbox where line_session_id=$1 and channel='STUDENT' order by created_at,id`,[c.sid])).rows
  .filter(r=>r.status!=='SUPPRESSED').map(r=>({kind:r.kind as string,...JSON.parse(decryptValue(r.payload_encrypted,c.key)).messages.at(-1)})) as {kind:string;text:string;quickReply?:{items:{action:{label:string}}[]}}[];
}
const openTicket=async(sid:string)=>(await pool.query(`select t.id,t.ticket_no,t.mode,t.status,d.code from public.tickets t join public.departments d on d.id=t.department_id
 where t.line_session_id=$1 and t.status not in('CLOSED','CANCELLED','RESOLVED') order by t.created_at desc limit 1`,[sid])).rows[0];

test('NATURAL-ESCALATE-01: the AI opens the case itself and tells the Student the department and case number',async()=>{
 const c=await studentChat();await answerTurn(c,supportModel([proposal('ESCALATE',null,'สวัสดีครับ')]));
 const text='ขอคุยกับเจ้าหน้าที่ เรื่องค่าเทอมจ่ายเกิน';
 await c.send(text);await answerTurn(c,supportModel([proposal('ESCALATE','FINANCE','ค่าเทอมจ่ายเกิน')]));
 const ticket=await openTicket(c.sid);
 assert(ticket,'a case is opened without any button');
 assert.equal(ticket.code,'FINANCE');assert.equal(ticket.mode,'HUMAN');
 const last=(await studentMessages(c)).at(-1)!;
 assert.match(last.text,new RegExp(`${ticket.ticket_no}`,'u'));assert.match(last.text,/การเงิน/u);assert.match(last.text,/แชตนี้/u);
 assert.equal(last.quickReply,undefined,'no confirmation button');
 const source=await c.message(text);
 const outcome=(await pool.query(`select kind,ticket_id,confirmation_event_id from private.ai_support_outcomes where conversation_id=$1`,[source.conversation_id])).rows[0];
 assert.deepEqual([outcome?.kind,outcome?.ticket_id],['AI_ESCALATED',ticket.id]);
 const event=(await pool.query(`select m.source_event_id from public.messages m where m.id=$1`,[source.id])).rows[0];
 assert.equal(outcome.confirmation_event_id,event.source_event_id,'the Student\'s own LINE message is the verified trigger');
});

test('NATURAL-ESCALATE-01: an unclear department is asked in words once; the typed answer opens the case',async()=>{
 const c=await studentChat();
 await c.send('ช่วยส่งเรื่องให้เจ้าหน้าที่หน่อยครับ');
 await answerTurn(c,supportModel([proposal('ESCALATE',null,'ส่งเรื่องให้เจ้าหน้าที่')]));
 assert.equal(await openTicket(c.sid),undefined,'no case without a department');
 const ask=(await studentMessages(c)).at(-1)!;
 assert.match(ask.text,/งานไหน|หน่วยงานไหน/u);assert.match(ask.text,/การเงิน/u);assert.match(ask.text,/ทะเบียน/u);
 assert(!(ask.quickReply?.items??[]).some(i=>/ส่งต่อ|เลือกหน่วยงาน/u.test(i.action.label)),'the department question needs no button');
 await c.send('การเงินครับ');
 // Even if the model still cannot name it, the typed department name is enough.
 await answerTurn(c,supportModel([proposal('ESCALATE',null,'การเงิน')]));
 const ticket=await openTicket(c.sid);
 assert.equal(ticket?.code,'FINANCE');
 assert.match((await studentMessages(c)).at(-1)!.text,new RegExp(ticket.ticket_no,'u'));
});

test('NATURAL-ESCALATE-01: a personal-record question is handed over with a short reason',async()=>{
 const c=await studentChat();
 await c.send('เกรดเทอมนี้ผมได้เท่าไหร่ครับ');
 await answerTurn(c,supportModel([proposal('PERSONAL_CASE','REGISTRAR','เกรดเทอมนี้')]));
 const ticket=await openTicket(c.sid);
 assert.equal(ticket?.code,'REGISTRAR');
 const last=(await studentMessages(c)).at(-1)!;
 assert.match(last.text,/ข้อมูล/u);assert.match(last.text,new RegExp(ticket.ticket_no,'u'));
});
