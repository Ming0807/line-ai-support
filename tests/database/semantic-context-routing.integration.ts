import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {decryptValue,encryptValue,hashLineUserId} from '../../lib/security/identity';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import type {SemanticClassifier} from '../../lib/conversation/semantic-routing-contracts';
import {createSupportProducer} from '../../lib/ai/support-producer';
import {runAICycle} from '../../lib/ai/run-worker';
import type {GenerateInput} from '../../lib/ai/gateway';
import type {KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {createSemanticRoutingClassifier} from '../../lib/conversation/semantic-routing-provider';
import {AIProviderError} from '../../lib/ai/types';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const key=Buffer.alloc(32,70).toString('base64'),pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'semantic-route-owned-qa'});
const ownedSessions:string[]=[],ownedHashes:string[]=[];
after(async()=>{try{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[ownedSessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where (line_session_id=any($1::uuid[]) or ticket_id in(select id from public.tickets where line_session_id=any($1::uuid[]))) and status in('PENDING','PROCESSING')",[ownedSessions]);
 await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where channel='STUDENT' and user_hash=any($1::text[]) and status in('PENDING','PROCESSING')",[ownedHashes]);
 }finally{await pool.end();}});
async function fixture(options:{second?:boolean;spam?:boolean;duplicate?:boolean;postback?:boolean;question?:string}={}){
 const userId='U'+randomUUID().replaceAll('-',''),hash=hashLineUserId(userId,key),session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['PRIVATE_ROUTE_'+randomUUID()])).rows[0].id;
 ownedSessions.push(session);ownedHashes.push(hash);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hash,encryptValue(userId,key)]);
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,topic) values($1,'HUMAN','TICKET','การลงทะเบียน') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,(select id from public.departments where code='REGISTRAR'),'ลงทะเบียนไม่ได้','HUMAN','STAFF_HANDLING') returning id",[session,conversation])).rows[0].id;
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket]);
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ลงทะเบียนไม่ได้ครับ')",[conversation,ticket]);
 let second:string|undefined;if(options.second)second=(await pool.query("insert into public.conversations(line_session_id,topic) values($1,'ห้องสมุด') returning id",[session])).rows[0].id;
 if(options.spam)for(let i=0;i<20;i++)await pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status) values('STUDENT',$1,$2,$3,'MESSAGE','DONE')",[randomUUID(),hash,encryptValue('{}',key)]);
 const messageId='semantic-msg-'+randomUUID(),event=options.postback?{type:'postback',source:{type:'user',userId},postback:{data:'invalid-choice'}}:{type:'message',source:{type:'user',userId},message:{type:'text',id:messageId,text:options.question??'ห้องสมุดปิดกี่โมง'}};
 if(options.duplicate)await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,line_message_id) values($1,$2,'USER','TEXT','duplicate',$3)",[conversation,ticket,messageId]);
 const job=(await pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,$4,'PROCESSING',$5,clock_timestamp()+interval '30 seconds',1) returning *",[randomUUID(),hash,encryptValue(JSON.stringify(event),key),options.postback?'OTHER':'MESSAGE',randomUUID()])).rows[0] as InboxJob;
 return {userId,hash,session,conversation,ticket,second,job};
}
const applyInbox=(job:InboxJob,advice:Awaited<ReturnType<typeof classifyStudentInboxContext>>)=>transaction(c=>processInboxEvent(c,job,key,{aiEnabled:true,routingAdvice:advice??undefined}),pool);

test('fifteen active contexts still classify and route the exact thirteenth AI context once',async()=>{
 const f=await fixture({second:true,question:'ขอรายละเอียดหัวข้อทดสอบสิบสาม'});
 const extra=(await pool.query("insert into public.conversations(line_session_id,topic) select $1,'หัวข้อทดสอบ '||n from generate_series(1,13) n returning id",[f.session])).rows;
 const target=extra[12].id;let count=0;
 const advice=await classifyStudentInboxContext(pool,f.job,key,async input=>{
  count++;assert.equal(input.contexts.length,15);
  const chosen=input.contexts.find(c=>c.topic==='หัวข้อทดสอบ 13');assert(chosen);
  return {decision:'CONTINUE',candidateCode:chosen.code,confidence:.99};
 });
 assert(advice);assert.equal(count,1);assert.equal(advice.selection.selectedConversationId,target);
 await applyInbox(f.job,advice);
 const jobs=(await pool.query('select conversation_id,message_id from private.ai_jobs where line_session_id=$1',[f.session])).rows;
 assert.equal(jobs.length,1);assert.equal(jobs[0].conversation_id,target);
 assert.equal((await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.ticket])).rows[0].n,1);
 assert.equal((await pool.query('select content from public.messages where ticket_id=$1',[f.ticket])).rows[0].content,'ลงทะเบียนไม่ได้ครับ');
});

