import assert from 'node:assert/strict';
import {test,before,after,afterEach} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {publishOwnedAssistantSources} from '../../scripts/qa/assistant-owned-publication';
import {discoverPublicStructured,searchStructured} from '../../lib/knowledge/structured-search';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {transaction} from '../../lib/database/pool';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {knowledgeScopeSchema} from '../../lib/knowledge/retrieval';
import {structuredDiscoveryResultSchema} from '../../lib/knowledge/structured-discovery';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:5}),key=randomBytes(32).toString('base64');
const scope=knowledgeScopeSchema.parse({historical:true,academicYear:2569,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null});
const sessions:string[]=[],documents:string[]=[];
before(async()=>{
 const actor=randomUUID();await pool.query('insert into auth.users(id) values($1)',[actor]);
 await pool.query("insert into public.staff_profiles(id,role,display_name) values($1,'SUPER_ADMIN','Owned discovery reviewer')",[actor]);
 const publication=await publishOwnedAssistantSources({pool,key,actor,database:database!,caseIds:['A12'],companion:JSON.parse(await readFile('tests/fixtures/assistant-conversation-context.json','utf8')),frozenText:await readFile('tests/fixtures/assistant-conversations.json','utf8')});
 documents.push(...publication.receipts.map(p=>p.receipt.documentId));assert.equal(documents.length,2);
});
after(()=>pool.end());
afterEach(async()=>{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
});
async function reviewed(){const c=await pool.connect();try{await c.query('begin');const result=await discoverPublicStructured(c,{dataset:'academic_calendar_events',scope},key);await c.query('commit');assert.equal(result.status,'READY');if(result.status!=='READY')throw Error('READY_REQUIRED');return result.evidence;}finally{c.release();}}
async function turn(){
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;sessions.push(session);
 const user='U'+randomUUID().replaceAll('-','');await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,content) values($1,'USER','ปฏิทินมหาวิทยาลัยปีการศึกษา 2569 ระบุวันเปิดภาคเรียนเมื่อไร') returning id",[conversation])).rows[0].id;
 const job=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);assert(job);
 return {session,conversation,job,user};
}
async function answer(){const evidence=await reviewed(),opening=evidence.find(e=>'event_type' in e.payload&&e.payload.event_type==='OPENING');assert(opening);return structuredDiscoveryResultSchema.parse({kind:'STRUCTURED_DISCOVERY',dataset:'academic_calendar_events',scope,evidence,output:{answer:'วันเปิดภาคเรียนตามปฏิทินทดสอบคือ 2026-06-15',citationRowIds:[opening.rowId]}});}
async function dispatch(){const bodies:Record<string,unknown>[]=[];const result=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status:200});}});return {result,bodies};}
test('calendar delivery rebuilds an injected wrong model year from the cited reviewed row, preserving the recipient',async()=>{
 const f=await turn(),original=await answer();
 const result=structuredDiscoveryResultSchema.parse({...original,output:{...original.output,answer:'วันเปิดภาคเรียนคือ15 มิถุนายน2566 (พ.ศ.2569)'}});
 assert.equal((await runAICycle(pool,key,{produce:async()=>result})).completed,1);
 const sent=await dispatch();assert.equal(sent.result.sent,1);assert.equal(sent.bodies[0]?.to,f.user);
 const messages=sent.bodies[0]?.messages as {type:string;text:string}[];
 const text=messages.map(m=>m.text).join('');
 assert(text.includes('2026-06-15'));assert(text.includes('2569'));assert(!text.includes('2566'));
 assert(!text.includes('2026-05-20'));assert(!text.includes('2026-05-30'));
 assert.equal((await pool.query("select status from private.message_outbox where idempotency_key='ai-job:'||$1",[f.job])).rows[0].status,'SENT');
});
test('calendar discovery uses real reviewed rows without relaxing exact Query1 and dispatches only the owned recipient',async()=>{
 const exact=await transaction(c=>searchStructured(c,{scope,query:{version:1,dataset:'academic_calendar_events',filters:{academic_year:2569},limit:20}},key),pool);
 assert.deepEqual(exact,{status:'CLARIFICATION_REQUIRED',missing:['semester','student_type']});
 const f=await turn(),result=await answer();assert.equal(result.evidence.length,2);
 assert.equal((await runAICycle(pool,key,{produce:async()=>result})).completed,1);
 const sent=await dispatch();assert.equal(sent.result.sent,1);assert.equal(sent.bodies[0]?.to,f.user);assert(JSON.stringify(sent.bodies).includes('2026-06-15'));
});
test('a discovery change in uncited context before dispatch suppresses the stale complete-catalog answer',async()=>{
 const f=await turn(),result=await answer();await runAICycle(pool,key,{produce:async()=>result});
 const uncited=result.evidence.find(e=>!result.output.citationRowIds.includes(e.rowId));assert(uncited);
 await pool.query('update public.documents set revision=revision+1 where id=$1',[uncited.reference.documentId]);
 const sent=await dispatch();assert.equal(sent.bodies.length,0);
 assert.equal((await pool.query("select status from private.message_outbox where idempotency_key='ai-job:'||$1",[f.job])).rows[0].status,'SUPPRESSED');
});
test('discovery result cannot leak after HUMAN takeover during production',async()=>{
 const f=await turn();await runAICycle(pool,key,{produce:async()=>{const result=await answer();await pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversation]);return result;}});
 assert.equal((await dispatch()).bodies.length,0);
 assert.equal((await pool.query('select status from private.ai_jobs where id=$1',[f.job])).rows[0].status,'SUPPRESSED');
});
test('unapproved/private evidence and a wrong decryption key cannot become a complete PUBLIC discovery',async()=>{
 await pool.query("update public.documents set visibility='INTERNAL' where id=any($1::uuid[])",[documents]);
 assert.equal((await transaction(c=>discoverPublicStructured(c,{dataset:'academic_calendar_events',scope},key),pool)).status,'EMPTY');
 await pool.query("update public.documents set visibility='PUBLIC' where id=any($1::uuid[])",[documents]);
 assert.equal((await transaction(c=>discoverPublicStructured(c,{dataset:'academic_calendar_events',scope},randomBytes(32).toString('base64')),pool)).status,'CONTEXT_INCOMPLETE');
});
