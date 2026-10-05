import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client,Pool} from 'pg';
import {createTicketToolRegistry,createKnowledgeToolRegistry} from '../../lib/ai/backend-tools';
import {createChoices,consumeChoice} from '../../lib/conversation/quick-reply';
import {loadCandidates,candidateSnapshot} from '../../lib/conversation/context-resolver';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import type {ToolContext} from '../../lib/ai/tools';
import type {KnowledgeScope} from '../../lib/knowledge/types';

const url='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,
 studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};

async function fixture(client:Client){
 const key=randomBytes(32).toString('base64'),user='U'+randomUUID().replaceAll('-',''),hash=hashLineUserId(user,key);
 const session=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 await client.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hash,encryptValue(user,key)]);
 const conversation=(await client.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 await client.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','ขอติดต่อเจ้าหน้าที่ IT')",[conversation]);
 const context:ToolContext={lineSessionId:session,conversationId:conversation,conversationRevision:0};
 return {key,user,hash,session,conversation,context};
}

test('ticket tool requires an owned consumed escalation choice and replays a single atomic ticket effect',async()=>{
 const client=new Client({connectionString:url});await client.connect();await client.query('begin');
 try{
  const f=await fixture(client),args={departmentCode:'IT',summary:'ต้องการเจ้าหน้าที่ช่วยตรวจสอบระบบ'};
  await assert.rejects(createTicketToolRegistry(client,f.key).execute({name:'create_ticket',arguments:args},f.context,['create_ticket']),{message:'TOOL_EXECUTION_FAILED'});
  const snapshot=candidateSnapshot(await loadCandidates(client,f.session));
  const menu=await createChoices(client,{sessionId:f.session,snapshot,choices:[{label:'ฝ่าย IT',value:{action:'ESCALATE',conversationId:f.conversation,departmentCode:'IT'}}]},f.key);
  const event={type:'postback',source:{type:'user',userId:f.user},postback:{data:menu.items[0].action.data}};
  const eventId=(await client.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
   values('STUDENT',$1,$2,$3,'OTHER') returning id`,[randomUUID(),f.hash,encryptValue(JSON.stringify(event),f.key)])).rows[0].id;
  assert(await consumeChoice(client,f.session,event.postback.data,snapshot,f.key));
  const registry=createTicketToolRegistry(client,f.key,eventId);
  const first=await registry.execute({name:'create_ticket',arguments:args},f.context,['create_ticket']);
  const repeated=await registry.execute({name:'create_ticket',arguments:args},f.context,['create_ticket']);
  assert.deepEqual(repeated,first);
  assert.equal((await client.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,1);
  assert.equal((await client.query('select count(*)::int n from private.ai_tool_receipts where confirmation_event_id=$1',[eventId])).rows[0].n,1);
  await assert.rejects(registry.execute({name:'create_ticket',arguments:{...args,departmentCode:'LIBRARY'}},f.context,['create_ticket']),{message:'TOOL_EXECUTION_FAILED'});
  await assert.rejects(registry.execute({name:'create_ticket',arguments:args},{...f.context,lineSessionId:randomUUID()},['create_ticket']),{message:'TOOL_EXECUTION_FAILED'});
  const privacy=(await client.query(`select relrowsecurity,has_table_privilege('authenticated','private.ai_tool_receipts','SELECT,INSERT,UPDATE,DELETE') browser,
   has_table_privilege('anon','private.ai_tool_receipts','SELECT,INSERT,UPDATE,DELETE') anon from pg_class where oid='private.ai_tool_receipts'::regclass`)).rows[0];
  assert(privacy.relrowsecurity&&!privacy.browser&&!privacy.anon);
 }finally{await client.query('rollback');await client.end();}
});

test('read tools validate context and fixed schemas; HUMAN, foreign identity, arbitrary SQL and unsupported datasets are denied',async()=>{
 const pool=new Pool({connectionString:url,max:2}),client=await pool.connect();
 let session='',conversation='';
 try{
  session=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
  conversation=(await client.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
  const context:ToolContext={lineSessionId:session,conversationId:conversation,conversationRevision:0};
  const registry=createKnowledgeToolRegistry(pool,{vector:[1,0],fingerprint:'a'.repeat(64)});
  assert.deepEqual(await registry.execute({name:'search_knowledge',arguments:{query:'เอกสารเทียบโอน',scope}},context,['search_knowledge']),[]);
  const department=await registry.execute({name:'route_department',arguments:{departmentCode:'IT'}},context,['route_department']);assert(department);
  await assert.rejects(registry.execute({name:'search_knowledge',arguments:{query:'x',scope,sql:'select * from private.line_identities'}},context,['search_knowledge']),{message:'INVALID_ARGUMENTS'});
  await assert.rejects(registry.execute({name:'search_structured',arguments:{dataset:'private.line_identities',query:'x',scope}},context,['search_structured']),{message:'INVALID_ARGUMENTS'});
  await assert.rejects(registry.execute({name:'search_structured',arguments:{dataset:'academic_calendar_events',query:'x',scope}},context,['search_structured']),{message:'TOOL_EXECUTION_FAILED'});
  await assert.rejects(registry.execute({name:'route_department',arguments:{departmentCode:'IT'}},{...context,lineSessionId:randomUUID()},['route_department']),{message:'TOOL_EXECUTION_FAILED'});
  await client.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[conversation]);
  await assert.rejects(registry.execute({name:'search_knowledge',arguments:{query:'x',scope}},context,['search_knowledge']),{message:'TOOL_EXECUTION_FAILED'});
 }finally{
  if(conversation)await client.query('delete from public.conversations where id=$1',[conversation]);
  if(session)await client.query('delete from public.line_sessions where id=$1',[session]);client.release();await pool.end();
 }
});

test('knowledge tool returns a fixed ambiguity result rather than hiding a required date clarification',async()=>{
 const pool=new Pool({connectionString:url,max:2});let session='',conversation='',family='';
 try{
  session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
  conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
  const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();
  family=(await pool.query("insert into public.document_families(code,name,category) values($1,'Tool history','REGULATION') returning id",[code])).rows[0].id;
  for(const date of ['2024-01-01','2024-06-01']){
   await pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,academic_year,status,is_current,
    approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
    values($1,'Historical source','2567','history',2567,'SUPERSEDED',false,'APPROVED',clock_timestamp(),true,true,false,$2,
    'https://fixture.yru.ac.th/history.pdf',$3)`,[family,date,randomBytes(32).toString('hex')]);
  }
  const registry=createKnowledgeToolRegistry(pool,{vector:[1,0],fingerprint:'a'.repeat(64)});
  const result=await registry.execute({name:'search_knowledge',arguments:{query:'ปี 2567',scope:{...scope,historical:true,academicYear:2567,familyCodes:[code]}}},
   {lineSessionId:session,conversationId:conversation,conversationRevision:0},['search_knowledge']);
  assert.deepEqual(result,{status:'SCOPE_AMBIGUOUS'});
 }finally{
  if(family)await pool.query('delete from public.documents where document_family_id=$1',[family]);
  if(family)await pool.query('delete from public.document_families where id=$1',[family]);
  if(conversation)await pool.query('delete from public.conversations where id=$1',[conversation]);
  if(session)await pool.query('delete from public.line_sessions where id=$1',[session]);await pool.end();
 }
});