test('sixty-five contexts report capacity unavailability without calling AI or guessing a recipient',async()=>{
 const f=await fixture({question:'คำถามเมื่อมีเรื่องเกินขอบเขต'});
 await pool.query("insert into public.conversations(line_session_id,topic) select $1,'หัวข้อ'||n from generate_series(1,64) n",[f.session]);
 let calls=0;const reasons:string[]=[];
 assert.equal(await classifyStudentInboxContext(pool,f.job,key,async()=>{calls++;return {decision:'NEW',candidateCode:null,confidence:1};},reason=>reasons.push(reason)),null);
 assert.equal(calls,0);assert.deepEqual(reasons,['CONTEXT_LIMIT']);
 await pool.query("update private.webhook_inbox set status='PENDING',lease_token=null,lease_until=null where id=$1",[f.job.id]);
 assert.deepEqual(await runInboxCycle(pool,key,{aiEnabled:true,classify:async()=>{throw new Error('MUST_NOT_CALL');}}),{claimed:1,completed:1,failed:0});
 const saved=(await pool.query('select content,metadata,ticket_id from public.messages where source_event_id=$1',[f.job.id])).rows[0];
 assert.equal(saved.content,'คำถามเมื่อมีเรื่องเกินขอบเขต');assert.equal(saved.metadata.routing_status,'PENDING');assert.equal(saved.ticket_id,null);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
 assert.equal((await pool.query('select last_error_code from private.webhook_inbox where id=$1',[f.job.id])).rows[0].last_error_code,'ROUTING_UNAVAILABLE');
});

