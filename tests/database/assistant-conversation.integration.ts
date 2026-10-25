import assert from 'node:assert/strict';
import {test,after,afterEach} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {createConversationReply} from '../../lib/ai/conversation-reply';
import {decryptValue,encryptValue,hashLineUserId} from '../../lib/security/identity';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {createProvider,createModel} from '../../lib/ai/provider-admin';
import {createConfiguredKnowledgeProducer} from '../../lib/knowledge/configured';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4});after(()=>pool.end());
const ownedSessions:string[]=[];
afterEach(async()=>{await pool.query("update private.ai_jobs set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[ownedSessions]);});
async function fixture(){
 const key=randomBytes(32).toString('base64'),session=randomUUID(),conversation=randomUUID(),message=randomUUID(),user='U'+randomUUID().replaceAll('-','');
 ownedSessions.push(session);
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1::uuid,$1::uuid::text)',[session]);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 await pool.query('insert into public.conversations(id,line_session_id) values($1,$2)',[conversation,session]);
 await pool.query("insert into public.messages(id,conversation_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','Wi-Fi คืออะไร')",[message,conversation]);
 const job=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);
 return {key,session,conversation,message,job};
}
test('a prior reply accepted after the next question cannot strand that next owned answer',async()=>{
 const f=await fixture();
 assert.equal((await runAICycle(pool,f.key,{produce:async snapshot=>createConversationReply(snapshot,'คำตอบแรก')!})).completed,1);
 const next=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','คำถามถัดไป') returning id",[f.conversation])).rows[0].id;
 const nextJob=await transaction(client=>prepareAIJob(client,{sessionId:f.session,conversationId:f.conversation,messageId:next,receivedAt:new Date()},f.key),pool);
 let history:unknown;
 assert.equal((await runAICycle(pool,f.key,{produce:async snapshot=>{history=snapshot.history;return createConversationReply(snapshot,'คำตอบถัดไป')!;}})).completed,1);
 assert.deepEqual(history,[{role:'user',content:'Wi-Fi คืออะไร'}],'UNSENT_PRIOR_REPLY_MUST_NOT_BE_INPUT_HISTORY');
 const sent:string[]=[];const options={accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async(_url:unknown,init?:RequestInit)=>{
  sent.push(...JSON.parse(String(init?.body)).messages.map((message:{text:string})=>message.text));return new Response(null,{status:200});
 }};
 await runOutboxCycle(pool,f.key,options);await runOutboxCycle(pool,f.key,options);
 assert.deepEqual(sent,['คำตอบแรก','คำตอบถัดไป'],'LATE_PRIOR_DELIVERY_MUST_NOT_DROP_THE_LATEST_UNCHANGED_ANSWER');
 assert(nextJob);assert.equal((await pool.query("select status from private.message_outbox where idempotency_key=$1",['ai-job:'+nextJob])).rows[0].status,'SENT');
});
test('general answer stores complete packets once, no support outcomes, and reaches controlled LINE',async()=>{
 const f=await fixture(),text='Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ 🧑‍💻\n'.repeat(300);
 const stats=await runAICycle(pool,f.key,{produce:async snapshot=>createConversationReply(snapshot,text)!});assert.equal(stats.completed,1);
 const outbox=(await pool.query('select * from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0];
 const payload=JSON.parse(decryptValue(outbox.payload_encrypted,f.key));assert.equal(payload.messages.map((m:{text:string})=>m.text).join(''),text);
 assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].n,0);
 let sent=0;
 await runOutboxCycle(pool,f.key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.messages.map((m:{text:string})=>m.text).join(''),text);sent++;return new Response(null,{status:200});}});
 assert.equal(sent,1);assert.equal((await runAICycle(pool,f.key,{produce:async()=>{throw Error('NO_REGENERATION');}})).claimed,0);
});
test('source changes during generation suppress general finalization',async()=>{
 const f=await fixture();const stats=await runAICycle(pool,f.key,{produce:async snapshot=>{
  const result=createConversationReply(snapshot,'คำอธิบายทั่วไป')!;
  await pool.query("update public.messages set content='changed source' where id=$1",[f.message]);return result;
 }});assert.equal(stats.suppressed,1);assert.equal((await pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].n,0);
});
test('source changes after enqueue suppress dispatch of the complete general answer',async()=>{
 const f=await fixture();assert.equal((await runAICycle(pool,f.key,{produce:async snapshot=>createConversationReply(snapshot,'คำอธิบายทั่วไป')!})).completed,1);
 await pool.query("update public.messages set content='changed after enqueue' where id=$1",[f.message]);let sent=0;
 await runOutboxCycle(pool,f.key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async()=>{sent++;return new Response(null,{status:200});}});
 assert.equal(sent,0);assert.equal((await pool.query('select status from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].status,'SUPPRESSED');
});
test('HUMAN takeover still suppresses natural prose',async()=>{
 const f=await fixture();const stats=await runAICycle(pool,f.key,{produce:async snapshot=>{
  await pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversation]);return createConversationReply(snapshot,'คำอธิบายทั่วไป')!;
 }});assert.equal(stats.suppressed,1);
});
test('mixed general answer and honest missing evidence are both delivered completely',async()=>{
 const f=await fixture(),generalText='Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ครับ',officialText='ยังไม่มีเอกสารยืนยันกำหนดการครับ';
 const stats=await runAICycle(pool,f.key,{produce:async snapshot=>({kind:'MIXED',general:createConversationReply(snapshot,generalText)!,official:{kind:'CLARIFY',text:officialText}})});
 assert.equal(stats.completed,1);
 const row=(await pool.query('select payload_encrypted from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0];
 assert.equal(JSON.parse(decryptValue(row.payload_encrypted,f.key)).messages.map((m:{text:string})=>m.text).join(''),`${generalText}\n\n${officialText}`);
 let sent=0;await runOutboxCycle(pool,f.key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async()=>{sent++;return new Response(null,{status:200});}});assert.equal(sent,1);
});
test('configured opt-in uses the actual registry, strict adapter, durable budget and worker',async()=>{
 const f=await fixture(),admin=randomUUID();await pool.query('insert into auth.users(id) values($1)',[admin]);
 await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Synthetic admin','SUPER_ADMIN',true)",[admin]);
 const provider=await createProvider(admin,{name:'Synthetic assistant',adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',priority:1,enabled:true,apiKey:'synthetic-only'},{pool,key:f.key});
 try{
  await createModel(admin,provider.id,{modelId:'fixture/synthetic:free',displayName:'Synthetic',purpose:'GENERATION',embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,enabled:true,priority:1,timeoutMs:10000,inputPricePerMillion:null,outputPricePerMillion:null},{pool,key:f.key});
  let inference=0;
  const fetchImpl:typeof fetch=async(url,init)=>{
   if(String(url).endsWith('/models'))return Response.json({data:[{id:'fixture/synthetic:free',pricing:{prompt:'0',completion:'0'}}]});
   assert(String(url).endsWith('/chat/completions'));inference++;
   const request=JSON.parse(String(init?.body));assert.equal(request.response_format.json_schema.name,'assistant_decision');
   return Response.json({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({decision:{action:'GENERAL_REPLY',text:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ครับ'}})}}],usage:{prompt_tokens:1,completion_tokens:1}});
  };
  const result=await runAICycle(pool,f.key,{produce:createConfiguredKnowledgeProducer(pool,f.key,{assistantEnabled:true,fetchImpl}),supportEnabled:true});
  assert.equal(result.completed,1);
  if(inference!==1)console.log('SYNTHETIC_PROVIDER_DIAGNOSTIC',JSON.stringify((await pool.query('select action,error_code,http_status from private.ai_model_observations where provider_id=$1',[provider.id])).rows));
  assert.equal(inference,1);
  assert.equal((await pool.query('select status from private.ai_turn_attempts where ai_job_id=$1',[f.job])).rows[0]?.status,'SUCCESS');
  assert.equal((await pool.query('select count(*)::int n from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].n,0);
 }finally{
  await pool.query('update private.ai_providers set enabled=false where id=$1',[provider.id]);
  await pool.query("update private.message_outbox set status='SUPPRESSED' where line_session_id=$1 and status='PENDING'",[f.session]);
 }
});
test('mixed reply source changes after enqueue suppress both general and official portions',async()=>{
 const f=await fixture();
 assert.equal((await runAICycle(pool,f.key,{produce:async snapshot=>({kind:'MIXED',general:createConversationReply(snapshot,'คำอธิบายทั่วไป')!,official:{kind:'CLARIFY',text:'ยังไม่มีข้อมูลยืนยันครับ'}})})).completed,1);
 await pool.query("update public.messages set content='new source after mixed enqueue' where id=$1",[f.message]);let sent=0;
 await runOutboxCycle(pool,f.key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async()=>{sent++;return new Response(null,{status:200});}});
 assert.equal(sent,0);
 assert.equal((await pool.query('select status from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].status,'SUPPRESSED');
});
