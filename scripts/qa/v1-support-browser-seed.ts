import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {createEscalation} from '../../lib/tickets/create-ticket';
import {getTicketSupportContext} from '../../lib/tickets/support-context';
import {readOperationsAnalytics} from '../../lib/operations/metrics';
import {encryptValue} from '../../lib/security/identity';

// Browser data is synthetic; this proves compiled projection, never real OA/provider confirmation.
const folder='.superpowers/staging/v1-ui-qa';
const runtime=JSON.parse(await readFile(`${folder}/runtime.json`,'utf8')),url=new URL(runtime.connectionString);
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');assert.equal(runtime.retained,true);assert.equal(runtime.migrations,34);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'54422');assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/u.test(runtime.database));assert.equal(url.pathname.slice(1),runtime.database);
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const account=credentials.accounts.find((a:{role:string})=>a.role==='STAFF');assert(account);
const key=process.env.ENCRYPTION_KEY;assert(key);
const pool=new Pool({connectionString:runtime.connectionString,max:4});const sessions:string[]=[];let stage='preflight';
try{
 assert.equal((await pool.query('select current_database() name')).rows[0].name,runtime.database);
 assert.equal((await pool.query("select count(*)::int n from private.ai_jobs where status in('PENDING','PROCESSING')")).rows[0].n,0,'OWNED_BROWSER_AI_QUEUE_MUST_BE_SETTLED');
 const profile=(await pool.query('select d.id,d.code from public.staff_profiles s join public.departments d on d.id=s.department_id where s.id=$1 and s.active',[account.id])).rows[0];assert.equal(profile?.code,'IT');
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['SUPPORT_BROWSER_'+randomUUID()])).rows[0].id;sessions.push(session);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const error='E_NETWORK_'+ 'A'.repeat(350),question=`Wi-Fi ต่อไม่ได้ ใช้ Android ข้อผิดพลาด ${error}`;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT',$2) returning id",[conversation,question])).rows[0].id;
 await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);
 assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce:async snapshot=>{
  assert(snapshot.support);const s=snapshot.support;return {kind:'CLARIFY',text:'กรุณายืนยันเพื่อส่งต่อเจ้าหน้าที่ครับ',support:{version:1,sourceDigest:s.sourceDigest,directoryDigest:s.directoryDigest,minimumSensitivity:s.minimumSensitivity,deliveredGuidance:s.input.deliveredGuidance,
   proposal:{intent:'ESCALATE',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:true,department:'IT',urgency:'medium',needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',
    facts:[{field:'PROBLEM',source:'U0',quote:'Wi-Fi ต่อไม่ได้'},{field:'DEVICE',source:'U0',quote:'Android'},{field:'ERROR',source:'U0',quote:error}]}}};
 }})).completed,1);
 stage='ticket_create';const ticket=await transaction(c=>createEscalation(c,{sessionId:session,conversationId:conversation,departmentCode:'IT',summary:question},key),pool);
 stage='staff_projection';const view=await getTicketSupportContext(account.id,ticket.id,{pool,key});assert.equal(view.status,'READY');assert.equal(view.facts.length,3);
 // Immutable outcome schema fixtures exercise the real scoped metrics read, not the action authorization path.
 const day=(await pool.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text as bangkok_date")).rows[0].bangkok_date;
 const state=(await pool.query('select state_digest from private.ticket_support_contexts where ticket_id=$1',[ticket.id])).rows[0];
 stage='outcome_fixtures';const receiptEvent=async()=>{const id=randomUUID();await pool.query("insert into private.webhook_inbox(id,channel,event_id,payload_encrypted,status) values($1,'STUDENT',$2,$3,'DONE')",[id,'BROWSER_FIXTURE_'+id,encryptValue('{}',key)]);return id;};
 await pool.query(`insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,department_id,sensitive_level,ticket_id)
  values($1,$2,$3,$4,$5,'USER_CONFIRMED_ESCALATED',$6,'GENERAL',$7)`,[conversation,session,message,await receiptEvent(),state.state_digest,profile.id,ticket.id]);
 for(let i=0;i<2;i++){
  const solved=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
  const last=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Synthetic confirmed outcome fixture') returning id",[solved])).rows[0].id;
  await pool.query(`insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,department_id,sensitive_level)
   values($1,$2,$3,$4,$5,'USER_CONFIRMED_SOLVED',$6,'GENERAL')`,[solved,session,last,await receiptEvent(),'b'.repeat(64),profile.id]);
 }
 const query={from:day,to:day,department:profile.id},analytics=await readOperationsAnalytics(account.id,query,{pool});assert(analytics.aiOutcomes.samples>=3);
 await writeFile(`${folder}/support-fixture.json`,JSON.stringify({ticketId:ticket.id,query,expected:analytics.aiOutcomes,rate:analytics.aiResolutionRate,fixturesOnly:true},null,2),{mode:0o600});
 console.log(JSON.stringify({status:'PASS',ownedOnly:true,workerContextFixture:true,outcomes:'IMMUTABLE_SCHEMA_FIXTURES',liveProvider:false,liveLINE:false}));
}catch(error){console.error(JSON.stringify({status:'FAIL',stage,code:error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,32}$/u.test(error.code)?error.code:undefined,
 syntax:error instanceof Error?/^syntax error at or near "[A-Za-z0-9_]*"$/u.test(error.message)?error.message:undefined:undefined}));process.exitCode=1;}
finally{
 if(sessions.length)await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.end();
}