test('provider outage preserves the pending message and choices without claiming semantic ambiguity or sending to HUMAN',async()=>{
 const f=await fixture({second:true,question:'แล้วเรื่องที่คุยไว้ล่ะ'});
 await pool.query("update private.webhook_inbox set status='PENDING',lease_token=null,lease_until=null where id=$1",[f.job.id]);
 const classify=createSemanticRoutingClassifier(async()=>{throw new AIProviderError('TIMEOUT');});
 assert.deepEqual(await runInboxCycle(pool,key,{aiEnabled:true,classify}),{claimed:1,completed:1,failed:0});
 const rows=(await pool.query('select payload_encrypted from private.message_outbox where line_session_id=$1',[f.session])).rows;
 assert.equal(rows.length,1);
 const payload=JSON.parse(decryptValue(rows[0].payload_encrypted,key));
 assert.match(payload.messages[0].text,/ระบบ AI ไม่พร้อม/u);
 assert.doesNotMatch(payload.messages[0].text,/ข้อความนี้เป็นเรื่องใด|TIMEOUT/u);
 assert(payload.messages[0].quickReply.items.length>=2);
 const saved=(await pool.query('select content,metadata,conversation_id from public.messages where source_event_id=$1',[f.job.id])).rows;
 assert.equal(saved.length,1);assert.equal(saved[0].content,'แล้วเรื่องที่คุยไว้ล่ะ');
 assert.equal(saved[0].metadata.routing_status,'PENDING');
 assert.notEqual(saved[0].conversation_id,f.conversation);assert.notEqual(saved[0].conversation_id,f.second);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,1);
 assert.equal((await pool.query('select last_error_code from private.webhook_inbox where id=$1',[f.job.id])).rows[0].last_error_code,'ROUTING_UNAVAILABLE');
});
test('reserved explicit support confirmation uses backend authority without a semantic provider call',async()=>{
 const f=await fixture({question:'ยืนยันให้ส่งเรื่องนี้ให้เจ้าหน้าที่ช่วยตรวจสอบ'});let calls=0;
 const advice=await classifyStudentInboxContext(pool,f.job,key,async()=>{calls++;return {decision:'CONTINUE',candidateCode:'C1',confidence:.99};});
 assert.equal(calls,0,'EXPLICIT_CONFIRMATION_MUST_NOT_USE_PROVIDER');assert.equal(advice,null);
 await applyInbox(f.job,advice);
 assert.equal((await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,1,'UNOWNED_CONFIRMATION_MUST_NOT_ADD_A_TICKET');
 assert.equal((await pool.query('select count(*)::int n from private.ai_tool_receipts where confirmation_event_id=$1',[f.job.id])).rows[0].n,0);
});
test('assistant-reference routing sees only owned SENT replies and delivery changes invalidate its advice',async()=>{
 const f=await fixture({second:true,question:'ขอสั้นลง'});assert(f.second);
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Wi-Fi คืออะไร')",[f.second]);
 const sentJob=randomUUID(),pendingJob=randomUUID();
 for(const [job,content,sent] of [[sentJob,'Wi-Fi เชื่อมอุปกรณ์ผ่านคลื่นวิทยุ',true],[pendingJob,'คำตอบยังไม่ส่ง',false]] as const){
  await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,metadata) values($1,'AI','TEXT',$2,$3::jsonb)",[f.second,content,JSON.stringify({ai_job_id:job})]);
  const outbox=await transaction(c=>enqueueOutbound(c,{idempotencyKey:'ai-job:'+job,channel:'STUDENT',kind:'AI',lineSessionId:f.session,conversationId:f.second,conversationRevision:0,messages:[{type:'text',text:content}]},key),pool);
  if(sent)await pool.query("update private.message_outbox set status='SENT',completed_at=clock_timestamp() where id=$1",[outbox]);
 }
 const advice=await classifyStudentInboxContext(pool,f.job,key,async input=>{
  const context=input.contexts.find(c=>c.mode==='AI');assert(context);
  assert.deepEqual(context.previousUserMessages,['Wi-Fi คืออะไร']);
  assert.deepEqual(context.recentMessages,[{role:'user',content:'Wi-Fi คืออะไร'},{role:'assistant',content:'Wi-Fi เชื่อมอุปกรณ์ผ่านคลื่นวิทยุ'}]);
  assert(!JSON.stringify(input).includes('คำตอบยังไม่ส่ง'));
  return {decision:'CONTINUE',candidateCode:context.code,confidence:.99};
 });assert(advice);
 await pool.query("update private.message_outbox set status='SENT',completed_at=clock_timestamp() where idempotency_key=$1",['ai-job:'+pendingJob]);
 await applyInbox(f.job,advice);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
});
async function suppressPriorOwnedWorkerRows(){
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[ownedSessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[ownedSessions]);
}
const socialProposal={intent:'SOCIAL',category:'GENERAL',subcategory:null,needsTicket:false,department:null,urgency:'low',
 needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[]};
