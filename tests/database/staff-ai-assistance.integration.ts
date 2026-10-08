import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {createStaffAssistance,type StaffGenerate} from '../../lib/staff/ai-assistance';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'staff-assist-owned-qa'});after(()=>pool.end());
const advice={ticketSummary:'ทดสอบ',conversationSummary:'สรุปบทสนทนา',replyDraft:'ขอข้อมูลเพิ่มเติมครับ',suggestedDepartmentCode:'IT',suggestedPriority:'MEDIUM' as const,reason:'เพื่อให้ตรวจสอบได้',uncertainties:[]};
async function fixture(){
 const staff=randomUUID(),other=randomUUID(),department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id;
 for(const id of [staff,other])await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name) values($1,$3,'STAFF','Private staff name'),($2,null,'ADMIN','QA')",[staff,other,department]);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['ASSIST_PRIVATE_'+randomUUID()])).rows[0].id;
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,'Wi-Fi ใช้ไม่ได้','IT_NETWORK','HUMAN','STAFF_HANDLING') returning id",[session,conversation,department])).rows[0].id;
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ลองเชื่อมต่อแล้วไม่ได้')",[conversation,ticket]);
 return {staff,other,department,session,conversation,ticket};
}
const result=(output:unknown=advice)=>({output,toolCalls:[],providerId:randomUUID(),modelId:randomUUID(),fallbackUsed:false});
test('authorized HUMAN summaries use minimized source outside SQL and do not send/change ticket state',async()=>{
 const f=await fixture();const before=(await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[f.ticket])).rows[0].n;
 const generate:StaffGenerate=async input=>{
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name='staff-assist-owned-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n,0);
  const source=JSON.stringify(input.messages);for(const privateValue of [f.session,f.conversation,f.staff,'ASSIST_PRIVATE_','Private staff name'])assert(!source.includes(privateValue));
  assert.equal(input.tools,undefined);return result();
 };
 const view=await createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate});assert.deepEqual(view.advice,advice);assert.equal(view.knowledgeStatus,'NOT_SEARCHED');
 assert.equal((await pool.query('select revision from public.tickets where id=$1',[f.ticket])).rows[0].revision,0);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[f.ticket])).rows[0].n,before);
});
test('wrong department/admin without grants, inactive actor, AI and resolved cases never invoke the provider',async()=>{
 const f=await fixture();let calls=0;const generate:StaffGenerate=async()=>{calls++;return result();};
 await assert.rejects(createStaffAssistance(f.other,f.ticket,{revision:0},{pool,generate}),{code:'NOT_FOUND'});
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await assert.rejects(createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate}),{code:'NOT_FOUND'});
 await pool.query('update public.staff_profiles set active=true where id=$1',[f.staff]);
 for(const status of ['RESOLVED','CLOSED']){await pool.query('update public.tickets set status=$2 where id=$1',[f.ticket,status]);await assert.rejects(createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate}),{code:'CONFLICT'});}
 await pool.query("update public.tickets set status='STAFF_HANDLING',mode='AI' where id=$1",[f.ticket]);await assert.rejects(createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate}),{code:'CONFLICT'});assert.equal(calls,0);
});
test('revoked scope/activity and changed revisions during generation discard advice',async()=>{
 for(const kind of ['scope','active','revision','conversation'] as const){const f=await fixture();
  const generate:StaffGenerate=async()=>{
   if(kind==='scope')await pool.query("update public.staff_profiles set role='ADMIN',department_id=null where id=$1",[f.staff]);
   if(kind==='active')await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);
   if(kind==='revision')await pool.query('update public.tickets set revision=revision+1 where id=$1',[f.ticket]);
   if(kind==='conversation')await pool.query("update public.conversations set mode='AI' where id=$1",[f.conversation]);return result();
  };
  await assert.rejects(createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate}),{code:['scope','active'].includes(kind)?'NOT_FOUND':'CONFLICT'});
 }
});
test('new message without revision change is still fenced by the complete selected source digest',async()=>{
 const f=await fixture();const generate:StaffGenerate=async()=>{await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ข้อมูลใหม่')",[f.conversation,f.ticket]);return result();};
 await assert.rejects(createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate}),{code:'CONFLICT'});
});
test('unregistered departments, unexpected tool calls and invalid schema fail closed without mutations',async()=>{
 const f=await fixture();for(const value of [result({...advice,suggestedDepartmentCode:'NOT_A_DEPARTMENT'}),{...result(),toolCalls:[{id:'x',name:'create_ticket',arguments:{}}]},result({...advice,replyDraft:null})])await assert.rejects(createStaffAssistance(f.staff,f.ticket,{revision:0},{pool,generate:async()=>value}),{code:'UNAVAILABLE'});
 assert.equal((await pool.query('select revision from public.tickets where id=$1',[f.ticket])).rows[0].revision,0);
});
