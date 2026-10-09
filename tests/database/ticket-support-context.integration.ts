import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {createEscalation} from '../../lib/tickets/create-ticket';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4}),key=Buffer.alloc(32,75).toString('base64');
after(()=>pool.end());
async function fixture(){
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Android Wi-Fi ต่อไม่ได้') returning id",[conversation])).rows[0].id;
 await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);
 assert.equal((await runAICycle(pool,key,{supportEnabled:true,produce:async s=>{assert(s.support);return {kind:'CLARIFY',text:'รับข้อมูลแล้วครับ',support:{version:1,sourceDigest:s.support.sourceDigest,directoryDigest:s.support.directoryDigest,minimumSensitivity:s.support.minimumSensitivity,deliveredGuidance:s.support.input.deliveredGuidance,
  proposal:{intent:'PERSONAL_CASE',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:true,department:'IT',urgency:'medium',needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U0',quote:'Wi-Fi ต่อไม่ได้'},{field:'DEVICE',source:'U0',quote:'Android'}]}}};}})).completed,1);
 const ticket=await transaction(c=>createEscalation(c,{sessionId:session,conversationId:conversation,departmentCode:'IT',summary:'Android'},key),pool);
 const staff=async(code:string,sensitive:boolean,role='STAFF')=>{const id=randomUUID();await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,role,department_id,display_name,can_view_sensitive) values($1,$2,(select id from public.departments where code=$3),'Scoped context fixture',$4)",[id,role,code,sensitive]);return id;};
 return {session,conversation,ticket,allowed:await staff('IT',true),denied:await staff('IT',false),foreign:await staff('FINANCE',true)};
}
test('scoped encrypted ticket context projects Thai labels and literal facts without private handles',async()=>{
 const f=await fixture(),reader=await import('../../lib/tickets/support-context').catch(()=>null);assert(reader?.getTicketSupportContext,'SCOPED_CONTEXT_READER_MISSING');
 const view=await reader.getTicketSupportContext(f.allowed,f.ticket.id,{pool,key});assert.equal(view.status,'READY');
 assert.deepEqual(view.facts,[{label:'ปัญหา',value:'Wi-Fi ต่อไม่ได้'},{label:'อุปกรณ์',value:'Android'}]);
 for(const value of [f.session,f.conversation,'U0','sourceDigest','stateDigest','v1.'])assert(!JSON.stringify(view).includes(value));
 await pool.query("update private.message_outbox set status='SUPPRESSED' where line_session_id=$1 and status='PENDING'",[f.session]);
});
test('context requires fresh current and retained sensitivity plus exact department access',async()=>{
 const f=await fixture(),reader=await import('../../lib/tickets/support-context').catch(()=>null);assert(reader?.getTicketSupportContext,'SCOPED_CONTEXT_READER_MISSING');
 for(const staff of [f.denied,f.foreign])await assert.rejects(reader.getTicketSupportContext(staff,f.ticket.id,{pool,key}),{code:'NOT_FOUND'});
 await pool.query("update public.tickets set sensitive_level='GENERAL' where id=$1",[f.ticket.id]);
 await assert.rejects(reader.getTicketSupportContext(f.denied,f.ticket.id,{pool,key}),{code:'NOT_FOUND'});
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.allowed]);await assert.rejects(reader.getTicketSupportContext(f.allowed,f.ticket.id,{pool,key}),{code:'NOT_FOUND'});
 await pool.query("update private.message_outbox set status='SUPPRESSED' where line_session_id=$1 and status='PENDING'",[f.session]);
});
test('unreadable context stays unavailable and never projects guessed or partial facts',async()=>{
 const f=await fixture(),reader=await import('../../lib/tickets/support-context').catch(()=>null);assert(reader?.getTicketSupportContext,'SCOPED_CONTEXT_READER_MISSING');
 assert.deepEqual(await reader.getTicketSupportContext(f.allowed,f.ticket.id,{pool,key:Buffer.alloc(32,76).toString('base64')}),{status:'UNAVAILABLE',facts:[]});
 await pool.query("update private.message_outbox set status='SUPPRESSED' where line_session_id=$1 and status='PENDING'",[f.session]);
});