const socialReply='สวัสดีครับ ยินดีช่วยตอบคำถามทั่วไปเกี่ยวกับบริการของมหาวิทยาลัยครับ';
function socialProducer(onSocial?:()=>Promise<void>){
 const tasks:string[]=[];
 const generate:KnowledgeProducerOptions['generate']=async<T>(input:GenerateInput<T>)=>{
  tasks.push(input.taskType);
  if(input.taskType==='SUPPORT_INTENT')return {output:input.responseSchema.parse(socialProposal),toolCalls:[],providerId:'00000000-0000-4000-8000-000000000001',modelId:'00000000-0000-4000-8000-000000000002',fallbackUsed:false};
  if(input.taskType==='SUPPORT_SOCIAL'){
   assert.equal(input.responseName,'support_social');assert.equal(input.timeoutMs,8000);assert.deepEqual(input.tools,[]);
   await onSocial?.();
   return {output:input.responseSchema.parse({answer:socialReply}),toolCalls:[],providerId:'00000000-0000-4000-8000-000000000001',modelId:'00000000-0000-4000-8000-000000000002',fallbackUsed:false};
  }
  throw new Error(`UNEXPECTED_SOCIAL_TASK:${input.taskType}`);
 };
 return {tasks,produce:createSupportProducer({generate,embed:async()=>{throw new Error('SOCIAL_MUST_NOT_EMBED');},search:async()=>{throw new Error('SOCIAL_MUST_NOT_SEARCH');}})};
}
async function routeSocialAsNew(){
 const question='สวัสดีครับ';const f=await fixture({question});
 const advice=await classifyStudentInboxContext(pool,f.job,key,async input=>{
  assert.equal(input.question,question);assert.equal(input.contexts.length,1);assert.equal(input.contexts[0].code,'C1');
  return {decision:'NEW',candidateCode:null,confidence:.99};
 });
 assert(advice);await applyInbox(f.job,advice);
 const routed=(await pool.query('select conversation_id,ticket_id from public.messages where source_event_id=$1',[f.job.id])).rows[0];
 assert(routed);assert.notEqual(routed.conversation_id,f.conversation);assert.equal(routed.ticket_id,null);
 const job=(await pool.query('select id,conversation_id from private.ai_jobs where line_session_id=$1 and conversation_id=$2',[f.session,routed.conversation_id])).rows[0];assert(job);
 return {...f,question,conversationId:routed.conversation_id,aiJobId:job.id};
}
test('semantic routing receives and stores complete long Thai and prior USER text without changing the HUMAN case',async()=>{
 const question='ขอถามเรื่องใหม่ '+ 'รายละเอียด'.repeat(490)+' 👨‍👩‍👧‍👦 END_CURRENT';
 const prior='BEGIN_PRIOR '+ 'ข้อความเดิม'.repeat(350)+' END_PRIOR';
 const f=await fixture({question});
 await pool.query("update public.messages set content=$2 where conversation_id=$1 and sender_type='USER'",[f.conversation,prior]);
 let calls=0;
 const advice=await classifyStudentInboxContext(pool,f.job,key,async input=>{
  calls++;assert.equal(input.question,question);assert.deepEqual(input.contexts[0].previousUserMessages,[prior]);
  return {decision:'NEW',candidateCode:null,confidence:.99};
 });
 assert(advice);assert.equal(calls,1);await applyInbox(f.job,advice);
 assert.equal((await pool.query('select content from public.messages where source_event_id=$1',[f.job.id])).rows[0].content,question);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,1);
 assert.deepEqual((await pool.query('select mode,status,revision from public.tickets where id=$1',[f.ticket])).rows[0],{mode:'HUMAN',status:'STAFF_HANDLING',revision:0});
});
test('new semantic topic during HUMAN starts an independent AI job; classifier sees minimized evidence outside SQL',async()=>{
 const f=await fixture();const classify:SemanticClassifier=async input=>{
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name='semantic-route-owned-qa' and pid<>pg_backend_pid() and xact_start is not null and query not like 'insert into private.inbox_routing_observations%'")).rows[0].n,0);
  for(const privateValue of [f.userId,f.session,f.conversation,f.ticket,'PRIVATE_ROUTE_'])assert(!JSON.stringify(input).includes(privateValue));assert.equal(input.contexts[0].code,'C1');
  return {decision:'NEW',candidateCode:null,confidence:.98};
 };
 const advice=await classifyStudentInboxContext(pool,f.job,key,classify);assert(advice);await applyInbox(f.job,advice);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,1);
 const current=(await pool.query('select mode,status,revision from public.tickets where id=$1',[f.ticket])).rows[0];assert.deepEqual(current,{mode:'HUMAN',status:'STAFF_HANDLING',revision:0});
 assert.equal((await pool.query('select count(*)::int n from public.conversations where line_session_id=$1',[f.session])).rows[0].n,2);
});
test('an exact semantic HUMAN continuation keeps the ticket and sends only the fixed receipt without AI',async()=>{
 const f=await fixture(),advice=await classifyStudentInboxContext(pool,f.job,key,async()=>({decision:'CONTINUE',candidateCode:'C1',confidence:.98}));await applyInbox(f.job,advice);
 assert.equal((await pool.query('select ticket_id from public.messages where source_event_id=$1',[f.job.id])).rows[0].ticket_id,f.ticket);
 assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
 const outboxes=(await pool.query('select kind,channel,idempotency_key,payload_encrypted from private.message_outbox where line_session_id=$1',[f.session])).rows;
 assert.equal(outboxes.length,1);assert.equal(outboxes[0].kind,'SYSTEM');assert.equal(outboxes[0].channel,'STUDENT');
 assert.equal(outboxes[0].idempotency_key,`student-response:${f.job.id}`);
 assert.match(JSON.parse(decryptValue(outboxes[0].payload_encrypted,key)).messages[0].text,/บันทึกข้อความเข้าเคส/u);
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
test('an ignoring classifier respects the approved 25-second ceiling and leaves the seven-second lease reserve',async()=>{
 // Independent DEC162/169 oracles: do not derive expected deadlines from the helper under test.
 for(const {leaseSeconds,minimumMs,maximumMs} of [
  {leaseSeconds:90,minimumMs:24000,maximumMs:28000},
  {leaseSeconds:9,minimumMs:500,maximumMs:4000},
 ]){
  const f=await fixture();
  await pool.query("update private.webhook_inbox set lease_until=clock_timestamp()+make_interval(secs=>$2) where id=$1",[f.job.id,leaseSeconds]);
  let calls=0,callbackSignal:AbortSignal|undefined;const started=performance.now(),unavailable:string[]=[];
  assert.equal(await classifyStudentInboxContext(pool,f.job,key,async(_input,signal)=>{calls++;callbackSignal=signal;return new Promise(()=>{});},reason=>unavailable.push(reason)),null);
  assert.equal(calls,1);assert.equal(callbackSignal?.aborted,true);assert.deepEqual(unavailable,['TIMEOUT']);
  const elapsed=performance.now()-started;
  assert(elapsed>=minimumMs&&elapsed<maximumMs,`CLASSIFICATION_APPROVED_CEILING_AND_LEASE_RESERVE:${leaseSeconds}:${Math.round(elapsed)}`);
  const remainingMs=Number((await pool.query('select extract(epoch from(lease_until-clock_timestamp()))*1000 ms from private.webhook_inbox where id=$1',[f.job.id])).rows[0].ms);
  assert(remainingMs>=6500,`CLASSIFICATION_MUST_RETAIN_SEVEN_SECOND_RESERVE_WITH_500MS_SCHEDULING_MARGIN:${Math.round(remainingMs)}`);
  await applyInbox(f.job,null);assert.equal((await pool.query('select count(*)::int n from private.ai_jobs where line_session_id=$1',[f.session])).rows[0].n,0);
 }
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
test('a semantic NEW greeting during HUMAN runs the real social producer and saves one exact reply without ticket or outcome',async()=>{
 await suppressPriorOwnedWorkerRows();const f=await routeSocialAsNew(),social=socialProducer();
 const stats=await runAICycle(pool,key,{supportEnabled:true,produce:social.produce});
 assert.deepEqual(stats,{claimed:1,completed:1,suppressed:0,failed:0});assert.deepEqual(social.tasks,['SUPPORT_INTENT','SUPPORT_SOCIAL']);
 const outboxes=(await pool.query('select payload_encrypted from private.message_outbox where idempotency_key=$1',[`ai-job:${f.aiJobId}`])).rows;
 assert.equal(outboxes.length,1);const payload=JSON.parse(decryptValue(outboxes[0].payload_encrypted,key));
 assert.deepEqual(payload.messages.map((message:{type:string;text:string})=>({type:message.type,text:message.text})),[{type:'text',text:socialReply}]);
 assert.deepEqual((await pool.query("select content from public.messages where conversation_id=$1 and sender_type='AI'",[f.conversationId])).rows,[{content:socialReply}]);
 const privateState=(await pool.query('select context_encrypted from private.ai_support_state where conversation_id=$1',[f.conversationId])).rows[0];assert(privateState);
 assert.equal(JSON.parse(decryptValue(privateState.context_encrypted,key)).proposal.intent,'SOCIAL');
 assert.equal((await pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[f.conversationId])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[f.conversationId])).rows[0].n,0);
 assert.deepEqual((await pool.query('select mode,status,revision from public.tickets where id=$1',[f.ticket])).rows[0],{mode:'HUMAN',status:'STAFF_HANDLING',revision:0});
});
test('HUMAN takeover during social generation suppresses the complete generated reply',async()=>{
 await suppressPriorOwnedWorkerRows();const f=await routeSocialAsNew();let takenOver=false;
 const social=socialProducer(async()=>{
  await pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversationId]);takenOver=true;
 });
 const stats=await runAICycle(pool,key,{supportEnabled:true,produce:social.produce});
 assert(takenOver);assert.deepEqual(social.tasks,['SUPPORT_INTENT','SUPPORT_SOCIAL']);
 assert.deepEqual(stats,{claimed:1,completed:0,suppressed:1,failed:0});
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversationId])).rows[0].n,0);
 assert.equal((await pool.query("select count(*)::int n from public.messages where conversation_id=$1 and sender_type='AI'",[f.conversationId])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[f.conversationId])).rows[0].n,0);
 assert.deepEqual((await pool.query('select mode,status,revision from public.tickets where id=$1',[f.ticket])).rows[0],{mode:'HUMAN',status:'STAFF_HANDLING',revision:0});
});
