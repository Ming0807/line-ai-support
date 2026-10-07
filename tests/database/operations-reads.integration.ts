import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {readActivities,readLogs} from '../../lib/operations/reads';
import {parseActivityQuery,parseLogQuery} from '../../lib/operations/contracts';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DISPOSABLE_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:3});
after(()=>pool.end());
async function fixture(){
 const a=randomUUID(),b=randomUUID(),staff=randomUUID(),sensitive=randomUUID(),admin=randomUUID(),superAdmin=randomUUID(),session=randomUUID(),marker='OPS_'+randomUUID();
 await pool.query("insert into public.departments(id,code,name_th,name_en) values($1,$3,$3,$3),($2,$4,$4,$4)",[a,b,'OPS_'+a.replaceAll('-',''),'OPS_'+b.replaceAll('-','')]);
 for(const id of [staff,sensitive,admin,superAdmin])await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query(`insert into public.staff_profiles(id,department_id,display_name,role,can_view_sensitive) values
 ($1,$5,$6,'STAFF',false),($2,$5,$6,'STAFF',true),($3,null,$6,'ADMIN',false),($4,null,$6,'SUPER_ADMIN',true)`,[staff,sensitive,admin,superAdmin,a,marker]);
 await pool.query('insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',[admin,a]);
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,marker]);
 const ticket=async(department=a,sensitivity='GENERAL')=>{
  const conversation=randomUUID(),id=randomUUID();await pool.query("insert into public.conversations(id,line_session_id,conversation_type,mode,status) values($1,$2,'TICKET','HUMAN','ACTIVE')",[conversation,session]);
  await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status,sensitive_level) values($1,$2,$3,$4,'Synthetic operations test','GENERAL','HUMAN','WAITING_STAFF',$5)",[id,session,conversation,department,sensitivity]);return id;
 };
 const activity=async(ticketId:string|null,action='STAFF_REPLIED',at='2040-01-01T00:00:00Z')=>{
  const id=randomUUID();await pool.query('insert into private.activities(id,ticket_id,actor_id,action,metadata,created_at) values($1,$2,$3,$4,$5::jsonb,$6)',[id,ticketId,staff,action,JSON.stringify({token:'NEVER_PUBLIC',lineId:'NEVER_PUBLIC',message:'NEVER_PUBLIC'}),at]);return id;
 };
 const read=(actor:string,query='')=>readActivities(actor,parseActivityQuery(new URLSearchParams('from=2040-01-01&to=2040-01-01&q='+encodeURIComponent(marker)+(query?'&'+query:''))),{pool});
 const logs=(actor:string,query='')=>readLogs(actor,parseLogQuery(new URLSearchParams('from=2040-01-01&to=2040-01-01'+(query?'&'+query:''))),{pool});
 return {a,b,staff,sensitive,admin,superAdmin,session,marker,ticket,activity,read,logs};
}
test('activities enforce department/sensitivity including truthful totals and hidden global journal',async()=>{
 const f=await fixture();const ordinary=await f.activity(await f.ticket()),sensitive=await f.activity(await f.ticket(f.a,'SENSITIVE'));
 await f.activity(await f.ticket(f.a,'RESTRICTED'));await f.activity(await f.ticket(f.b));await f.activity(null,'KNOWLEDGE_IMPORT_PUBLISHED');
 const own=await f.read(f.staff);assert.deepEqual(own.items.map(row=>row.id),[ordinary]);assert.equal(own.pagination.total,1);
 assert.deepEqual(new Set((await f.read(f.sensitive)).items.map(row=>row.id)),new Set([ordinary,sensitive]));
 assert.equal((await f.read(f.admin)).pagination.total,1);assert.equal((await f.read(f.superAdmin)).pagination.total,5);
 assert.equal((await f.read(f.staff,'action=APPROVE_KNOWLEDGE')).pagination.total,0);
 assert.equal((await f.read(f.superAdmin,'action=APPROVE_KNOWLEDGE')).pagination.total,1);
 assert(!JSON.stringify(own).includes('NEVER_PUBLIC'));assert(!JSON.stringify(own).includes(f.session));
});
test('activities preserve stable pages/out-of-range totals and fresh revoked grants/actor',async()=>{
 const f=await fixture(),ticket=await f.ticket(),ids=[];for(let i=0;i<4;i++)ids.push(await f.activity(ticket));ids.sort();
 const first=await f.read(f.admin,'pageSize=2'),second=await f.read(f.admin,'pageSize=2&page=2'),far=await f.read(f.admin,'pageSize=2&page=99');
 assert.deepEqual(first.items.map(row=>row.id),ids.slice(0,2));assert.deepEqual(second.items.map(row=>row.id),ids.slice(2));assert.equal(first.pagination.total,4);assert.equal(far.items.length,0);assert.equal(far.pagination.total,4);
 await pool.query('delete from public.staff_department_grants where staff_id=$1',[f.admin]);assert.equal((await f.read(f.admin)).pagination.total,0);
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await assert.rejects(f.read(f.staff),{code:'NOT_FOUND'});await assert.rejects(f.read(randomUUID()),{code:'NOT_FOUND'});
});
test('activities apply Bangkok bounds and search only projected safe fields literally',async()=>{
 const f=await fixture(),ticket=await f.ticket();await f.activity(ticket,'CREATED','2039-12-31T16:59:59Z');const start=await f.activity(ticket,'CREATED','2039-12-31T17:00:00Z'),end=await f.activity(ticket,'CREATED','2040-01-01T16:59:59Z');await f.activity(ticket,'CREATED','2040-01-01T17:00:00Z');
 assert.deepEqual((await f.read(f.staff)).items.map(row=>row.id),[end,start]);
 const direct=(q:string)=>readActivities(f.staff,parseActivityQuery(new URLSearchParams({from:'2040-01-01',to:'2040-01-01',q})),{pool});
 assert.equal((await direct('NEVER_PUBLIC')).pagination.total,0);assert.equal((await direct("%' OR true --")).pagination.total,0);
 await pool.query('update public.staff_profiles set display_name=$2 where id=$1',[f.staff,'literal 100%_! '+f.marker]);assert.equal((await direct('100%_!')).pagination.total,2);assert.equal((await direct('100XYZ')).pagination.total,0);
});
test('unknown activity strings become fixed OTHER without disclosing their contents',async()=>{
 const f=await fixture();await f.activity(await f.ticket(),'NEVER_PUBLIC');const result=await f.read(f.staff,'action=OTHER');assert.equal(result.pagination.total,1);assert.equal(result.items[0].action,'OTHER');assert(!JSON.stringify(result).includes('NEVER_PUBLIC'));
});
test('logs require active SUPER_ADMIN and expose only fixed source observations',async()=>{
 const f=await fixture();for(const actor of [f.staff,f.sensitive,f.admin])await assert.rejects(f.logs(actor),{code:'FORBIDDEN'});
 const provider=(await pool.query("insert into private.ai_providers(name,adapter,base_url,api_key_encrypted) values($1,'OPENAI','https://api.openai.com/v1',$2) returning id",[randomUUID(),'v1.'+'x'.repeat(80)])).rows[0].id;
 const model=(await pool.query("insert into private.ai_models(provider_id,model_id,display_name) values($1,'synthetic-ops','Synthetic ops') returning id",[provider])).rows[0].id;
 const ai=(await pool.query("insert into private.ai_errors(provider_id,model_id,error_type,http_status,message,created_at) values($1,$2,'AUTH_ERROR',401,'AUTH_ERROR','2040-01-01T00:00:00Z') returning id",[provider,model])).rows[0].id;
 const outbox=(await pool.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted) values($1,$2,'SYSTEM','NEVER_PUBLIC') returning id",[randomUUID(),f.session])).rows[0].id;
 await pool.query("insert into private.delivery_attempts(outbox_id,http_status,error_code,request_id,accepted,created_at) values($1,429,'NEVER_PUBLIC','NEVER_PUBLIC',false,'2040-01-01T00:00:00Z'),($1,409,null,'NEVER_PUBLIC',true,'2040-01-01T00:00:00Z')",[outbox]);
 const aiResult=await f.logs(f.superAdmin,'component=ai-gateway&code=AUTH_ERROR');assert(aiResult.items.some(row=>row.id==='ai:'+ai&&row.httpStatus===401));
 const unknown=await f.logs(f.superAdmin,'component=line-delivery&code=LINE_DELIVERY_FAILED&severity=WARN');assert.equal(unknown.pagination.total,1);assert.equal(unknown.items[0].httpStatus,429);
 const accepted=await f.logs(f.superAdmin,'component=line-delivery&severity=INFO');assert.equal(accepted.pagination.total,1);assert.equal(accepted.items[0].code,'LINE_DELIVERED');assert.equal(accepted.items[0].httpStatus,409);
 const serialized=JSON.stringify(await f.logs(f.superAdmin));for(const privateValue of ['NEVER_PUBLIC',provider,model,outbox,f.session])assert(!serialized.includes(privateValue));
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.superAdmin]);await assert.rejects(f.logs(f.superAdmin),{code:'NOT_FOUND'});
});
