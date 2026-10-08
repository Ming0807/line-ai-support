import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test,after} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle,type AISnapshot} from '../../lib/ai/run-worker';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {createEscalation} from '../../lib/tickets/create-ticket';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const key=Buffer.alloc(32,74).toString('base64'),pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:5,application_name:'support-worker-owned-qa'}),sessions:string[]=[];
after(async()=>{try{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
}finally{await pool.end();}});
async function fixture(){
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;sessions.push(session);
 const user='U'+randomUUID().replaceAll('-','');await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Wi-Fi ต่อไม่ได้ครับ') returning id",[conversation])).rows[0].id;
 const job=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);assert(job);
 return {session,conversation,message,job};
}
function proposed(s:AISnapshot){
 assert(s.support,'SUPPORT_SNAPSHOT_MISSING');return {kind:'CLARIFY' as const,text:'ใช้อุปกรณ์อะไรครับ',support:{version:1 as const,sourceDigest:s.support.sourceDigest,directoryDigest:s.support.directoryDigest,
  minimumSensitivity:s.support.minimumSensitivity,deliveredGuidance:s.support.input.deliveredGuidance,
  proposal:{intent:'TROUBLESHOOT' as const,category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS' as const,needsTicket:false,department:'IT',urgency:'medium' as const,
   needsKnowledgeSearch:true,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:'DEVICE' as const,impact:'SINGLE_USER' as const,sensitivity:'GENERAL' as const,
   facts:[{field:'PROBLEM' as const,source:'U0',quote:'Wi-Fi ต่อไม่ได้ครับ'}]}}};
}
test('actual support-enabled worker commits the USER/directory snapshot before inference and saves private advice atomically',async()=>{
 const f=await fixture();const stats=await runAICycle(pool,key,{supportEnabled:true,produce:async s=>{
  const open=(await pool.query("select count(*)::int n from pg_stat_activity where application_name='support-worker-owned-qa' and state='idle in transaction'")).rows[0].n;assert.equal(open,0);
  assert(s.support);assert.equal(s.support.input.sources[0].text,'Wi-Fi ต่อไม่ได้ครับ');assert(!JSON.stringify(s.support.input).includes(f.session));return proposed(s);
 }});assert.equal(stats.completed,1,'SUPPORT_WORKER_MUST_COMPLETE');assert.equal(stats.failed,0);
 const stored=(await pool.query('select context_encrypted from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0];assert(stored);assert(stored.context_encrypted.startsWith('v1.'));
 const publicMessage=(await pool.query("select metadata from public.messages where conversation_id=$1 and sender_type='AI'",[f.conversation])).rows[0];assert.deepEqual(Object.keys(publicMessage.metadata).sort(),['ai_job_id','citations']);
 assert.equal((await pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[f.conversation])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[f.conversation])).rows[0].n,0);
 await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic-only',STAFF:'synthetic-only'},fetchImpl:async()=>new Response(null,{status:200})});
});
for(const change of ['USER','DIRECTORY','HUMAN','LEASE'] as const)test(`actual support worker discards ${change} changes during inference`,async()=>{
 const f=await fixture();const stats=await runAICycle(pool,key,{supportEnabled:true,produce:async s=>{
  const result=proposed(s);
  if(change==='USER')await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Android')",[f.conversation]);
  if(change==='DIRECTORY')await pool.query("update public.departments set name_th=name_th||' changed' where code='IT'");
  if(change==='HUMAN')await pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversation]);
  if(change==='LEASE')await pool.query("update private.ai_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[f.job]);
  return result;
 }});
 if(change==='LEASE')assert.equal(stats.failed,1);else assert.equal(stats.suppressed,1);
 assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].n,0);
 if(change==='DIRECTORY')await pool.query("update public.departments set name_th='เทคโนโลยีสารสนเทศ' where code='IT'");
 if(change==='LEASE')await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=$1",[f.job]);
});
test('a new USER after finalization suppresses the support reply before actual LINE dispatch',async()=>{
 const f=await fixture();assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce:async s=>proposed(s)})).completed,1);
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Android')",[f.conversation]);
 let calls=0;const sent=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic-only',STAFF:'synthetic-only'},fetchImpl:async()=>{calls++;return new Response(null,{status:200});}});
 assert.equal(calls,0);assert.equal(sent.failed,0);assert.equal((await pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${f.job}`])).rows[0].status,'SUPPRESSED');
});
test('fabricated or low-confidence cached support proposals cannot finalize an answer or advice',async()=>{
 for(const change of ['facts','confidence'] as const){const f=await fixture();
  const stats=await runAICycle(pool,key,{supportEnabled:true,produce:async s=>{
   const result=proposed(s);if(change==='confidence')result.support.proposal.confidence=.2;
   else result.support.proposal.facts[0].quote='invented problem';return result;
  }});assert.equal(stats.suppressed,1);assert.equal(stats.failed,0);
  assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].n,0);
  assert.equal((await pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].n,0);
 }
});
test('support result survives finalization rollback and retries without repeating inference or partially saving advice',async()=>{
 const f=await fixture();let calls=0;
 await pool.query(`create function private.support_worker_fixture_failure() returns trigger language plpgsql as $$begin if new.idempotency_key='ai-job:${f.job}' then raise exception 'SUPPORT_FIXTURE_ROLLBACK';end if;return new;end $$`);
 await pool.query('create trigger support_worker_fixture_failure before insert on private.message_outbox for each row execute function private.support_worker_fixture_failure()');
 try{
  const produce=async(s:AISnapshot)=>{calls++;return proposed(s);};assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce})).failed,1);
  assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].n,0);
  await pool.query('drop trigger support_worker_fixture_failure on private.message_outbox');await pool.query('drop function private.support_worker_fixture_failure()');
  await pool.query('update private.ai_jobs set available_at=clock_timestamp() where id=$1',[f.job]);
  assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce})).completed,1);assert.equal(calls,1);
  assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].n,1);
 }finally{
  await pool.query('drop trigger if exists support_worker_fixture_failure on private.message_outbox');await pool.query('drop function if exists private.support_worker_fixture_failure()');
 }
});
test('legacy confirmed escalation preserves validated sensitive support minimum before ticket/notifications',async()=>{
 const f=await fixture();assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce:async s=>{
  const result=proposed(s);return {...result,support:{...result.support,proposal:{...result.support.proposal,intent:'PERSONAL_CASE',needsTicket:true,missingContext:null}}};
 }})).completed,1);
 const ticket=await transaction(c=>createEscalation(c,{sessionId:f.session,conversationId:f.conversation,departmentCode:'IT',summary:'Wi-Fi ต่อไม่ได้ครับ'},key),pool);
 assert.equal((await pool.query('select sensitive_level from public.tickets where id=$1',[ticket.id])).rows[0].sensitive_level,'SENSITIVE');
});
test('corrupt stored sensitivity cannot fall through to a GENERAL escalation',async()=>{
 const f=await fixture();assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce:async s=>proposed(s)})).completed,1);
 await pool.query('update private.ai_support_state set context_encrypted=$2 where conversation_id=$1',[f.conversation,'v1.'+'x'.repeat(60)]);
 await assert.rejects(transaction(c=>createEscalation(c,{sessionId:f.session,conversationId:f.conversation,departmentCode:'IT',summary:'Wi-Fi ต่อไม่ได้ครับ'},key),pool),{code:'CONFLICT'});
 assert.equal((await pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[f.conversation])).rows[0].n,0);
});
