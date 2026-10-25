import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {encryptValue,decryptValue,hashLineUserId} from '../../lib/security/identity';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import {loadCandidates} from '../../lib/conversation/context-resolver';
import {readExplicitHumanFocus} from '../../lib/conversation/explicit-focus';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const key=Buffer.alloc(32,73).toString('base64');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4});
const sessions:string[]=[],hashes:string[]=[];
after(async()=>{try{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where user_hash=any($1::text[]) and status in('PENDING','PROCESSING')",[hashes]);
 }finally{await pool.end();}});
async function eventFor(userId:string,text:string,options:{postback?:string;messageId?:string}={}){
 const hash=hashLineUserId(userId,key);
 const event=options.postback?{type:'postback',source:{type:'user',userId},postback:{data:options.postback}}:
  {type:'message',source:{type:'user',userId},message:{type:'text',id:options.messageId??randomUUID(),text}};
 return (await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts)
  values('STUDENT',$1,$2,$3,$4,'PROCESSING',$5,clock_timestamp()+interval '30 seconds',1) returning *`,
 [randomUUID(),hash,encryptValue(JSON.stringify(event),key),options.postback?'OTHER':'MESSAGE',randomUUID()])).rows[0] as InboxJob;
}
const apply=(job:InboxJob,advice?:NonNullable<Awaited<ReturnType<typeof classifyStudentInboxContext>>>)=>transaction(c=>processInboxEvent(c,job,key,{aiEnabled:true,routingAdvice:advice}),pool);
async function fixture(question='ล็อกอิน Wi-Fi อย่างไรครับ'){
 const userId='U'+randomUUID().replaceAll('-',''),hash=hashLineUserId(userId,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['TYPED_'+randomUUID()])).rows[0].id;
 sessions.push(session);hashes.push(hash);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hash,encryptValue(userId,key)]);
 const human=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,(select id from public.departments where code='REGISTRAR'),'ลงทะเบียนไม่ได้','HUMAN','STAFF_HANDLING') returning id,ticket_no",[session,human])).rows[0];
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[human,ticket.id]);
 const ai=(await pool.query('insert into public.conversations(line_session_id,topic) values($1,$2) returning id',[session,'ห้องสมุด'])).rows[0].id;
 const job=await eventFor(userId,question);await apply(job);
 const source=(await pool.query('select * from public.messages where source_event_id=$1',[job.id])).rows[0];
 assert.equal(source.metadata.routing_status,'PENDING');
 return {userId,hash,session,human,ticket,ai,source,question};
}
async function explicit(f:Awaited<ReturnType<typeof fixture>>,text:string,options:{postback?:string;messageId?:string;proposal?:'NEW'|'CONTINUE'}={}){
 const job=await eventFor(f.userId,text,options);let calls=0;
 const advice=await classifyStudentInboxContext(pool,job,key,async()=>{calls++;return {decision:options.proposal??'ASK',candidateCode:options.proposal==='CONTINUE'?'C1':null,confidence:1};});
 await apply(job,advice??undefined);return {job,calls};
}
const aiJobs=async(session:string)=>(await pool.query('select * from private.ai_jobs where line_session_id=$1',[session])).rows;
const sourceNow=async(id:string)=>(await pool.query('select * from public.messages where id=$1',[id])).rows[0];

test('typed NEW consumes the offered prompt without model HTTP and queues the complete original question once',async()=>{
 const f=await fixture('ต้นคำถาม '+ 'รายละเอียด'.repeat(450)+' ท้ายคำถาม');
 const result=await explicit(f,'เริ่มเรื่องใหม่');assert.equal(result.calls,0);
 const jobs=await aiJobs(f.session);assert.equal(jobs.length,1);assert.equal(jobs[0].message_id,f.source.id);
 const source=await sourceNow(f.source.id);assert.equal(source.content,f.question);assert.equal(source.metadata.routing_status,'ROUTED');
 assert.equal(source.metadata.routing_route,'AI_NEW');
 assert.notEqual(source.conversation_id,f.source.conversation_id);assert.notEqual(source.conversation_id,f.human);
 const control=(await pool.query('select content,conversation_id,metadata from public.messages where source_event_id=$1',[result.job.id])).rows[0];
 assert.equal(control.content,'เริ่มเรื่องใหม่');assert.equal(control.conversation_id,f.source.conversation_id);assert.equal(control.metadata.routing_status,'ROUTE_CONTROL');
 assert.equal((await pool.query('select count(*)::int n from private.pending_route_choices where pending_message_id=$1 and consumed_at is null',[f.source.id])).rows[0].n,0);
});
test('typed unique AI continuation queues the original source in exactly the offered conversation',async()=>{
 const f=await fixture();const result=await explicit(f,'ต่อ เรื่อง 2');assert.equal(result.calls,0);
 const jobs=await aiJobs(f.session);assert.equal(jobs.length,1);assert.equal(jobs[0].message_id,f.source.id);assert.equal(jobs[0].conversation_id,f.ai);
 assert.equal((await sourceNow(f.source.id)).content,f.question);
 assert.equal((await sourceNow(f.source.id)).metadata.routing_route,'AI_EXISTING');
});

test('a reordered numbered offer cannot retarget the pending question into another owned HUMAN case',async()=>{
 const f=await fixture();
 await pool.query("update public.conversations set created_at=created_at-interval '1 day' where id=$1",[f.ai]);
 const result=await explicit(f,'ต่อ เรื่อง 2');assert.equal(result.calls,0);
 assert.equal((await aiJobs(f.session)).length,0);assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
 assert.equal((await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.ticket.id])).rows[0].n,0);
});

test('stale numbered re-prompt supersedes only its owned offer so typed NEW can route the original source once',async()=>{
 const f=await fixture(),other=await fixture();
 const original=(await pool.query('select token_hash from private.pending_route_choices where pending_message_id=$1 and consumed_at is null',[f.source.id])).rows;
 await pool.query("update public.conversations set created_at=created_at-interval '1 day' where id=$1",[f.ai]);
 const stale=await explicit(f,'ต่อ เรื่อง 2');assert.equal(stale.calls,0);
 assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
 assert.equal((await pool.query('select count(*)::int n from private.pending_route_choices where token_hash=any($1::text[]) and consumed_at is null',[original.map(r=>r.token_hash)])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.pending_route_choices where pending_message_id=$1 and consumed_at is null',[f.source.id])).rows[0].n,3);
 assert.equal((await pool.query('select count(*)::int n from private.pending_route_choices where pending_message_id=$1 and consumed_at is null',[other.source.id])).rows[0].n,3);
 const next=await explicit(f,'เริ่มเรื่องใหม่');assert.equal(next.calls,0);
 const jobs=await aiJobs(f.session);assert.equal(jobs.length,1);assert.equal(jobs[0].message_id,f.source.id);
 assert.equal((await sourceNow(f.source.id)).content,f.question);assert.equal((await sourceNow(f.source.id)).metadata.routing_route,'AI_NEW');
 await explicit(f,'เริ่มเรื่องใหม่');assert.equal((await aiJobs(f.session)).length,1);
 assert.equal((await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.ticket.id])).rows[0].n,0);
});

test('legacy generic AI text still consumes a unique named AI offer without model HTTP',async()=>{
 const f=await fixture();const result=await explicit(f,'ต่อ เรื่องที่กำลังคุย');assert.equal(result.calls,0);
 const jobs=await aiJobs(f.session);assert.equal(jobs.length,1);assert.equal(jobs[0].message_id,f.source.id);assert.equal(jobs[0].conversation_id,f.ai);
});

test('an expired numbered offer stays reserved and cannot reach a semantic NEW proposal',async()=>{
 const f=await fixture();await pool.query("update private.pending_route_choices set expires_at=clock_timestamp()-interval '1 second' where pending_message_id=$1",[f.source.id]);
 const result=await explicit(f,'ต่อ เรื่อง 2',{proposal:'NEW'});assert.equal(result.calls,0);
 assert.equal((await aiJobs(f.session)).length,0);assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
});

test('actual ambiguous prompt describes owned topics and numbered choice routes original source once',async()=>{
 const f=await fixture('แล้วเรื่องนั้นล่ะ');
 await pool.query('insert into public.conversations(line_session_id,topic) values($1,$2)',[f.session,'การลงทะเบียน']);
 const prompt=await eventFor(f.userId,'ยังเลือกเรื่องไม่ได้ครับ');await apply(prompt);
 const pending=(await pool.query('select * from public.messages where source_event_id=$1',[prompt.id])).rows[0];
 const row=(await pool.query('select payload_encrypted from private.message_outbox where line_session_id=$1 order by created_at desc,id desc limit 1',[f.session])).rows[0];
 const message=JSON.parse(decryptValue(row.payload_encrypted,key)).messages[0];
 const labels=message.quickReply.items.map((item:{action:{label:string}})=>item.action.label);
 assert.equal(new Set(labels).size,4);assert(labels.includes('ต่อ เรื่อง 2'));
 assert(message.text.includes('2. ห้องสมุด'));assert(message.text.includes('3. การลงทะเบียน'));
 const result=await explicit(f,'ต่อ เรื่อง 2');assert.equal(result.calls,0);
 const jobs=await aiJobs(f.session);assert.equal(jobs.length,1);assert.equal(jobs[0].message_id,pending.id);assert.equal(jobs[0].conversation_id,f.ai);
 assert.equal((await sourceNow(pending.id)).content,'ยังเลือกเรื่องไม่ได้ครับ');
 assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
 await explicit(f,'ต่อ เรื่อง 2');assert.equal((await aiJobs(f.session)).length,1);
 assert.equal((await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.ticket.id])).rows[0].n,0);
});

test('context display uses own first substantive USER text when the topic is absent',async()=>{
 const f=await fixture();
 const other=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[f.session])).rows[0].id;
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,metadata) values($1,'USER','TEXT','ต่อ เรื่อง 1','{\"routing_status\":\"ROUTE_CONTROL\"}')",[other]);
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','IMAGE','[ไฟล์แนบ]')",[other]);
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','   ')",[other]);
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT',$2)",[other,'ขอค้นหนังสือเรื่องภาษาไทย']);
 const loaded=await loadCandidates(pool,f.session);assert.equal(loaded.find(c=>c.conversationId===other)?.topicLabel,'ขอค้นหนังสือเรื่องภาษาไทย');
 assert.equal(loaded.find(c=>c.conversationId===f.human)?.topicLabel,f.ticket.ticket_no);
});
test('typed HUMAN continuation forwards only the original question, creates no AI job and retains explicit focus',async()=>{
 const f=await fixture();const result=await explicit(f,`ต่อ ${f.ticket.ticket_no}`);assert.equal(result.calls,0);
 assert.equal((await aiJobs(f.session)).length,0);const source=await sourceNow(f.source.id);
 assert.equal(source.ticket_id,f.ticket.id);assert.equal(source.content,f.question);assert.equal(source.metadata.routing_status,'ROUTED');
 const focus=await readExplicitHumanFocus(pool,f.session,await loadCandidates(pool,f.session));assert.equal(focus?.conversationId,f.human);
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where line_session_id=$1 and kind='AI'",[f.session])).rows[0].n,0);
});
test('mixed substantive text is not interpreted as an explicit navigation command',async()=>{
 const f=await fixture();const result=await explicit(f,`ต่อ ${f.ticket.ticket_no} แต่ถามเรื่อง Wi-Fi ใหม่`);
 assert.equal(result.calls,1);assert.equal((await aiJobs(f.session)).length,0);assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
});
test('changed candidate snapshot cannot authorize the previously offered typed choice',async()=>{
 const f=await fixture();await pool.query('update public.conversations set revision=revision+1 where id=$1',[f.ai]);
 const result=await explicit(f,'เริ่มเรื่องใหม่');assert.equal(result.calls,0);assert.equal((await aiJobs(f.session)).length,0);
 assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
});
test('expired choice cannot revive the pending source',async()=>{
 const f=await fixture();await pool.query("update private.pending_route_choices set expires_at=clock_timestamp()-interval '1 second' where line_session_id=$1",[f.session]);
 const result=await explicit(f,'เริ่มเรื่องใหม่');assert.equal(result.calls,0);assert.equal((await aiJobs(f.session)).length,0);
 assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
});
test('only the latest pending question is consumed; an earlier unanswered prompt is not replayed',async()=>{
 const f=await fixture();const second=await eventFor(f.userId,'ถามใหม่เกี่ยวกับแบบฟอร์มครับ');await apply(second);
 const newer=(await pool.query('select * from public.messages where source_event_id=$1',[second.id])).rows[0];
 const result=await explicit(f,'เริ่มเรื่องใหม่');assert.equal(result.calls,0);
 const jobs=await aiJobs(f.session);assert.equal(jobs.length,1);assert.equal(jobs[0].message_id,newer.id);
 assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
});
test('duplicate current AI labels cannot choose an arbitrary AI context',async()=>{
 const f=await fixture();await pool.query('insert into public.conversations(line_session_id) values($1)',[f.session]);
 // Refresh the prompt with the exact new candidates, so this proves duplicate-label rejection rather than just stale snapshots.
 const next=await eventFor(f.userId,'แบบฟอร์มอยู่ที่ไหน');await apply(next);
 const result=await explicit(f,'ต่อ เรื่องที่กำลังคุย');assert.equal(result.calls,0);assert.equal((await aiJobs(f.session)).length,0);
});
test('stolen/expired lease rolls back choice consumption, original routing and command storage',async()=>{
 const f=await fixture();const job=await eventFor(f.userId,'เริ่มเรื่องใหม่');
 await pool.query("update private.webhook_inbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[job.id]);
 await assert.rejects(apply(job),{message:'STALE_LEASE'});
 assert.equal((await aiJobs(f.session)).length,0);assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
 assert.equal((await pool.query('select count(*)::int n from private.pending_route_choices where pending_message_id=$1 and consumed_at is null',[f.source.id])).rows[0].n,3);
});
test('choice authority changed after read-only preflight is rechecked before any routing effects',async()=>{
 const f=await fixture(),job=await eventFor(f.userId,'เริ่มเรื่องใหม่');let calls=0;
 assert.equal(await classifyStudentInboxContext(pool,job,key,async()=>{calls++;return {decision:'NEW',candidateCode:null,confidence:1};}),null);
 assert.equal(calls,0);await pool.query('update public.conversations set revision=revision+1 where id=$1',[f.human]);
 await apply(job);assert.equal((await aiJobs(f.session)).length,0);assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
});
test('foreign or already-consumed offered rows do not authorize typed NEW',async()=>{
 for(const mode of ['foreign','consumed'] as const){
  const f=await fixture();
  if(mode==='foreign'){
   const other=await fixture();await pool.query('update private.pending_route_choices set line_session_id=$2 where pending_message_id=$1',[f.source.id,other.session]);
  }else await pool.query('update private.pending_route_choices set consumed_at=clock_timestamp() where pending_message_id=$1',[f.source.id]);
  const result=await explicit(f,'เริ่มเรื่องใหม่');assert.equal(result.calls,0);assert.equal((await aiJobs(f.session)).length,0);
  assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'PENDING');
 }
});
test('duplicate LINE command message ID cannot consume a later prompt or create a second AI job',async()=>{
 const f=await fixture(),messageId=randomUUID();await explicit(f,'เริ่มเรื่องใหม่',{messageId});
 assert.equal((await aiJobs(f.session)).length,1);
 const next=await eventFor(f.userId,'คำถามใหม่อีกเรื่อง');await apply(next);
 const later=(await pool.query('select id from public.messages where source_event_id=$1',[next.id])).rows[0].id;
 await explicit(f,'เริ่มเรื่องใหม่',{messageId});assert.equal((await aiJobs(f.session)).length,1);
 assert.equal((await sourceNow(later)).metadata.routing_status,'PENDING');
 assert.equal((await pool.query('select count(*)::int n from private.pending_route_choices where pending_message_id=$1 and consumed_at is null',[later])).rows[0].n,4);
});
test('invalid exact navigation cannot fall through to model NEW/CONTINUE or contaminate a ticket',async()=>{
 for(const proposal of ['NEW','CONTINUE'] as const)for(const mode of ['expired','consumed','foreign','duplicate','stale','fresh-id-replay'] as const){
  const f=await fixture();let text=`ต่อ ${f.ticket.ticket_no}`;
  if(mode==='expired')await pool.query("update private.pending_route_choices set expires_at=clock_timestamp()-interval '1 second' where pending_message_id=$1",[f.source.id]);
  if(mode==='consumed')await pool.query('update private.pending_route_choices set consumed_at=clock_timestamp() where pending_message_id=$1',[f.source.id]);
  if(mode==='foreign'){
   const other=await fixture();await pool.query('update private.pending_route_choices set line_session_id=$2 where pending_message_id=$1',[f.source.id,other.session]);
  }
  if(mode==='duplicate'){
   await pool.query('insert into public.conversations(line_session_id) values($1)',[f.session]);text='ต่อ เรื่องที่กำลังคุย';
  }
  if(mode==='stale')await pool.query('update public.conversations set revision=revision+1 where id=$1',[f.ai]);
  if(mode==='fresh-id-replay')await explicit(f,'เริ่มเรื่องใหม่');
  const before=(await aiJobs(f.session)).length;
  const result=await explicit(f,text,{proposal});assert.equal(result.calls,0,`${mode}/${proposal}: navigation must not reach the model`);
  assert.equal((await aiJobs(f.session)).length,before);
  assert.equal((await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.ticket.id])).rows[0].n,0);
 }
});
test('postback NEW retains the existing original-source behavior',async()=>{
 const f=await fixture();const {decryptValue}=await import('../../lib/security/identity');
 const payload=(await pool.query('select payload_encrypted from private.message_outbox where line_session_id=$1 order by created_at desc limit 1',[f.session])).rows[0];
 const message=JSON.parse(decryptValue(payload.payload_encrypted,key));
 const data=message.messages[0].quickReply.items[0].action.data;
 const job=await eventFor(f.userId,'',{postback:data});await apply(job);
 assert.equal((await aiJobs(f.session))[0].message_id,f.source.id);assert.equal((await sourceNow(f.source.id)).metadata.routing_status,'ROUTED');
});
