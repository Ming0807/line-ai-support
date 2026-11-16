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

test('CONV-STALE-HUMAN-01: a new question is not filed silently into a staff case idle for over 24 hours; the Student chooses',async()=>{
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(userId,key);
 const send=async(text:string,classify?:Parameters<typeof runInboxCycle>[2] extends infer O?O extends {classify?:infer C}?C:never:never)=>{
  const event={type:'message',replyToken:'r'.repeat(32),source:{type:'user',userId},message:{type:'text',id:randomUUID(),text}};
  await persistWebhookEvents([{channel:'STUDENT',eventId:randomUUID(),userHash,payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE'}],pool);
  return runInboxCycle(pool,key,{aiEnabled:true,...(classify?{classify}:{})});
 };
 await send('สวัสดีครับ');
 const sid=(await pool.query('select line_session_id from private.line_identities where user_hash=$1',[userHash])).rows[0].line_session_id as string;sessions.push(sid);
 const department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id as string;
 async function humanCase(idleHours:number){
  const conv=(await pool.query(`insert into public.conversations(line_session_id,conversation_type,mode,status,topic) values($1,'TICKET','HUMAN','ACTIVE','เทียบโอนวิชาอังกฤษ') returning id`,[sid])).rows[0].id as string;
  const ticket=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,$3,'เทียบโอนวิชาอังกฤษไม่ได้','HUMAN','STAFF_HANDLING') returning id,ticket_no`,[sid,conv,department])).rows[0];
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conv,ticket.id]);
  await pool.query(`insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,created_at) values($1,$2,'USER','TEXT','เทียบโอนวิชาอังกฤษไม่ได้',now()-make_interval(hours=>$3))`,[conv,ticket.id,idleHours]);
  return {conv,ticketId:ticket.id as string,ticketNo:ticket.ticket_no as string};
 }
 const pickHuman=async(input:{contexts:{code:string;mode:string}[]})=>({decision:'CONTINUE' as const,candidateCode:input.contexts.filter(c=>c.mode==='HUMAN').at(-1)!.code,confidence:.97});
 const old=await humanCase(19*24);
 assert.deepEqual(await send('เทียบโอนยังไง',pickHuman),{claimed:1,completed:1,failed:0});
 const stored=(await pool.query(`select m.conversation_id,m.ticket_id,m.metadata from public.messages m join public.conversations c on c.id=m.conversation_id where c.line_session_id=$1 and m.content='เทียบโอนยังไง'`,[sid])).rows[0];
 assert.equal(stored.metadata.routing_status,'PENDING','the question waits for the Student\'s choice');
 assert.equal(stored.ticket_id,null,'it is not attached to the old staff case');
 const replies=(await pool.query(`select kind,channel,payload_encrypted from private.message_outbox where (line_session_id=$1 or channel='STAFF') and created_at>now()-interval '1 minute' order by created_at`,[sid])).rows;
 assert(!replies.some(r=>r.channel==='STAFF'),'Staff is not notified about a message the Student did not send to the case');
 const last=JSON.parse(decryptValue(replies.at(-1)!.payload_encrypted,key)).messages[0];
 assert.match(last.text,new RegExp(old.ticketNo,'u'));
 assert.deepEqual(last.quickReply.items.map((i:{action:{label:string}})=>i.action.label),['ถามเป็นเรื่องใหม่',`ต่อ ${old.ticketNo}`]);
 // Real students rarely tap the button: the next message is not asked again; both go to the AI as one question.
 const seen:string[]=[];
 assert.deepEqual(await send('ต้องใช้เอกสารอะไรบ้าง',pickHuman),{claimed:1,completed:1,failed:0});
 const asksAfter=(await pool.query(`select payload_encrypted from private.message_outbox where line_session_id=$1 and kind='SYSTEM'`,[sid])).rows
  .map(r=>JSON.parse(decryptValue(r.payload_encrypted,key)).messages[0].text as string).filter(t=>t.includes(old.ticketNo));
 assert.equal(asksAfter.length,1,'the Student is asked only once');
 const moved=(await pool.query(`select m.content,m.metadata->>'routing_status' rs,m.conversation_id,m.ticket_id from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.content in('เทียบโอนยังไง','ต้องใช้เอกสารอะไรบ้าง') order by m.created_at`,[sid])).rows;
 assert.deepEqual(moved.map(m=>[m.rs,m.ticket_id]),[['ROUTED',null],['ROUTED',null]]);
 assert.equal(moved[0].conversation_id,moved[1].conversation_id,'the waiting question joins the new AI conversation');
 await pool.query(`update private.student_input_windows set first_received_at=now()-interval '20 seconds',last_received_at=now()-interval '15 seconds',ready_at=now()-interval '10 seconds' where user_hash=$1 and sealed_at is null`,[userHash]);
 for(let i=0;i<5;i++)if(!(await runAICycle(pool,key,{produce:async snapshot=>{seen.push(snapshot.question);return {kind:'CLARIFY',text:'ตอบ'};}})).claimed)break;
 assert.deepEqual(seen,['เทียบโอนยังไง\nต้องใช้เอกสารอะไรบ้าง'],'one answer covers the waiting question too');
 // An active staff conversation keeps the existing behaviour.
 const fresh=await humanCase(1);
 assert.deepEqual(await send('ส่งเอกสารเพิ่มแล้วครับ',pickHuman),{claimed:1,completed:1,failed:0});
 const attached=(await pool.query(`select ticket_id,metadata from public.messages where content='ส่งเอกสารเพิ่มแล้วครับ' and conversation_id=$1`,[fresh.conv])).rows[0];
 assert.equal(attached?.ticket_id,fresh.ticketId,'a recently active staff case still receives the message');
});
