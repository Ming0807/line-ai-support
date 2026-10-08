import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {encryptValue,decryptValue} from '../../lib/security/identity';
import {loadSupportSnapshot,saveSupportState} from '../../lib/ai/support-state';
import type {AIJob} from '../../lib/ai/jobs';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const key=Buffer.alloc(32,72).toString('base64'),pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'support-state-owned-qa'}),sessions:string[]=[];
after(async()=>{try{await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);}finally{await pool.end();}});
async function fixture(){
 const sessionId=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['PRIVATE_SUPPORT_'+randomUUID()])).rows[0].id;sessions.push(sessionId);
 const conversationId=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[sessionId])).rows[0].id;
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Wi-Fi ต่อไม่ได้ครับ')",[conversationId]);
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'AI','TEXT','PRIVATE_ASSISTANT_FACT')",[conversationId]);
 const messageId=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','มือถือ Android ขึ้น authentication failed') returning id",[conversationId])).rows[0].id;
 const context={sessionId,conversationId,messageId,revision:0};
 const job=(await pool.query("insert into private.ai_jobs(line_session_id,conversation_id,message_id,expected_conversation_revision,request_encrypted,status,attempts,lease_token,lease_until) values($1,$2,$3,0,$4,'PROCESSING',1,$5,clock_timestamp()+interval '90 seconds') returning *",[sessionId,conversationId,messageId,encryptValue(JSON.stringify({receivedAt:new Date().toISOString()}),key),randomUUID()])).rows[0] as AIJob;
 const proposed={intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:false,department:'IT',urgency:'medium',needsKnowledgeSearch:true,needsStructuredSearch:false,needsWebSearch:false,confidence:.96,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ต่อไม่ได้ครับ'},{field:'DEVICE',source:'U0',quote:'มือถือ Android'},{field:'ERROR',source:'U0',quote:'authentication failed'}]};
 const snapshot=await transaction(c=>loadSupportSnapshot(c,context,key),pool);assert(snapshot);return {sessionId,conversationId,messageId,context,job,proposed,snapshot};
}
test('actual private snapshot contains only current/prior USER evidence and rejects source identity mismatches',async()=>{
 const f=await fixture();assert.deepEqual(f.snapshot.input.sources.map(s=>s.code),['U0','U1']);assert.equal(f.snapshot.input.sources[1].text,'Wi-Fi ต่อไม่ได้ครับ');
 const serialized=JSON.stringify(f.snapshot.input);for(const value of [f.sessionId,f.conversationId,f.messageId,'PRIVATE_ASSISTANT_FACT','PRIVATE_SUPPORT_'])assert(!serialized.includes(value));
 assert.equal(await transaction(c=>loadSupportSnapshot(c,{...f.context,sessionId:randomUUID()},key),pool),null);
});
test('owned source/lease validation saves encrypted literal context idempotently without creating tickets or outbox',async()=>{
 const f=await fixture(),first=await transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key),pool),second=await transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key),pool);assert.equal(first.stateDigest,second.stateDigest);
 const row=(await pool.query('select * from private.ai_support_state where conversation_id=$1',[f.conversationId])).rows[0];assert(row.context_encrypted.startsWith('v1.'));assert(!row.context_encrypted.includes('authentication failed'));
 const payload=JSON.parse(decryptValue(row.context_encrypted,key));assert.equal(payload.version,1);assert.equal(payload.interpreted.problemText,'Wi-Fi ต่อไม่ได้ครับ');assert.equal(payload.interpreted.collectedContext[1].quote,'มือถือ Android');
 assert.equal((await pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[f.conversationId])).rows[0].n,0);assert.equal((await pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversationId])).rows[0].n,0);
});
test('new USER, HUMAN mode, directory and sensitivity changes discard an old support proposal',async()=>{
 for(const change of ['message','mode','directory','sensitivity'] as const){const f=await fixture();
  if(change==='message')await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','ลองใหม่แล้ว')",[f.conversationId]);
  if(change==='mode')await pool.query("update public.conversations set mode='HUMAN' where id=$1",[f.conversationId]);
  if(change==='directory')await pool.query("update public.departments set name_th=name_th||' fixture' where code='IT'");
  if(change==='sensitivity'){
   await transaction(c=>saveSupportState(c,f.job,f.snapshot,{...f.proposed,intent:'PERSONAL_CASE',needsTicket:true,needsKnowledgeSearch:false,sensitivity:'SENSITIVE'},key),pool);
  }
  await assert.rejects(transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key),pool),{message:'SUPPORT_CONTEXT_CHANGED'});
  if(change==='directory')await pool.query("update public.departments set name_th='เทคโนโลยีสารสนเทศ' where code='IT'");
 }
});
test('expired/stolen leases, other-job context and invented facts create no support state',async()=>{
 for(const change of ['lease','token','job','facts'] as const){const f=await fixture();
  if(change==='lease')await pool.query("update private.ai_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[f.job.id]);
  if(change==='token')await pool.query('update private.ai_jobs set lease_token=$2 where id=$1',[f.job.id,randomUUID()]);
  const job=change==='job'?{...f.job,conversation_id:randomUUID()}:f.job,proposal=change==='facts'?{...f.proposed,facts:[{field:'PROBLEM',source:'U1',quote:'made up source'}]}:f.proposed;
  await assert.rejects(transaction(c=>saveSupportState(c,job,f.snapshot,proposal,key),pool));assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversationId])).rows[0].n,0);
 }
});
test('clarification results and unrelated outbox cannot be asserted as verified guidance',async()=>{
 const f=await fixture();await pool.query('update private.ai_jobs set result_encrypted=$2,result_saved_at=clock_timestamp() where id=$1',[f.job.id,encryptValue(JSON.stringify({kind:'CLARIFY',text:'ถามรายละเอียด'}),key)]);
 const outbox=(await pool.query("insert into private.message_outbox(idempotency_key,channel,kind,line_session_id,conversation_id,expected_conversation_revision,payload_encrypted,delivery_mode) values($1,'STUDENT','AI',$2,$3,0,$4,'PUSH') returning id",['ai-job:'+f.job.id,f.sessionId,f.conversationId,encryptValue(JSON.stringify({messages:[{type:'text',text:'ถามรายละเอียด'}]}),key)])).rows[0].id;
 await assert.rejects(transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key,{guidanceOutboxId:outbox}),pool),{message:'SUPPORT_GUIDANCE_INVALID'});
 await pool.query("update private.message_outbox set status='SUPPRESSED',completed_at=clock_timestamp() where id=$1",[outbox]);
});
test('storage has private RLS and exact message/job/session ownership and immutable outcome/ticket receipts',async()=>{
 const names=['ai_support_state','ticket_support_contexts','ai_support_outcomes'];assert.equal((await pool.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any($1::text[]) and c.relrowsecurity",[names])).rows[0].n,3);
 for(const role of ['anon','authenticated'])for(const name of names)await assert.rejects(transaction(async c=>{await c.query('set local role '+role);await c.query('select * from private.'+name);},pool),{code:'42501'});
 const f=await fixture();await transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key),pool);
 const other=await fixture();await assert.rejects(pool.query('update private.ai_support_state set last_message_id=$2 where conversation_id=$1',[f.conversationId,other.messageId]),{code:'23503'});
 await assert.rejects(pool.query('update private.ai_support_state set line_session_id=$2 where conversation_id=$1',[f.conversationId,other.sessionId]),{code:'23503'});
 const event=(await pool.query("insert into private.webhook_inbox(channel,event_id,payload_encrypted,event_kind,status) values('STUDENT',$1,$2,'OTHER','DONE') returning id",[randomUUID(),encryptValue('{}',key)])).rows[0].id;
 await pool.query("insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,sensitive_level) values($1,$2,$3,$4,$5,'USER_CONFIRMED_SOLVED','GENERAL')",[f.conversationId,f.sessionId,f.messageId,event,'a'.repeat(64)]);
 await assert.rejects(pool.query("update private.ai_support_outcomes set kind='USER_CONFIRMED_ESCALATED' where conversation_id=$1",[f.conversationId]),{message:'SUPPORT_RECEIPT_IMMUTABLE'});
 await assert.rejects(pool.query('delete from private.ai_support_outcomes where conversation_id=$1',[f.conversationId]),{message:'SUPPORT_RECEIPT_IMMUTABLE'});
});
test('corrupt ciphertext or column/envelope privacy or department mismatch cannot supply a trusted support snapshot',async()=>{
 for(const change of ['ciphertext','privacy','department'] as const){const f=await fixture();await transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key),pool);
  if(change==='ciphertext')await pool.query('update private.ai_support_state set context_encrypted=$2 where conversation_id=$1',[f.conversationId,'v1.'+'x'.repeat(60)]);
  else if(change==='privacy')await pool.query("update private.ai_support_state set sensitive_level='SENSITIVE' where conversation_id=$1",[f.conversationId]);
  else await pool.query("update private.ai_support_state set department_id=(select id from public.departments where code='LIBRARY') where conversation_id=$1",[f.conversationId]);
  assert.equal(await transaction(c=>loadSupportSnapshot(c,f.context,key),pool),null);
  await assert.rejects(transaction(c=>saveSupportState(c,f.job,f.snapshot,f.proposed,key),pool),{message:'SUPPORT_CONTEXT_CHANGED'});
 }
});
