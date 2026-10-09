import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import type {SemanticClassifier} from '../../lib/conversation/semantic-routing-contracts';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const key=Buffer.alloc(32,70).toString('base64'),pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'semantic-route-owned-qa'});
const ownedSessions:string[]=[],ownedHashes:string[]=[];
after(async()=>{try{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[ownedSessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where (line_session_id=any($1::uuid[]) or ticket_id in(select id from public.tickets where line_session_id=any($1::uuid[]))) and status in('PENDING','PROCESSING')",[ownedSessions]);
 await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where channel='STUDENT' and user_hash=any($1::text[]) and status in('PENDING','PROCESSING')",[ownedHashes]);
 }finally{await pool.end();}});
async function fixture(options:{second?:boolean;spam?:boolean;duplicate?:boolean;postback?:boolean}={}){
 const userId='U'+randomUUID().replaceAll('-',''),hash=hashLineUserId(userId,key),session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['PRIVATE_ROUTE_'+randomUUID()])).rows[0].id;
 ownedSessions.push(session);ownedHashes.push(hash);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hash,encryptValue(userId,key)]);
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,topic) values($1,'HUMAN','TICKET','การลงทะเบียน') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,(select id from public.departments where code='REGISTRAR'),'ลงทะเบียนไม่ได้','HUMAN','STAFF_HANDLING') returning id",[session,conversation])).rows[0].id;
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket]);
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ลงทะเบียนไม่ได้ครับ')",[conversation,ticket]);
 let second:string|undefined;if(options.second)second=(await pool.query("insert into public.conversations(line_session_id,topic) values($1,'ห้องสมุด') returning id",[session])).rows[0].id;
 if(options.spam)for(let i=0;i<20;i++)await pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status) values('STUDENT',$1,$2,$3,'MESSAGE','DONE')",[randomUUID(),hash,encryptValue('{}',key)]);
 const messageId='semantic-msg-'+randomUUID(),event=options.postback?{type:'postback',source:{type:'user',userId},postback:{data:'invalid-choice'}}:{type:'message',source:{type:'user',userId},message:{type:'text',id:messageId,text:'ห้องสมุดปิดกี่โมง'}};
 if(options.duplicate)await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,line_message_id) values($1,$2,'USER','TEXT','duplicate',$3)",[conversation,ticket,messageId]);
 const job=(await pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,$4,'PROCESSING',$5,clock_timestamp()+interval '30 seconds',1) returning *",[randomUUID(),hash,encryptValue(JSON.stringify(event),key),options.postback?'OTHER':'MESSAGE',randomUUID()])).rows[0] as InboxJob;
 return {userId,hash,session,conversation,ticket,second,job};
}
const applyInbox=(job:InboxJob,advice:Awaited<ReturnType<typeof classifyStudentInboxContext>>)=>transaction(c=>processInboxEvent(c,job,key,{aiEnabled:true,routingAdvice:advice??undefined}),pool);
test('new semantic topic during HUMAN starts an independent AI job; classifier sees minimized evidence outside SQL',async()=>{
 const f=await fixture();const classify:SemanticClassifier=async input=>{
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name='semantic-route-owned-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n,0);
  for(const privateValue of [f.userId,f.session,f.conversation,f.ticket,'PRIVATE_ROUTE_'])assert(!JSON.stringify(input).includes(privateValue));assert.equal(input.contexts[0].code,'C1');
  return {decision:'NEW',candidateCode:null,confidence:.98};
 };
 const advice=await classifyStudentInboxContext(pool,f.job,key,classify);assert(advice);await applyInbox(f.job,advice);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,1);
 const current=(await pool.query('select mode,status,revision from public.tickets where id=$1',[f.ticket])).rows[0];assert.deepEqual(current,{mode:'HUMAN',status:'STAFF_HANDLING',revision:0});
 assert.equal((await pool.query('select count(*)::int n from public.conversations where line_session_id=$1',[f.session])).rows[0].n,2);
});
test('an exact semantic HUMAN continuation routes user text to that ticket and creates no AI job or reply',async()=>{
 const f=await fixture(),advice=await classifyStudentInboxContext(pool,f.job,key,async()=>({decision:'CONTINUE',candidateCode:'C1',confidence:.98}));await applyInbox(f.job,advice);
 assert.equal((await pool.query('select ticket_id from public.messages where source_event_id=$1',[f.job.id])).rows[0].ticket_id,f.ticket);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where line_session_id=$1',[f.session])).rows[0].n,0);
});
test('multiple contexts map C2 to the current server candidate rather than latest HUMAN ticket',async()=>{
 const f=await fixture({second:true}),advice=await classifyStudentInboxContext(pool,f.job,key,async()=>({decision:'CONTINUE',candidateCode:'C2',confidence:.98}));await applyInbox(f.job,advice);
 assert.equal((await pool.query('select conversation_id from public.messages where source_event_id=$1',[f.job.id])).rows[0].conversation_id,f.second);
 assert.equal((await pool.query('select conversation_id from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].conversation_id,f.second);
});
test('low-confidence and unknown labels keep the owned context prompt instead of auto-selecting',async()=>{
 for(const proposal of [{decision:'NEW' as const,candidateCode:null,confidence:.3},{decision:'CONTINUE' as const,candidateCode:'C12',confidence:1}]){
  const f=await fixture(),advice=await classifyStudentInboxContext(pool,f.job,key,async()=>proposal);await applyInbox(f.job,advice);
  assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
  assert.equal((await pool.query("select count(*)::int n from public.conversations where line_session_id=$1 and conversation_type='SUPPORT'",[f.session])).rows[0].n,1);
 }
});
test('new USER text without revision or changed HUMAN mode after classification invalidates the hint',async()=>{
 for(const change of ['message','mode'] as const){const f=await fixture(),advice=await classifyStudentInboxContext(pool,f.job,key,async()=>({decision:'NEW',candidateCode:null,confidence:.98}));assert(advice);
  if(change==='message')await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ข้อมูลใหม่')",[f.conversation,f.ticket]);
  else await pool.query("update public.conversations set mode='AI' where id=$1",[f.conversation]);
  await applyInbox(f.job,advice);assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
 }
});
test('arrival spam, duplicate LINE message and explicit postback make zero classifier calls',async()=>{
 for(const options of [{spam:true},{duplicate:true},{postback:true}]){const f=await fixture(options);let calls=0;assert.equal(await classifyStudentInboxContext(pool,f.job,key,async()=>{calls++;return {decision:'NEW',candidateCode:null,confidence:1};}),null);assert.equal(calls,0);}
});
test('expired or stolen inbox lease prevents classification and all business effects',async()=>{
 const f=await fixture();await pool.query("update private.webhook_inbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[f.job.id]);let calls=0;
 assert.equal(await classifyStudentInboxContext(pool,f.job,key,async()=>{calls++;return {decision:'NEW',candidateCode:null,confidence:1};}),null);assert.equal(calls,0);
 await assert.rejects(applyInbox(f.job,null),{message:'STALE_LEASE'});assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
});
test('a reclaimed lease after outsideSQL classification rejects all final business effects',async()=>{
 const f=await fixture(),advice=await classifyStudentInboxContext(pool,f.job,key,async()=>{
  await pool.query('update private.webhook_inbox set lease_token=$2 where id=$1',[f.job.id,randomUUID()]);return {decision:'NEW',candidateCode:null,confidence:1};
 });assert(advice);await assert.rejects(applyInbox(f.job,advice),{message:'STALE_LEASE'});
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
});
test('an ignoring classifier cannot keep an owned worker waiting beyond the bounded deadline',async()=>{
 const f=await fixture();const started=performance.now();
 assert.equal(await classifyStudentInboxContext(pool,f.job,key,async()=>new Promise(()=>{})),null);
 assert(performance.now()-started<11000,'CLASSIFICATION_DEADLINE_MUST_BE_BOUNDED');
 await applyInbox(f.job,null);assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
});
test('the real inbox cycle claims, classifies and commits a new topic without modifying the HUMAN ticket',async()=>{
 await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where channel='STUDENT' and user_hash=any($1::text[]) and status in('PENDING','PROCESSING')",[ownedHashes]);
 const f=await fixture();await pool.query("update private.webhook_inbox set status='PENDING',lease_token=null,lease_until=null where id=$1",[f.job.id]);let calls=0;
 const result=await runInboxCycle(pool,key,{aiEnabled:true,classify:async()=>{calls++;return {decision:'NEW',candidateCode:null,confidence:.98};}});
 assert.deepEqual(result,{claimed:1,completed:1,failed:0});assert.equal(calls,1);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,1);
 assert.deepEqual((await pool.query('select mode,status,revision from public.tickets where id=$1',[f.ticket])).rows[0],{mode:'HUMAN',status:'STAFF_HANDLING',revision:0});
 assert.equal((await pool.query('select status from private.webhook_inbox where id=$1',[f.job.id])).rows[0].status,'DONE');
});
